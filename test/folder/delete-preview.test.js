/**
 * folders delete dryRun with the real resolver (#274): one read of the
 * folder, and a readable name even when Graph leaves displayName out.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const handleDeleteFolder = require('../../folder/delete');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

const folderReads = (id) =>
  callGraphAPI.mock.calls.filter(
    ([, method, path]) => method === 'GET' && path === `me/mailFolders/${id}`
  );

beforeEach(() => {
  jest.resetAllMocks();
  ensureAuthenticated.mockResolvedValue('token');
});

test('reads the folder once when addressed by ID', async () => {
  callGraphAPI.mockResolvedValue({
    id: 'fid-1',
    displayName: 'Old',
    totalItemCount: 4,
    unreadItemCount: 1,
    childFolderCount: 0,
  });

  const result = await handleDeleteFolder({ folderId: 'fid-1', dryRun: true });

  expect(folderReads('fid-1')).toHaveLength(1);
  expect(result.content[0].text).toContain(
    "Deletes folder 'Old' and everything in it: 4 items (1 unread)."
  );
  expect(result._meta).toMatchObject({ dryRun: true, items: 4 });
});

test('never prints "undefined" when Graph returns no displayName or id', async () => {
  callGraphAPI.mockResolvedValue({ totalItemCount: 0, childFolderCount: 0 });

  const result = await handleDeleteFolder({ folderId: 'fid-1', dryRun: true });

  const text = result.content[0].text;
  expect(text).not.toContain('undefined');
  expect(text).toContain('fid-1');
});

test('a real delete of an unnamed folder never says "undefined"', async () => {
  callGraphAPI.mockResolvedValue({});

  const result = await handleDeleteFolder({ folderId: 'fid-1' });

  expect(result.content[0].text).not.toContain('undefined');
  expect(result.content[0].text).toContain('fid-1');
});
