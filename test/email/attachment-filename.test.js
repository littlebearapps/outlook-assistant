// Regression tests for GHSA-755c-c45g-69rv: the attachment filename is chosen
// by the email sender, so `attachments action=download` must never let it
// escape `outputDir`, overwrite an existing file, or follow a planted symlink.

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { handleDownloadAttachment } = require('../../email/attachments');

let scratchDir;
let outputDir;

function mockAttachment(name, body = 'payload') {
  callGraphAPI.mockResolvedValueOnce({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name,
    contentType: 'text/plain',
    contentBytes: Buffer.from(body).toString('base64'),
  });
}

async function download() {
  const result = await handleDownloadAttachment({
    messageId: 'm1',
    attachmentId: 'a1',
    outputDir,
  });
  const match = result.content[0].text.match(/Saved to: (.+)$/m);
  return { result, savedPath: match ? match[1] : null };
}

function expectInsideOutputDir(savedPath) {
  expect(savedPath).not.toBeNull();
  expect(path.dirname(path.resolve(savedPath))).toBe(path.resolve(outputDir));
  expect(fs.existsSync(savedPath)).toBe(true);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue('test_token');
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-ghsa-'));
  outputDir = path.join(scratchDir, 'out', 'nested');
});

afterEach(() => {
  console.error.mockRestore();
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

describe('attachments download — sender-controlled filename (GHSA-755c)', () => {
  test.each([
    ['../../escaped.txt', 'escaped.txt'],
    ['..\\..\\escaped.txt', 'escaped.txt'],
    ['a/../../escaped.txt', 'escaped.txt'],
    ['/etc/escaped.txt', 'escaped.txt'],
    ['C:\\Windows\\escaped.txt', 'escaped.txt'],
  ])(
    'traversal name %j is saved inside outputDir as %j',
    async (name, base) => {
      mockAttachment(name);
      const { savedPath } = await download();

      expectInsideOutputDir(savedPath);
      expect(path.basename(savedPath)).toBe(base);
      expect(fs.existsSync(path.join(scratchDir, 'escaped.txt'))).toBe(false);
      expect(fs.existsSync(path.join(scratchDir, 'out', 'escaped.txt'))).toBe(
        false
      );
    }
  );

  test.each(['', '.', '..', '../', '...', '\u0000'])(
    'degenerate name %j falls back to "attachment"',
    async (name) => {
      mockAttachment(name);
      const { savedPath } = await download();

      expectInsideOutputDir(savedPath);
      expect(path.basename(savedPath)).toBe('attachment');
    }
  );

  test('leading dots are stripped so a sender cannot plant a dotfile', async () => {
    mockAttachment('.bashrc');
    const { savedPath } = await download();

    expectInsideOutputDir(savedPath);
    expect(path.basename(savedPath)).toBe('bashrc');
  });

  test('control characters are removed from the name', async () => {
    mockAttachment('re\u0007port\u001f.pdf');
    const { savedPath } = await download();

    expectInsideOutputDir(savedPath);
    expect(path.basename(savedPath)).toBe('report.pdf');
  });

  test('unicode look-alike dots and slashes stay inside outputDir', async () => {
    mockAttachment('\uff0e\uff0e\uff0fescaped.txt');
    const { savedPath } = await download();

    expectInsideOutputDir(savedPath);
  });

  test('an existing file is never overwritten', async () => {
    fs.mkdirSync(outputDir, { recursive: true });
    const existing = path.join(outputDir, 'invoice.pdf');
    fs.writeFileSync(existing, 'original');

    mockAttachment('invoice.pdf', 'attacker');
    const { savedPath } = await download();

    expectInsideOutputDir(savedPath);
    expect(savedPath).not.toBe(existing);
    expect(path.basename(savedPath)).toBe('invoice-1.pdf');
    expect(fs.readFileSync(existing, 'utf8')).toBe('original');
    expect(fs.readFileSync(savedPath, 'utf8')).toBe('attacker');
  });

  test('a planted symlink at the target name is not followed', async () => {
    fs.mkdirSync(outputDir, { recursive: true });
    const victim = path.join(scratchDir, 'victim.txt');
    fs.writeFileSync(victim, 'untouched');
    fs.symlinkSync(victim, path.join(outputDir, 'report.txt'));

    mockAttachment('report.txt', 'attacker');
    const { savedPath } = await download();

    expectInsideOutputDir(savedPath);
    expect(fs.lstatSync(savedPath).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(victim, 'utf8')).toBe('untouched');
  });

  test('a long name keeps its extension', async () => {
    mockAttachment(`${'a'.repeat(400)}.pdf`);
    const { savedPath } = await download();

    expectInsideOutputDir(savedPath);
    expect(path.basename(savedPath).endsWith('.pdf')).toBe(true);
    expect(path.basename(savedPath).length).toBeLessThanOrEqual(200);
  });
});
