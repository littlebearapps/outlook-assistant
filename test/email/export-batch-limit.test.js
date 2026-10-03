// #279: target=messages exports at most 100 messages per call, and a search
// stops at searchQuery.maxResults. Both used to cut the batch silently; the
// result now says so and how to get the rest.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleBatchExportEmails } = require('../../email/export');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

let tmpDir;

const ids = (n) => Array.from({ length: n }, (_, i) => `id-${i + 1}`);
const message = (id) => ({
  id,
  subject: `Subject ${id}`,
  receivedDateTime: '2026-09-01T00:00:00Z',
  from: { emailAddress: { name: 'A', address: 'a@example.com' } },
  body: { contentType: 'text', content: 'body' },
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue('token');
  callGraphAPI.mockImplementation(async (_token, _method, endpoint) =>
    message(endpoint.split('/').pop())
  );
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-batch-'));
});

afterEach(() => {
  console.error.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test.each(['csv', 'json'])(
  'more than 100 emailIds (%s) exports 100 and says so',
  async (format) => {
    const result = await handleBatchExportEmails({
      emailIds: ids(250),
      format,
      outputDir: tmpDir,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(
      'Exported the first 100 of 250 requested messages (limit 100 per call)'
    );
    expect(text).toContain('150');
    expect(callGraphAPI).toHaveBeenCalledTimes(100);
  }
);

test('100 or fewer emailIds carry no limit note', async () => {
  const result = await handleBatchExportEmails({
    emailIds: ids(3),
    format: 'csv',
    outputDir: tmpDir,
  });
  expect(result.content[0].text).not.toMatch(/per call/);
});

test('a search that fills maxResults says more may match', async () => {
  callGraphAPI.mockImplementation(async (_token, _method, endpoint) =>
    endpoint.endsWith('/messages')
      ? { value: ids(25).map((id) => ({ id })) }
      : message(endpoint.split('/').pop())
  );

  const result = await handleBatchExportEmails({
    searchQuery: { folder: 'inbox', subject: 'invoice' },
    format: 'csv',
    outputDir: tmpDir,
  });

  const text = result.content[0].text;
  expect(text).toMatch(/searchQuery\.maxResults/);
  expect(text).toMatch(/more may match/);
  expect(text).toMatch(/receivedAfter/);
});

test('a search under maxResults carries no limit note', async () => {
  callGraphAPI.mockImplementation(async (_token, _method, endpoint) =>
    endpoint.endsWith('/messages')
      ? { value: ids(3).map((id) => ({ id })) }
      : message(endpoint.split('/').pop())
  );

  const result = await handleBatchExportEmails({
    searchQuery: { folder: 'inbox', subject: 'invoice' },
    format: 'csv',
    outputDir: tmpDir,
  });
  expect(result.content[0].text).not.toMatch(/maxResults/);
});
