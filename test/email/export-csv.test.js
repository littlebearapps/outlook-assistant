const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  handleExportEmail,
  handleBatchExportEmails,
} = require('../../email/export');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const mockAccessToken = 'test_token';

const mockEmail = {
  id: 'email-1',
  subject: 'Test Subject',
  from: { emailAddress: { name: 'Sender', address: 'sender@example.com' } },
  toRecipients: [
    { emailAddress: { name: 'Recipient', address: 'recipient@example.com' } },
  ],
  ccRecipients: [],
  receivedDateTime: '2024-06-15T10:00:00Z',
  isRead: true,
  importance: 'normal',
  hasAttachments: false,
  body: { content: 'Test body', contentType: 'text' },
};

const mockEmail2 = {
  ...mockEmail,
  id: 'email-2',
  subject: 'Second Email',
  from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
};

let tmpDir;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-csv-test-'));
});

afterEach(() => {
  console.error.mockRestore();
  // Clean up temp directory
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────
// handleExportEmail — CSV format
// ──────────────────────────────────────────────────
describe('handleExportEmail with CSV format', () => {
  it('should export a single email as CSV', async () => {
    callGraphAPI.mockResolvedValue(mockEmail);

    const result = await handleExportEmail({
      id: 'email-1',
      format: 'csv',
      savePath: tmpDir,
    });

    expect(result.content[0].text).toContain('Export Complete');

    // Find the CSV file
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.csv'));
    expect(files).toHaveLength(1);

    const csvContent = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
    const lines = csvContent.split('\n');

    // Header + 1 data row
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'id,subject,from,to,cc,receivedDateTime,isRead,importance,hasAttachments'
    );
    expect(lines[1]).toContain('email-1');
    expect(lines[1]).toContain('Test Subject');
    expect(lines[1]).toContain('sender@example.com');
  });

  it('should use .csv extension for CSV format', async () => {
    callGraphAPI.mockResolvedValue(mockEmail);

    await handleExportEmail({
      id: 'email-1',
      format: 'csv',
      savePath: tmpDir,
    });

    const files = fs.readdirSync(tmpDir);
    expect(files[0]).toMatch(/\.csv$/);
  });

  it('should reject unknown format with dynamic format list', async () => {
    callGraphAPI.mockResolvedValue(mockEmail);

    const result = await handleExportEmail({
      id: 'email-1',
      format: 'xml',
      savePath: tmpDir,
    });

    expect(result.content[0].text).toContain('Unknown format: xml');
    expect(result.content[0].text).toContain('csv');
  });

  it('should protect against CSV injection in exported file', async () => {
    const maliciousEmail = {
      ...mockEmail,
      subject: '=CMD("cmd","/C calc")',
    };
    callGraphAPI.mockResolvedValue(maliciousEmail);

    await handleExportEmail({
      id: 'email-1',
      format: 'csv',
      savePath: tmpDir,
    });

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.csv'));
    const csvContent = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');

    // Should have single-quote prefix for formula injection protection
    expect(csvContent).toContain("'=CMD");
    // Should NOT have raw =CMD at start of a field
    expect(csvContent).not.toMatch(/,=CMD/);
  });
});

// ──────────────────────────────────────────────────
// handleBatchExportEmails — CSV format
// ──────────────────────────────────────────────────
describe('handleBatchExportEmails with CSV format', () => {
  it('should aggregate multiple emails into a single CSV file', async () => {
    // First call returns email-1, second returns email-2
    callGraphAPI
      .mockResolvedValueOnce(mockEmail)
      .mockResolvedValueOnce(mockEmail2);

    const result = await handleBatchExportEmails({
      emailIds: ['email-1', 'email-2'],
      format: 'csv',
      outputDir: tmpDir,
    });

    expect(result.content[0].text).toContain('Batch Export Complete');
    expect(result._meta.successful).toBe(2);

    // Should create exactly ONE CSV file, not two
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.csv'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^batch_export_/);

    // File should have header + 2 data rows
    const csvContent = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
    const lines = csvContent.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toBe(
      'id,subject,from,to,cc,receivedDateTime,isRead,importance,hasAttachments'
    );
    expect(lines[1]).toContain('email-1');
    expect(lines[2]).toContain('email-2');
  });

  it('should report correct byte size in metadata', async () => {
    callGraphAPI.mockResolvedValue(mockEmail);

    const result = await handleBatchExportEmails({
      emailIds: ['email-1'],
      format: 'csv',
      outputDir: tmpDir,
    });

    expect(result._meta.totalBytes).toBeGreaterThan(0);

    // Verify reported size matches actual file size
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.csv'));
    const actualSize = Buffer.byteLength(
      fs.readFileSync(path.join(tmpDir, files[0]), 'utf8'),
      'utf8'
    );
    expect(result._meta.totalBytes).toBe(actualSize);
  });

  it('should handle partial failures gracefully', async () => {
    callGraphAPI
      .mockResolvedValueOnce(mockEmail)
      .mockRejectedValueOnce(new Error('Email not found'));

    const result = await handleBatchExportEmails({
      emailIds: ['email-1', 'email-missing'],
      format: 'csv',
      outputDir: tmpDir,
    });

    expect(result._meta.successful).toBe(1);
    expect(result._meta.failed).toBe(1);
    expect(result.content[0].text).toContain('Failed Exports');

    // CSV should still contain the successful email
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.csv'));
    const csvContent = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
    const lines = csvContent.split('\n');
    expect(lines).toHaveLength(2); // header + 1 successful row
  });

  it('should require outputDir', async () => {
    const result = await handleBatchExportEmails({
      emailIds: ['email-1'],
      format: 'csv',
    });

    expect(result.content[0].text).toBe('Output directory is required.');
  });

  it('should create output directory if it does not exist', async () => {
    const nestedDir = path.join(tmpDir, 'nested', 'output');
    callGraphAPI.mockResolvedValue(mockEmail);

    await handleBatchExportEmails({
      emailIds: ['email-1'],
      format: 'csv',
      outputDir: nestedDir,
    });

    expect(fs.existsSync(nestedDir)).toBe(true);
    const files = fs.readdirSync(nestedDir).filter((f) => f.endsWith('.csv'));
    expect(files).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────
// handleBatchExportEmails — searchQuery request (#263)
//
// The search used to send `from:`/`subject:` as one quoted `$search` phrase,
// so Graph matched the literal text "from:alice subject:invoice" rather than
// the two fields, and a date window added a `$filter` that Graph rejects next
// to `$search` (400 SearchWithFilter). It now builds one `$filter`, the same
// predicates search-emails uses, with the date first so `$orderby` is allowed.
// ──────────────────────────────────────────────────
describe('handleBatchExportEmails searchQuery request (#263)', () => {
  function searchParams() {
    const call = callGraphAPI.mock.calls.find(
      ([, , endpoint, , p]) => p && p.$select === 'id' && endpoint
    );
    return call && call[4];
  }

  it('matches from and subject as separate fields, never as one $search phrase', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    await handleBatchExportEmails({
      searchQuery: { from: 'alice@example.com', subject: 'big invoice' },
      format: 'csv',
      outputDir: tmpDir,
    });

    const params = searchParams();
    expect(params.$search).toBeUndefined();
    expect(params.$filter).toBe(
      "receivedDateTime ge 1900-01-01T00:00:00Z and from/emailAddress/address eq 'alice@example.com' and contains(subject, 'big invoice')"
    );
    expect(params.$orderby).toBe('receivedDateTime desc');
  });

  it('puts the date window first and keeps it with the field filters', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    await handleBatchExportEmails({
      searchQuery: {
        from: 'alice',
        subject: 'Invoice',
        receivedAfter: '2026-01-01T00:00:00Z',
        receivedBefore: '2026-02-01T00:00:00Z',
      },
      format: 'csv',
      outputDir: tmpDir,
    });

    const params = searchParams();
    expect(params.$search).toBeUndefined();
    expect(params.$filter).toBe(
      'receivedDateTime ge 2026-01-01T00:00:00.000Z and receivedDateTime le 2026-02-01T00:00:00.000Z' +
        " and (contains(from/emailAddress/name, 'alice') or contains(from/emailAddress/address, 'alice'))" +
        " and contains(subject, 'Invoice')"
    );
  });

  it('matches a bare domain sender by address', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    await handleBatchExportEmails({
      searchQuery: { from: 'example.com' },
      format: 'csv',
      outputDir: tmpDir,
    });

    expect(searchParams().$filter).toContain(
      "contains(from/emailAddress/address, 'example.com')"
    );
  });

  it('escapes single quotes in the values', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    await handleBatchExportEmails({
      searchQuery: { from: "o'brien@example.com", subject: "it's due" },
      format: 'csv',
      outputDir: tmpDir,
    });

    const filter = searchParams().$filter;
    expect(filter).toContain(
      "from/emailAddress/address eq 'o''brien@example.com'"
    );
    expect(filter).toContain("contains(subject, 'it''s due')");
  });

  it('exports exactly the messages the search returned', async () => {
    callGraphAPI.mockImplementation((_t, _m, endpoint, _d, params) => {
      if (params && params.$select === 'id') {
        return Promise.resolve({ value: [{ id: 'email-2' }] });
      }
      return Promise.resolve(
        endpoint.includes('email-2') ? mockEmail2 : mockEmail
      );
    });

    const result = await handleBatchExportEmails({
      searchQuery: { from: 'alice@example.com', subject: 'Second' },
      format: 'csv',
      outputDir: tmpDir,
    });

    expect(result.isError).toBeUndefined();
    const csv = fs
      .readdirSync(tmpDir)
      .filter((f) => f.endsWith('.csv'))
      .map((f) => fs.readFileSync(path.join(tmpDir, f), 'utf8'))
      .join('\n');
    expect(csv).toContain('Second Email');
    expect(csv).not.toContain('Test Subject');
  });
});
