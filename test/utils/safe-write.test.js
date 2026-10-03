// The one exclusive-create writer shared by attachments, export and
// conversation export (#258): never overwrite, never follow a symlink, stay
// inside outputDir, and disambiguate collisions with a `-N` suffix.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeClaimedFile, makeClaimedDir } = require('../../utils/safe-write');

const itSymlink = process.platform === 'win32' ? test.skip : test;

let scratchDir;
let outputDir;

beforeEach(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-safe-write-'));
  outputDir = path.join(scratchDir, 'out');
  fs.mkdirSync(outputDir);
});

afterEach(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

describe('writeClaimedFile', () => {
  test('writes the plain name when it is free', () => {
    const written = writeClaimedFile(outputDir, 'report', 'md', null, 'hi');
    expect(written).toBe(path.join(outputDir, 'report.md'));
    expect(fs.readFileSync(written, 'utf8')).toBe('hi');
  });

  test('adds -1, -2 … on collision and leaves the originals alone', () => {
    fs.writeFileSync(path.join(outputDir, 'report.md'), 'first');
    fs.writeFileSync(path.join(outputDir, 'report-1.md'), 'second');

    const written = writeClaimedFile(outputDir, 'report', 'md', null, 'third');

    expect(written).toBe(path.join(outputDir, 'report-2.md'));
    expect(fs.readFileSync(path.join(outputDir, 'report.md'), 'utf8')).toBe(
      'first'
    );
    expect(fs.readFileSync(path.join(outputDir, 'report-1.md'), 'utf8')).toBe(
      'second'
    );
  });

  test('handles names without an extension', () => {
    fs.writeFileSync(path.join(outputDir, 'notes'), 'x');
    expect(writeClaimedFile(outputDir, 'notes', '', null, 'y')).toBe(
      path.join(outputDir, 'notes-1')
    );
  });

  test('skips names already claimed in the same batch', () => {
    const claimed = new Set([path.join(outputDir, 'report.md')]);
    expect(writeClaimedFile(outputDir, 'report', 'md', claimed, 'x')).toBe(
      path.join(outputDir, 'report-1.md')
    );
  });

  itSymlink('does not follow a dangling symlink at the target', () => {
    const victim = path.join(scratchDir, 'victim.txt');
    fs.symlinkSync(victim, path.join(outputDir, 'report.md'));

    const written = writeClaimedFile(outputDir, 'report', 'md', null, 'x');

    expect(written).toBe(path.join(outputDir, 'report-1.md'));
    expect(fs.existsSync(victim)).toBe(false);
  });

  test('refuses a base that would escape outputDir', () => {
    expect(() =>
      writeClaimedFile(outputDir, '../escaped', 'txt', null, 'x')
    ).toThrow(/outside outputDir/);
    expect(fs.existsSync(path.join(scratchDir, 'escaped.txt'))).toBe(false);
  });

  describe('when the write itself fails', () => {
    const realWrite = fs.writeFileSync;
    afterEach(() => jest.restoreAllMocks());

    function failAfterCreating(code, contents) {
      return (file) => {
        realWrite(file, contents);
        const error = new Error(`${code}: simulated`);
        error.code = code;
        throw error;
      };
    }

    test('removes the partial file and rethrows on a mid-write error', () => {
      jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementationOnce(failAfterCreating('ENOSPC', 'trunc'));

      expect(() =>
        writeClaimedFile(outputDir, 'report', 'md', null, 'full contents')
      ).toThrow(expect.objectContaining({ code: 'ENOSPC' }));
      expect(fs.existsSync(path.join(outputDir, 'report.md'))).toBe(false);
    });

    test('rethrows the write error even if the partial file is already gone', () => {
      const error = new Error('EIO: simulated');
      error.code = 'EIO';
      jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
        throw error;
      });

      expect(() =>
        writeClaimedFile(outputDir, 'report', 'md', null, 'x')
      ).toThrow(error);
    });

    test('never removes a file that was already there (EEXIST)', () => {
      jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementationOnce(failAfterCreating('EEXIST', 'planted'));

      const written = writeClaimedFile(outputDir, 'report', 'md', null, 'x');

      expect(written).toBe(path.join(outputDir, 'report-1.md'));
      expect(fs.readFileSync(path.join(outputDir, 'report.md'), 'utf8')).toBe(
        'planted'
      );
    });
  });
});

describe('makeClaimedDir', () => {
  test('creates a fresh directory, suffixing on collision', () => {
    expect(makeClaimedDir(outputDir, 'thread')).toBe(
      path.join(outputDir, 'thread')
    );
    expect(makeClaimedDir(outputDir, 'thread')).toBe(
      path.join(outputDir, 'thread-1')
    );
  });

  itSymlink('does not reuse a symlinked directory', () => {
    const elsewhere = path.join(scratchDir, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(outputDir, 'thread'));

    const dir = makeClaimedDir(outputDir, 'thread');

    expect(dir).toBe(path.join(outputDir, 'thread-1'));
    expect(fs.lstatSync(dir).isDirectory()).toBe(true);
  });

  test('refuses a base that would escape outputDir', () => {
    expect(() => makeClaimedDir(outputDir, '../escaped')).toThrow(
      /outside outputDir/
    );
  });
});
