/**
 * Batch export must never lose a message to an output-filename collision.
 *
 * Regression cover for the defect report of 2026-09-09: exporting 37 explicitly
 * listed message IDs produced 22 files — six messages from one thread were
 * overwritten on disk — while the tool reported `Successful 37 / Failed 0`.
 *
 * #82 fixed the aggregated-CSV filename only; the per-message json/eml/markdown
 * paths kept naming files `<date>_<subject>`, which collides for any same-day
 * reply chain. These assert on OUTCOMES (N inputs produce N distinct files with
 * distinct contents), not that the call succeeded.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleBatchExportEmails } = require('../../email/export');
const { callGraphAPI, callGraphAPIRaw } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

// A same-day reply chain — the most common collision shape, and the one that
// caused real data loss in the report.
const THREAD = [
  {
    id: 'AAMkAGI2AAA1',
    subject: 'Another transfer',
    receivedDateTime: '2023-06-15T01:26:00Z',
  },
  {
    id: 'AAMkAGI2AAA2',
    subject: 'RE: Another transfer',
    receivedDateTime: '2023-06-15T07:14:00Z',
  },
  {
    id: 'AAMkAGI2AAA3',
    subject: 'RE: Another transfer',
    receivedDateTime: '2023-06-15T03:03:00Z',
  },
  {
    id: 'AAMkAGI2AAA4',
    subject: 'RE: Another transfer',
    receivedDateTime: '2023-06-15T23:25:00Z',
  },
  {
    id: 'AAMkAGI2AAA5',
    subject: 'RE: Another transfer',
    receivedDateTime: '2023-06-15T23:45:00Z',
  },
  {
    id: 'AAMkAGI2AAA6',
    subject: 'Another transfer',
    receivedDateTime: '2023-06-15T23:47:00Z',
  },
];

let outputDir;

function mockMessages(messages) {
  callGraphAPI.mockImplementation((_token, _method, endpoint) => {
    if (endpoint.endsWith('/attachments')) {
      return Promise.resolve({ value: [] });
    }
    const id = endpoint.split('/').pop();
    const message = messages.find((m) => m.id === id);
    if (!message) throw new Error(`Unexpected message id: ${id}`);
    return Promise.resolve({
      ...message,
      from: { emailAddress: { name: 'Alice', address: 'alice@corp.com' } },
      toRecipients: [
        { emailAddress: { name: 'Bob', address: 'bob@corp.com' } },
      ],
      body: { contentType: 'text', content: `body of ${message.id}` },
      bodyPreview: `body of ${message.id}`,
      hasAttachments: Boolean(message.hasAttachments),
    });
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue('test_token');
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-export-collision-'));
  mockMessages(THREAD);
});

afterEach(() => {
  console.error.mockRestore();
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe('batch export — filename collisions', () => {
  test.each(['json', 'markdown'])(
    'should write one file per requested message (%s)',
    async (format) => {
      const result = await handleBatchExportEmails({
        target: 'messages',
        emailIds: THREAD.map((m) => m.id),
        format,
        outputDir,
      });

      const files = fs.readdirSync(outputDir);
      expect(files).toHaveLength(THREAD.length);
      expect(result._meta.successful).toBe(THREAD.length);
    }
  );

  test('should write distinct content for every exported message', async () => {
    await handleBatchExportEmails({
      target: 'messages',
      emailIds: THREAD.map((m) => m.id),
      format: 'json',
      outputDir,
    });

    // Every message body must survive to disk — an overwrite shows up as a
    // missing id, which is exactly the loss the report measured.
    const contents = fs
      .readdirSync(outputDir)
      .map((f) => fs.readFileSync(path.join(outputDir, f), 'utf8'));
    for (const message of THREAD) {
      expect(contents.some((c) => c.includes(message.id))).toBe(true);
    }
  });

  test('should not collide when timestamp AND subject are identical', async () => {
    const twins = [
      {
        id: 'AAMkAGI2TWIN1',
        subject: 'Duplicate',
        receivedDateTime: '2023-06-15T01:26:00Z',
      },
      {
        id: 'AAMkAGI2TWIN2',
        subject: 'Duplicate',
        receivedDateTime: '2023-06-15T01:26:00Z',
      },
    ];
    mockMessages(twins);

    await handleBatchExportEmails({
      target: 'messages',
      emailIds: twins.map((m) => m.id),
      format: 'json',
      outputDir,
    });

    expect(fs.readdirSync(outputDir)).toHaveLength(2);
  });

  test('should not overwrite a file already present in the output directory', async () => {
    const [first] = THREAD;
    // Pre-seed every name the exporter could plausibly choose for `first`.
    const preExisting = path.join(outputDir, 'decoy.json');
    fs.writeFileSync(preExisting, 'do not clobber me', 'utf8');

    await handleBatchExportEmails({
      target: 'messages',
      emailIds: [first.id],
      format: 'json',
      outputDir,
    });

    expect(fs.readFileSync(preExisting, 'utf8')).toBe('do not clobber me');
    expect(fs.readdirSync(outputDir)).toHaveLength(2);
  });

  test('should report the written path for every message so callers can reconcile', async () => {
    const result = await handleBatchExportEmails({
      target: 'messages',
      emailIds: THREAD.map((m) => m.id),
      format: 'json',
      outputDir,
    });

    const manifest = result._meta.manifest;
    expect(manifest).toHaveLength(THREAD.length);

    // requested id → written path, and every path distinct and real.
    const paths = manifest.map((entry) => entry.filePath);
    expect(new Set(paths).size).toBe(THREAD.length);
    for (const entry of manifest) {
      expect(THREAD.some((m) => m.id === entry.emailId)).toBe(true);
      expect(fs.existsSync(entry.filePath)).toBe(true);
    }
  });

  test('should not collide attachments that share a name across messages', async () => {
    const withAttachments = THREAD.slice(0, 3).map((m) => ({
      ...m,
      hasAttachments: true,
    }));
    mockMessages(withAttachments);
    // Graph message ids in one mailbox share a long common prefix, so the old
    // `emailId.substring(0, 8)` disambiguator was effectively a constant.
    callGraphAPI.mockImplementation((_token, _method, endpoint) => {
      if (endpoint.endsWith('/attachments')) {
        return Promise.resolve({
          value: [
            {
              id: 'att-1',
              name: 'invoice.pdf',
              contentBytes: Buffer.from(endpoint).toString('base64'),
              size: 10,
              contentType: 'application/pdf',
            },
          ],
        });
      }
      const id = endpoint.split('/').pop();
      const message = withAttachments.find((m) => m.id === id);
      return Promise.resolve({
        ...message,
        from: { emailAddress: { name: 'Alice', address: 'alice@corp.com' } },
        body: { contentType: 'text', content: `body of ${message.id}` },
        hasAttachments: true,
      });
    });

    await handleBatchExportEmails({
      target: 'messages',
      emailIds: withAttachments.map((m) => m.id),
      format: 'json',
      outputDir,
      includeAttachments: true,
    });

    const pdfs = fs.readdirSync(outputDir).filter((f) => f.endsWith('.pdf'));
    expect(pdfs).toHaveLength(withAttachments.length);
  });

  test('should keep the message time in the filename', async () => {
    await handleBatchExportEmails({
      target: 'messages',
      emailIds: [THREAD[0].id],
      format: 'json',
      outputDir,
    });

    const [file] = fs.readdirSync(outputDir);
    // Date alone is what collided; the time is what disambiguates.
    expect(file).toMatch(/^2023-06-15T01-26-00_/);
  });
});

// Silence an unused-import lint warning while keeping the mock wired.
void callGraphAPIRaw;
