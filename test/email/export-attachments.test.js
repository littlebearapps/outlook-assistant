/**
 * export includeAttachments (#365): the attachments list is requested
 * without a $select (Graph rejects `contentBytes` on the base attachment
 * type with a 400), and a failed or skipped attachment is reported in the
 * result instead of disappearing into a debug line.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

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
  id: 'msg-1',
  subject: 'Invoice attached',
  receivedDateTime: '2026-10-15T01:26:00Z',
  from: { emailAddress: { name: 'Alice', address: 'alice@corp.com' } },
  body: { contentType: 'text', content: 'see attached' },
  hasAttachments: true,
};

const FILE = {
  '@odata.type': '#microsoft.graph.fileAttachment',
  id: 'att-1',
  name: 'invoice.pdf',
  contentType: 'application/pdf',
  size: 3,
  contentBytes: Buffer.from('pdf').toString('base64'),
};

const ITEM = {
  '@odata.type': '#microsoft.graph.itemAttachment',
  id: 'att-2',
  name: 'Forwarded message',
  size: 900,
};

let outDir;

/** Routes the message GET and the attachments GET; records the calls. */
function mockGraph({ attachments, attachmentsError } = {}) {
  callGraphAPI.mockImplementation(async (token, method, endpoint) => {
    if (endpoint.endsWith('/attachments')) {
      if (attachmentsError) throw attachmentsError;
      return { value: attachments };
    }
    return MESSAGE;
  });
}

function attachmentCalls() {
  return callGraphAPI.mock.calls.filter(([, , endpoint]) =>
    endpoint.endsWith('/attachments')
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue('token');
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-export-att-'));
});

afterEach(() => {
  console.error.mockRestore();
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe('target=message includeAttachments (#365)', () => {
  test('requests the attachments without selecting contentBytes', async () => {
    mockGraph({ attachments: [FILE] });
    await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      outputDir: outDir,
    });

    const calls = attachmentCalls();
    expect(calls).toHaveLength(1);
    const params = calls[0][4];
    expect(JSON.stringify(params || {})).not.toMatch(/contentBytes/);
  });

  test('saves a file attachment and lists it', async () => {
    mockGraph({ attachments: [FILE] });
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      outputDir: outDir,
    });

    expect(result.isError).toBeUndefined();
    expect(result._meta.attachmentsSaved).toBe(1);
    expect(result.content[0].text).toMatch(/Attachments \(1\)/);
    const saved = fs.readdirSync(outDir).filter((f) => f.endsWith('.pdf'));
    expect(saved).toHaveLength(1);
    expect(fs.readFileSync(path.join(outDir, saved[0]), 'utf8')).toBe('pdf');
  });

  test('says so when the attachments could not be read', async () => {
    mockGraph({ attachmentsError: new Error('Graph 400: bad request') });
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      outputDir: outDir,
    });

    // The message itself was exported, so this is not an error result...
    expect(result.isError).toBeUndefined();
    expect(result._meta.attachmentsSaved).toBe(0);
    // ...but the caller is told the attachments are missing.
    expect(result._meta.attachmentsError).toMatch(/400/);
    expect(result.content[0].text).toMatch(/attachments were not saved/i);
  });

  test('lists attachments that are not files as skipped', async () => {
    mockGraph({ attachments: [FILE, ITEM] });
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      outputDir: outDir,
    });

    expect(result._meta.attachmentsSaved).toBe(1);
    expect(result._meta.attachmentsSkipped).toEqual(['Forwarded message']);
    expect(result.content[0].text).toMatch(/Forwarded message/);
    expect(result.content[0].text).toMatch(/not saved/i);
  });

  test('says nothing extra when every attachment was saved', async () => {
    mockGraph({ attachments: [FILE] });
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      outputDir: outDir,
    });

    expect(result._meta.attachmentsError).toBeUndefined();
    expect(result._meta.attachmentsSkipped).toBeUndefined();
    expect(result.content[0].text).not.toMatch(/not saved/i);
  });
});

describe('target=messages includeAttachments (#365)', () => {
  test('saves attachments and reports a failed attachment read', async () => {
    mockGraph({ attachments: [FILE] });
    const ok = await handleBatchExportEmails({
      emailIds: [MESSAGE.id],
      format: 'json',
      outputDir: outDir,
      includeAttachments: true,
    });
    expect(ok._meta.successful).toBe(1);
    expect(ok._meta.attachmentsSaved).toBe(1);
    expect(fs.readdirSync(outDir).some((f) => f.endsWith('.pdf'))).toBe(true);

    mockGraph({ attachmentsError: new Error('Graph 400: bad request') });
    const bad = await handleBatchExportEmails({
      emailIds: [MESSAGE.id],
      format: 'json',
      outputDir: outDir,
      includeAttachments: true,
    });
    expect(bad._meta.successful).toBe(1);
    expect(bad._meta.attachmentErrors).toEqual([
      { emailId: MESSAGE.id, error: expect.stringMatching(/400/) },
    ]);
    expect(bad.content[0].text).toMatch(/attachments were not saved/i);
  });
});
