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
