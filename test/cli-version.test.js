/**
 * Tests for `--version` / `-v` CLI flag (GH #68).
 *
 * Spawns `node index.js` with the flag and asserts:
 *   - stdout matches `@littlebearapps/outlook-assistant v<version>`
 *   - exit code is 0
 *   - no MCP startup output is emitted (we exit before logging)
 */

const path = require('path');
const { spawnSync } = require('child_process');

const ENTRY = path.join(__dirname, '..', 'index.js');
const pkg = require('../package.json');

function runCli(args) {
  return spawnSync(process.execPath, [ENTRY, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('CLI --version flag', () => {
  test('--version prints "<name> v<version>" and exits 0', () => {
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`${pkg.name} v${pkg.version}`);
  });

  test('-v shorthand prints "<name> v<version>" and exits 0', () => {
    const result = runCli(['-v']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`${pkg.name} v${pkg.version}`);
  });

  test('--version exits before MCP server startup logging', () => {
    const result = runCli(['--version']);
    expect(result.stderr).not.toMatch(/STARTING/);
    expect(result.stderr).not.toMatch(/connected and listening/);
  });
});
