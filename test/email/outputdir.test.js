// outputDir handling regression tests for #165 (F-19, F-27, F-29).

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const { callGraphAPI, callGraphAPIRaw } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { handleDownloadAttachment } = require('../../email/attachments');
const { handleExportEmail } = require('../../email/export');

const mockAccessToken = 'test_token';
let scratchDir;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-e2e-'));
});

afterEach(() => {
  console.error.mockRestore();
  if (scratchDir && fs.existsSync(scratchDir)) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe('attachments download — F-19 outputDir honoured + auto-created', () => {
  test('honours outputDir param', async () => {
    callGraphAPI.mockResolvedValueOnce({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      contentBytes: Buffer.from('hello').toString('base64'),
    });

    const target = path.join(scratchDir, 'attachments');
    const result = await handleDownloadAttachment({
      messageId: 'm1',
      attachmentId: 'a1',
      outputDir: target,
    });

    const expected = path.join(target, 'invoice.pdf');
    expect(fs.existsSync(expected)).toBe(true);
    expect(result.content[0].text).toContain(expected);
  });

  test('accepts savePath as deprecated alias', async () => {
    callGraphAPI.mockResolvedValueOnce({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'doc.txt',
      contentBytes: Buffer.from('data').toString('base64'),
    });

    const target = path.join(scratchDir, 'legacy');
    await handleDownloadAttachment({
      messageId: 'm1',
      attachmentId: 'a1',
      savePath: target,
    });

    expect(fs.existsSync(path.join(target, 'doc.txt'))).toBe(true);
  });

  test('auto-creates the output directory if missing', async () => {
    callGraphAPI.mockResolvedValueOnce({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'file.bin',
      contentBytes: Buffer.from('x').toString('base64'),
    });

    const target = path.join(scratchDir, 'a/b/c/deeply/nested');
    expect(fs.existsSync(target)).toBe(false);

    await handleDownloadAttachment({
      messageId: 'm1',
      attachmentId: 'a1',
      outputDir: target,
    });

    expect(fs.existsSync(target)).toBe(true);
  });
});

describe('export single message — F-27 outputDir honoured', () => {
  test('honours outputDir for target=message', async () => {
    callGraphAPI.mockResolvedValueOnce({
      id: 'msg-1',
      subject: 'Test Email',
      receivedDateTime: '2026-05-05T10:00:00Z',
      from: { emailAddress: { address: 'sender@example.com' } },
      hasAttachments: false,
    });
    callGraphAPIRaw.mockResolvedValueOnce('Subject: Test\n\nbody');

    const target = path.join(scratchDir, 'exports');
    const result = await handleExportEmail({
      id: 'msg-1',
      format: 'eml',
      outputDir: target,
    });

    expect(fs.existsSync(target)).toBe(true);
    expect(result.content[0].text).toContain(target);
    expect(result.content[0].text).not.toContain(`${os.tmpdir()}/2026-`);
  });

  test('accepts savePath alias for backwards compat', async () => {
    callGraphAPI.mockResolvedValueOnce({
      id: 'msg-1',
      subject: 'Legacy Path',
      receivedDateTime: '2026-05-05T10:00:00Z',
      from: { emailAddress: { address: 'sender@example.com' } },
      hasAttachments: false,
    });

    const target = path.join(scratchDir, 'legacy-export');
    const result = await handleExportEmail({
      id: 'msg-1',
      format: 'json',
      savePath: target,
    });

    expect(fs.existsSync(target)).toBe(true);
    expect(result.content[0].text).toContain(target);
  });
});
