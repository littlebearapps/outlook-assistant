const { spawnSync } = require('child_process');
const path = require('path');

const packageJson = require('../../package.json');

const repoRoot = path.resolve(__dirname, '../..');
const expectedVersionOutput = `${packageJson.name} v${packageJson.version}`;

function runVersionFlag(flag) {
  return spawnSync(process.execPath, ['index.js', flag], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 2000,
  });
}

describe('CLI version flag', () => {
  test.each(['--version', '-v'])(
    '%s prints version and exits cleanly',
    (flag) => {
      const result = runVersionFlag(flag);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(expectedVersionOutput);
      expect(result.stderr).toBe('');
    }
  );
});
