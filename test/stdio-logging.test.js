/**
 * End-to-end stderr logging over real stdio (#278).
 *
 * Spawns `node index.js` in test mode, signs in (test tokens), lists tools
 * and runs a search with a search term and an address, then checks what
 * reached stderr: by default one line per tool call and no arguments; with
 * OUTLOOK_DEBUG, detail with the address redacted. Never a token.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENTRY = path.join(__dirname, '..', 'index.js');
const PKG_VERSION = require('../package.json').version;
const SEARCH_TERM = 'quarterly merger plans';
const ADDRESS = 'jane.doe@example.com';

/**
 * Run a scripted session and resolve with everything written to stderr.
 * @param {object} extraEnv
 * @returns {Promise<string>}
 */
function runSession(extraEnv) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-stdio-logging-'));
  const env = { ...process.env, USE_TEST_MODE: 'true', HOME: home };
  delete env.OUTLOOK_DEBUG;
  Object.assign(env, extraEnv);

  const child = spawn(process.execPath, [ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'logging-test', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'auth', arguments: { action: 'authenticate' } },
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'search-emails',
        arguments: { query: SEARCH_TERM, from: ADDRESS },
      },
    },
  ];

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out; stderr so far:\n${stderr}`));
    }, 15000);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const done = stdout
        .split('\n')
        .filter((l) => l.trim())
        .some((l) => {
          try {
            return JSON.parse(l).id === 4;
          } catch {
            return false;
          }
        });
      if (done) {
        clearTimeout(timer);
        // Give stderr a moment to flush the call line, then stop the child
        // (index.js deliberately survives SIGTERM).
        setTimeout(() => {
          child.kill('SIGKILL');
        }, 200);
      }
    });
    child.on('exit', () => {
      clearTimeout(timer);
      fs.rmSync(home, { recursive: true, force: true });
      resolve(stderr);
    });
    child.stdin.write(`${requests.map((r) => JSON.stringify(r)).join('\n')}\n`);
  });
}

const toolLines = (stderr) =>
  stderr.split('\n').filter((l) => l.startsWith('tool='));

describe('stdio server stderr (#278)', () => {
  test('default: startup, then one line per tool call and no arguments', async () => {
    const stderr = await runSession({});

    expect(stderr).toContain(
      `STARTING OUTLOOK-ASSISTANT MCP SERVER v${PKG_VERSION}`
    );
    expect(toolLines(stderr)).toEqual([
      expect.stringMatching(
        /^tool=auth action=authenticate outcome=ok ms=\d+$/
      ),
      expect.stringMatching(/^tool=search-emails outcome=\w+ ms=\d+/),
    ]);
    expect(stderr).not.toContain('[debug]');
    expect(stderr).not.toMatch(/TOOL CALL|TOOLS COUNT|REQUEST:/);
    expect(stderr).not.toContain(SEARCH_TERM);
    expect(stderr).not.toContain(ADDRESS);
    expect(stderr).not.toMatch(/test_(access|refresh)_token/);
  }, 20000);

  test('OUTLOOK_DEBUG: detail with the address redacted, never a token', async () => {
    const stderr = await runSession({ OUTLOOK_DEBUG: 'true' });

    expect(stderr).toMatch(/Debug logging is on \(OUTLOOK_DEBUG\)/);
    expect(stderr).toContain('[debug]');
    expect(stderr).toContain('<redacted-email>');
    expect(stderr).not.toContain(ADDRESS);
    expect(stderr).not.toMatch(/test_(access|refresh)_token/);
    // Still one call line each
    expect(toolLines(stderr)).toHaveLength(2);
  }, 20000);
});
