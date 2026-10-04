/**
 * Exported and downloaded files are private to the user: files are created
 * with mode 0600 and directories the server creates with 0700, whatever the
 * process umask. Directories that already existed keep their mode, and a
 * file replaced with overwrite: true keeps the mode it had.
 *
 * POSIX modes only, so the whole file is skipped on Windows.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  writeClaimedFile,
  writeExplicitFile,
  makeClaimedDir,
} = require('../../utils/safe-write');
const {
  handleExportEmail,
  handleBatchExportEmails,
} = require('../../email/export');
const { handleExportConversation } = require('../../email/conversations');
const { handleDownloadAttachment } = require('../../email/attachments');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

const describePosix = process.platform === 'win32' ? describe.skip : describe;

const modeOf = (p) => fs.statSync(p).mode & 0o777;

const MESSAGE = {
  id: 'msg-1',
  subject: 'Quarterly report',
  receivedDateTime: '2023-06-15T01:26:00Z',
  from: { emailAddress: { name: 'Alice', address: 'alice@corp.com' } },
  body: { contentType: 'text', content: 'hello' },
  hasAttachments: false,
};

let scratch;
let tmp;
let home;
let savedUmask;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue('test_token');
  callGraphAPI.mockResolvedValue(MESSAGE);
  scratch = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'oa-file-modes-'))
  );
  tmp = path.join(scratch, 'tmp');
  home = path.join(scratch, 'home');
  fs.mkdirSync(tmp, { mode: 0o755 });
  fs.mkdirSync(home);
  fs.chmodSync(tmp, 0o755);
  jest.spyOn(os, 'tmpdir').mockReturnValue(tmp);
  jest.spyOn(os, 'homedir').mockReturnValue(home);
  // Fully permissive: any private mode below must have been set explicitly.
  savedUmask = process.umask(0o000);
});

afterEach(() => {
  process.umask(savedUmask);
  console.error.mockRestore();
  os.tmpdir.mockRestore();
  os.homedir.mockRestore();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describePosix('safe-write file and directory modes', () => {
  test('writeClaimedFile creates 0600 files', () => {
    const file = writeClaimedFile(tmp, 'a', 'txt', null, 'x', 'utf8');
    expect(modeOf(file)).toBe(0o600);
  });

  test('writeExplicitFile creates a 0600 file and 0700 parents, leaving existing ones alone', () => {
    const target = path.join(tmp, 'new', 'deeper', 'x.md');
    writeExplicitFile(target, 'hello', { encoding: 'utf8' });
    expect(modeOf(target)).toBe(0o600);
    expect(modeOf(path.join(tmp, 'new'))).toBe(0o700);
    expect(modeOf(path.join(tmp, 'new', 'deeper'))).toBe(0o700);
    expect(modeOf(tmp)).toBe(0o755);
  });

  test('makeClaimedDir creates a 0700 directory', () => {
    const dir = makeClaimedDir(tmp, 'thread');
    expect(modeOf(dir)).toBe(0o700);
  });

  test('a restrictive umask still gives exactly 0600 and 0700', () => {
    process.umask(0o277);
    const file = writeClaimedFile(tmp, 'b', 'txt', null, 'x', 'utf8');
    const dir = makeClaimedDir(tmp, 'thread');
    expect(modeOf(file)).toBe(0o600);
    expect(modeOf(dir)).toBe(0o700);
  });

  test('overwrite: true keeps the replaced file’s mode', () => {
    const target = path.join(tmp, 'x.md');
    fs.writeFileSync(target, 'original');
    fs.chmodSync(target, 0o640);

    const result = writeExplicitFile(target, 'new', { overwrite: true });
    expect(result.replaced).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    expect(modeOf(target)).toBe(0o640);
  });
});

describePosix('tool output modes', () => {
  test('export target=message writes a 0600 file into a new 0700 directory', async () => {
    const outputDir = path.join(tmp, 'exports');
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      outputDir,
    });

    expect(result.isError).toBeUndefined();
    expect(modeOf(outputDir)).toBe(0o700);
    expect(modeOf(result._meta.filePath)).toBe(0o600);
  });

  test('export target=messages writes 0600 files into a new 0700 directory', async () => {
    const outputDir = path.join(tmp, 'batch');
    const result = await handleBatchExportEmails({
      target: 'messages',
      emailIds: [MESSAGE.id],
      format: 'json',
      outputDir,
    });

    expect(result.isError).toBeUndefined();
    expect(modeOf(outputDir)).toBe(0o700);
    const files = fs.readdirSync(outputDir);
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(modeOf(path.join(outputDir, name))).toBe(0o600);
    }
  });

  test('export target=conversation writes 0600 files into a new 0700 directory', async () => {
    callGraphAPI.mockResolvedValue({ value: [MESSAGE] });
    const outputDir = path.join(tmp, 'thread');
    const result = await handleExportConversation({
      conversationId: 'conv-1',
      format: 'markdown',
      outputDir,
    });

    expect(result.isError).toBeUndefined();
    expect(modeOf(outputDir)).toBe(0o700);
    const files = fs.readdirSync(outputDir);
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(modeOf(path.join(outputDir, name))).toBe(0o600);
    }
  });

  test('attachments download writes a 0600 file into a new 0700 directory', async () => {
    callGraphAPI.mockResolvedValue({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      contentBytes: Buffer.from('pdf').toString('base64'),
    });
    const outputDir = path.join(tmp, 'att');
    const result = await handleDownloadAttachment({
      messageId: 'm1',
      attachmentId: 'a1',
      outputDir,
    });

    expect(result.isError).toBeUndefined();
    expect(modeOf(outputDir)).toBe(0o700);
    expect(modeOf(path.join(outputDir, 'invoice.pdf'))).toBe(0o600);
  });
});
