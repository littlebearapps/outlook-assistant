// A batch export whose search matches nothing is an empty result, not an
// error (#275 follow-up); calling with neither emailIds nor searchQuery is.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleBatchExportEmails } = require('../../email/export');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

let tmpDir;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue('token');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-empty-export-'));
});

afterEach(() => {
  console.error.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('a search that matches nothing is a success saying so', async () => {
  callGraphAPI.mockResolvedValue({ value: [] });

  const result = await handleBatchExportEmails({
    searchQuery: { subject: 'no such subject' },
    outputDir: tmpDir,
  });

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toMatch(/No emails matched/);
  expect(fs.readdirSync(tmpDir)).toEqual([]);
});

test('neither emailIds nor searchQuery is an error', async () => {
  const result = await handleBatchExportEmails({ outputDir: tmpDir });

  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/Provide emailIds or searchQuery/);
  expect(callGraphAPI).not.toHaveBeenCalled();
});
