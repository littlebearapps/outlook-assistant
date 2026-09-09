/**
 * CLI entry-point tests (#68).
 *
 * Spawns `node index.js` as a real child process so we exercise the actual
 * argv handling at the top of the entry point — including the guarantee that
 * it exits before the MCP server boots and before the startup banner is
 * written to stderr.
 */
const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const ENTRY = path.join(__dirname, '..', 'index.js');
const PKG_VERSION = require('../package.json').version;

/** Run the entry point with args, resolving even on non-zero exit. */
function runCli(args) {
  return execFileAsync(process.execPath, [ENTRY, ...args], {
    timeout: 10000,
    // index.js installs a SIGTERM handler that deliberately stays alive, so a
    // default-signal timeout would never reap a child that wrongly booted the
    // server instead of handling the flag.
    killSignal: 'SIGKILL',
    env: { ...process.env, USE_TEST_MODE: 'true' },
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (err) => ({
      code: err.code,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    })
  );
}

describe('CLI flags', () => {
  describe('--version', () => {
    it('prints the package version to stdout and exits 0', async () => {
      const { code, stdout } = await runCli(['--version']);
      expect(code).toBe(0);
      expect(stdout.trim()).toBe(PKG_VERSION);
    });

    it('supports the -v short form', async () => {
      const { code, stdout } = await runCli(['-v']);
      expect(code).toBe(0);
      expect(stdout.trim()).toBe(PKG_VERSION);
    });

    it('does not start the MCP server or emit the startup banner', async () => {
      const { stderr } = await runCli(['--version']);
      expect(stderr).not.toMatch(/STARTING/i);
      expect(stderr).not.toMatch(/connected and listening/i);
    });

    it('reports the same version the server advertises via config', async () => {
      const { stdout } = await runCli(['--version']);
      expect(stdout.trim()).toBe(require('../config').SERVER_VERSION);
    });
  });

  describe('--help', () => {
    it('prints usage to stdout and exits 0', async () => {
      const { code, stdout } = await runCli(['--help']);
      expect(code).toBe(0);
      expect(stdout).toMatch(/Usage/i);
      expect(stdout).toContain('outlook-assistant');
    });

    it('supports the -h short form', async () => {
      const { code, stdout } = await runCli(['-h']);
      expect(code).toBe(0);
      expect(stdout).toMatch(/Usage/i);
    });

    it('documents both --version and --help', async () => {
      const { stdout } = await runCli(['--help']);
      expect(stdout).toContain('--version');
      expect(stdout).toContain('--help');
    });

    it('does not start the MCP server', async () => {
      const { stderr } = await runCli(['--help']);
      expect(stderr).not.toMatch(/STARTING/i);
    });
  });

  describe('a recognised flag does not excuse an unrecognised one', () => {
    it('rejects `--version --nope` instead of printing the version', async () => {
      const { code, stdout, stderr } = await runCli(['--version', '--nope']);
      expect(code).toBe(1);
      expect(stdout.trim()).toBe('');
      expect(stderr).toContain('--nope');
    });

    it('rejects `--nope --version` too', async () => {
      const { code, stderr } = await runCli(['--nope', '--version']);
      expect(code).toBe(1);
      expect(stderr).toContain('--nope');
    });

    it('rejects `--help --nope` instead of printing usage', async () => {
      const { code, stdout } = await runCli(['--help', '--nope']);
      expect(code).toBe(1);
      expect(stdout.trim()).toBe('');
    });

    it('names the offending argument, not merely the first one', async () => {
      const { stderr } = await runCli(['--version', '--bogus']);
      expect(stderr).toContain('--bogus');
    });

    it('still accepts several recognised flags together', async () => {
      // --version wins over --help when both are given; neither is an error.
      const { code, stdout } = await runCli(['--version', '--help']);
      expect(code).toBe(0);
      expect(stdout.trim()).toBe(PKG_VERSION);
    });
  });

  describe('unknown flags', () => {
    it('exits non-zero with a message on stderr naming the flag', async () => {
      const { code, stderr } = await runCli(['--nope']);
      expect(code).toBe(1);
      expect(stderr).toContain('--nope');
      expect(stderr).toMatch(/--help/);
    });

    it('does not start the MCP server', async () => {
      const { stderr } = await runCli(['--bogus']);
      expect(stderr).not.toMatch(/connected and listening/i);
    });
  });
});
