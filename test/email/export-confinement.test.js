/**
 * Export writes must stay inside the chosen output directory, never overwrite
 * an existing file, and never follow a symlink — for the message file and for
 * saved attachments (same guarantees as GHSA-755c-c45g-69rv gave the
 * `attachments` tool). Graph is mocked; these assert on what lands on disk.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  handleExportEmail,
  handleBatchExportEmails,
} = require('../../email/export');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

const MESSAGE = {
  id: 'AAMkAGI2REAL',
  subject: 'Quarterly report',
  receivedDateTime: '2023-06-15T01:26:00Z',
  from: { emailAddress: { name: 'Alice', address: 'alice@corp.com' } },
  body: { contentType: 'text', content: 'hello' },
  hasAttachments: true,
};
const MESSAGE_FILE = '2023-06-15T01-26-00_Quarterly_report.json';
const itSymlink = process.platform === 'win32' ? test.skip : test;

let base; // scratch root
let outputDir; // base/a/b/out — two levels of headroom to detect escapes

function mockGraph(attachmentName) {
  callGraphAPI.mockImplementation((_token, _method, endpoint) => {
    if (endpoint.endsWith('/attachments')) {
      return Promise.resolve({
        value: [
          {
            id: 'att-1',
            name: attachmentName,
            contentBytes: Buffer.from('payload').toString('base64'),
            size: 7,
            contentType: 'application/octet-stream',
          },
        ],
      });
    }
    return Promise.resolve(MESSAGE);
  });
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

function tagFor(id) {
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 8);
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue('test_token');
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-export-confine-'));
  outputDir = path.join(base, 'a', 'b', 'out');
  fs.mkdirSync(outputDir, { recursive: true });
});

afterEach(() => {
  console.error.mockRestore();
  fs.rmSync(base, { recursive: true, force: true });
});

describe('export — attachment and message writes are confined', () => {
  test('a traversal-shaped emailId cannot move attachments out of outputDir', async () => {
    mockGraph('invoice.pdf');
    await handleBatchExportEmails({
      target: 'messages',
      emailIds: ['../../me/messages/REALID'],
      format: 'json',
      outputDir,
      includeAttachments: true,
    });

    const written = filesUnder(base);
    expect(written.length).toBe(2);
    for (const file of written) {
      expect(path.dirname(file)).toBe(outputDir);
    }
    expect(written.some((f) => path.basename(f).endsWith('_invoice.pdf'))).toBe(
      true
    );
  });

  test.each([
    '../../.bashrc',
    '..\\..\\evil.sh',
    '/etc/passwd',
    '....//....//x.txt',
  ])(
    'a malicious attachment name (%s) is reduced to a basename',
    async (name) => {
      mockGraph(name);
      await handleExportEmail({ id: MESSAGE.id, format: 'json', outputDir });

      const written = filesUnder(base);
      expect(written.length).toBe(2);
      for (const file of written) {
        expect(path.dirname(file)).toBe(outputDir);
        expect(path.basename(file).startsWith('.')).toBe(false);
      }
    }
  );

  test('never overwrites an existing message file or attachment', async () => {
    mockGraph('invoice.pdf');
    const existingMessage = path.join(outputDir, MESSAGE_FILE);
    const existingAttachment = path.join(
      outputDir,
      `${tagFor(MESSAGE.id)}_invoice.pdf`
    );
    fs.writeFileSync(existingMessage, 'keep me');
    fs.writeFileSync(existingAttachment, 'keep me too');

    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      outputDir,
    });

    expect(fs.readFileSync(existingMessage, 'utf8')).toBe('keep me');
    expect(fs.readFileSync(existingAttachment, 'utf8')).toBe('keep me too');
    expect(result._meta.filePath).not.toBe(existingMessage);
    expect(fs.readdirSync(outputDir)).toHaveLength(4);
  });

  itSymlink(
    'does not follow a planted dangling symlink (message or attachment)',
    async () => {
      mockGraph('invoice.pdf');
      const target = path.join(base, 'victim.txt');
      fs.symlinkSync(target, path.join(outputDir, MESSAGE_FILE));
      fs.symlinkSync(
        target,
        path.join(outputDir, `${tagFor(MESSAGE.id)}_invoice.pdf`)
      );

      await handleBatchExportEmails({
        target: 'messages',
        emailIds: [MESSAGE.id],
        format: 'json',
        outputDir,
        includeAttachments: true,
      });

      expect(fs.existsSync(target)).toBe(false);
      // Two planted links plus the two real files under new names.
      expect(fs.readdirSync(outputDir)).toHaveLength(4);
    }
  );
});
