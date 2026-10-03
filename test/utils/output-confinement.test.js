/**
 * Where export and attachment downloads may write: the system temp directory,
 * ~/Downloads, ~/Documents, or OUTLOOK_EXPORT_DIR. Paths are resolved
 * (realpath for the part that exists) before the check, and nothing below an
 * allowed directory may be a dotfile or dot-directory.
 *
 * Each test points TMPDIR and HOME at separate scratch directories, so the
 * bases don't overlap and "outside" really is outside.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  confineOutputPath,
  writeExplicitFile,
  OutputPathError,
} = require('../../utils/safe-write');

const itSymlink = process.platform === 'win32' ? test.skip : test;

const ENV_KEYS = ['OUTLOOK_EXPORT_DIR'];
let savedEnv;
let scratch; // real path of the scratch root
let tmp; // stands in for the system temp directory
let home; // stands in for the home directory
let outside; // under none of the bases

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  scratch = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'oa-confine-'))
  );
  tmp = path.join(scratch, 'tmp');
  home = path.join(scratch, 'home');
  outside = path.join(scratch, 'outside');
  for (const dir of [tmp, home, outside]) fs.mkdirSync(dir);
  // os reads the real environment, not Jest's copy of process.env
  jest.spyOn(os, 'tmpdir').mockReturnValue(tmp);
  jest.spyOn(os, 'homedir').mockReturnValue(home);
  delete process.env.OUTLOOK_EXPORT_DIR;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  // os is shared with other test files in this worker: always restore
  os.tmpdir.mockRestore();
  os.homedir.mockRestore();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function expectRefused(fn, pattern) {
  let error;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(OutputPathError);
  if (pattern) expect(error.message).toMatch(pattern);
  return error;
}

describe('confineOutputPath', () => {
  test('allows the temp directory and paths below it', () => {
    expect(confineOutputPath(tmp)).toBe(tmp);
    expect(confineOutputPath(path.join(tmp, 'exports', 'a.md'))).toBe(
      path.join(tmp, 'exports', 'a.md')
    );
  });

  test.each(['Downloads', 'Documents'])(
    'allows ~/%s, even before it exists',
    (name) => {
      const target = path.join(home, name, 'mail', 'x.eml');
      expect(confineOutputPath(target)).toBe(target);
    }
  );

  test('allows OUTLOOK_EXPORT_DIR when set', () => {
    process.env.OUTLOOK_EXPORT_DIR = outside;
    expect(confineOutputPath(path.join(outside, 'x.json'))).toBe(
      path.join(outside, 'x.json')
    );
  });

  test('expands a leading ~ in OUTLOOK_EXPORT_DIR', () => {
    process.env.OUTLOOK_EXPORT_DIR = '~/mail-archive';
    const target = path.join(home, 'mail-archive', 'x.json');
    expect(confineOutputPath(target)).toBe(target);
  });

  test('refuses a directory outside every base, naming the bases and OUTLOOK_EXPORT_DIR', () => {
    const error = expectRefused(() => confineOutputPath(outside));
    expect(error.message).toContain(outside);
    expect(error.message).toContain(tmp);
    expect(error.message).toContain(path.join(home, 'Downloads'));
    expect(error.message).toContain(path.join(home, 'Documents'));
    expect(error.nextStep).toContain('OUTLOOK_EXPORT_DIR');
  });

  test('refuses the home directory itself and other folders in it', () => {
    expectRefused(() => confineOutputPath(home));
    expectRefused(() => confineOutputPath(path.join(home, 'Desktop', 'x')));
  });

  test('refuses .. that climbs out of a base', () => {
    expectRefused(() =>
      confineOutputPath(path.join(tmp, '..', 'outside', 'x.md'))
    );
    expectRefused(() => confineOutputPath(`${tmp}/a/../../outside`));
  });

  test('refuses a sibling that only shares a prefix with a base', () => {
    const sibling = `${tmp}-evil`;
    fs.mkdirSync(sibling);
    expectRefused(() => confineOutputPath(path.join(sibling, 'x')));
  });

  itSymlink('refuses a symlinked directory that leads outside', () => {
    fs.symlinkSync(outside, path.join(tmp, 'link'));
    expectRefused(() => confineOutputPath(path.join(tmp, 'link')));
    expectRefused(() =>
      confineOutputPath(path.join(tmp, 'link', 'new', 'x.md'))
    );
  });

  itSymlink('returns the real path for a symlink that stays inside', () => {
    fs.mkdirSync(path.join(tmp, 'real'));
    fs.symlinkSync(path.join(tmp, 'real'), path.join(tmp, 'alias'));
    expect(confineOutputPath(path.join(tmp, 'alias', 'x.md'))).toBe(
      path.join(tmp, 'real', 'x.md')
    );
  });

  itSymlink('follows a symlinked base to where it really is', () => {
    const realDocs = path.join(outside, 'docs');
    fs.mkdirSync(realDocs);
    fs.symlinkSync(realDocs, path.join(home, 'Documents'));
    expect(confineOutputPath(path.join(home, 'Documents', 'x.md'))).toBe(
      path.join(realDocs, 'x.md')
    );
  });

  test.each([
    ['a dot-directory', ['.git', 'hooks', 'pre-commit']],
    ['a dotfile', ['.bashrc']],
    ['a nested dot-directory', ['work', '.vscode']],
  ])('refuses %s below a base', (_label, parts) => {
    expectRefused(() => confineOutputPath(path.join(tmp, ...parts)), /dot/);
  });

  test('a dot in the base path itself is fine', () => {
    const dotted = path.join(outside, '.mail-exports');
    process.env.OUTLOOK_EXPORT_DIR = dotted;
    expect(confineOutputPath(path.join(dotted, 'x.md'))).toBe(
      path.join(dotted, 'x.md')
    );
  });

  test('refuses a path that cannot be resolved', () => {
    expectRefused(() => confineOutputPath(`${tmp}/bad\0name`));
  });

  test('resolves a relative path against the working directory', () => {
    const cwd = process.cwd();
    try {
      process.chdir(tmp);
      expect(confineOutputPath('rel/x.md')).toBe(path.join(tmp, 'rel/x.md'));
    } finally {
      process.chdir(cwd);
    }
  });
});

describe('writeExplicitFile', () => {
  test('creates a new file, and its parent directories', () => {
    const target = path.join(tmp, 'new', 'x.md');
    const result = writeExplicitFile(target, 'hello', { encoding: 'utf8' });
    expect(result).toEqual({ path: target, replaced: false });
    expect(fs.readFileSync(target, 'utf8')).toBe('hello');
  });

  test('refuses to replace an existing file by default and leaves it untouched', () => {
    const target = path.join(tmp, 'x.md');
    fs.writeFileSync(target, 'original');
    const error = expectRefused(
      () => writeExplicitFile(target, 'new'),
      /already exists/
    );
    expect(error.nextStep).toMatch(/overwrite/);
    expect(fs.readFileSync(target, 'utf8')).toBe('original');
  });

  test('replaces a regular file with overwrite: true', () => {
    const target = path.join(tmp, 'x.md');
    fs.writeFileSync(target, 'original');
    const result = writeExplicitFile(target, 'new', { overwrite: true });
    expect(result).toEqual({ path: target, replaced: true });
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    // No temporary files left behind
    expect(fs.readdirSync(tmp)).toEqual(['x.md']);
  });

  test('overwrite: true on a missing file just creates it', () => {
    const target = path.join(tmp, 'x.md');
    expect(writeExplicitFile(target, 'new', { overwrite: true })).toEqual({
      path: target,
      replaced: false,
    });
  });

  test.each([
    ['a dotfile', ['.profile']],
    ['a file inside a dot-directory', ['.config', 'app.json']],
  ])('never replaces %s, even with overwrite: true', (_label, parts) => {
    const target = path.join(outside, ...parts);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'original');
    expectRefused(
      () => writeExplicitFile(target, 'new', { overwrite: true }),
      /dot/
    );
    expect(fs.readFileSync(target, 'utf8')).toBe('original');
  });

  itSymlink('never replaces a symlink, even with overwrite: true', () => {
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'original');
    const link = path.join(tmp, 'x.md');
    fs.symlinkSync(victim, link);

    expectRefused(
      () => writeExplicitFile(link, 'new', { overwrite: true }),
      /symbolic link/
    );
    expect(fs.readFileSync(victim, 'utf8')).toBe('original');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  itSymlink('does not write through a dangling symlink', () => {
    const victim = path.join(outside, 'victim.txt');
    const link = path.join(tmp, 'x.md');
    fs.symlinkSync(victim, link);

    expectRefused(() => writeExplicitFile(link, 'new'), /already exists/);
    expectRefused(
      () => writeExplicitFile(link, 'new', { overwrite: true }),
      /symbolic link/
    );
    expect(fs.existsSync(victim)).toBe(false);
  });

  itSymlink('never replaces a file with other hard links', () => {
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'original');
    const link = path.join(tmp, 'x.md');
    fs.linkSync(victim, link);

    expectRefused(
      () => writeExplicitFile(link, 'new', { overwrite: true }),
      /hard link/
    );
    expect(fs.readFileSync(victim, 'utf8')).toBe('original');
  });

  test('refuses to replace a directory', () => {
    const target = path.join(tmp, 'dir');
    fs.mkdirSync(target);
    expectRefused(() => writeExplicitFile(target, 'new', { overwrite: true }));
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });
});
