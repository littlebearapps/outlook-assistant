const {
  handleListFolders,
  handleCreateFolder,
  handleMoveEmails,
  handleGetFolderStats,
} = require('../../folder');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { getFolderIdByName } = require('../../email/folder-utils');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
jest.mock('../../email/folder-utils');

const mockAccessToken = 'test_token';

const mockFolders = [
  {
    id: 'folder-1',
    displayName: 'Inbox',
    parentFolderId: 'root',
    childFolderCount: 0,
    totalItemCount: 42,
    unreadItemCount: 5,
  },
  {
    id: 'folder-2',
    displayName: 'Sent Items',
    parentFolderId: 'root',
    childFolderCount: 0,
    totalItemCount: 100,
    unreadItemCount: 0,
  },
];

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
});

afterEach(() => {
  console.error.mockRestore();
});

describe('handleListFolders', () => {
  it('should list folders as flat list', async () => {
    callGraphAPI.mockResolvedValue({ value: mockFolders });

    const result = await handleListFolders({});

    expect(result.content[0].text).toContain('Found 2 folders');
    expect(result.content[0].text).toContain('Inbox');
    expect(result.content[0].text).toContain('Sent Items');
  });

  it('should include item counts when requested', async () => {
    callGraphAPI.mockResolvedValue({ value: mockFolders });

    const result = await handleListFolders({ includeItemCounts: true });

    expect(result.content[0].text).toContain('42 items');
    expect(result.content[0].text).toContain('5 unread');
  });

  it('should format as hierarchy when requested', async () => {
    callGraphAPI.mockResolvedValue({ value: mockFolders });

    const result = await handleListFolders({ includeChildren: true });

    expect(result.content[0].text).toContain('Folder Hierarchy');
  });

  it('should handle empty folders', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleListFolders({});

    expect(result.content[0].text).toContain('No folders found');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleListFolders({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('API Error'));

    const result = await handleListFolders({});

    expect(result.content[0].text).toBe('Error listing folders: API Error');
  });
});

describe('handleCreateFolder', () => {
  it('should create a folder at root level', async () => {
    getFolderIdByName.mockResolvedValueOnce(null); // No existing folder
    callGraphAPI.mockResolvedValue({ id: 'new-folder-id' });

    const result = await handleCreateFolder({ name: 'My Folder' });

    expect(result.content[0].text).toContain('Successfully created folder');
    expect(result.content[0].text).toContain('My Folder');
    expect(result.content[0].text).toContain('root level');
  });

  it('should include the new folder ID in response (F-31)', async () => {
    getFolderIdByName.mockResolvedValueOnce(null);
    callGraphAPI.mockResolvedValue({ id: 'new-folder-id-12345' });

    const result = await handleCreateFolder({ name: 'WithId' });

    expect(result.content[0].text).toMatch(/\*\*ID\*\*: new-folder-id-12345/);
    expect(result._meta.folderId).toBe('new-folder-id-12345');
  });

  it('should create a folder inside a parent', async () => {
    getFolderIdByName
      .mockResolvedValueOnce(null) // No existing folder with same name
      .mockResolvedValueOnce('parent-id'); // Parent folder found
    callGraphAPI.mockResolvedValue({ id: 'new-folder-id' });

    const result = await handleCreateFolder({
      name: 'Subfolder',
      parentFolder: 'Inbox',
    });

    expect(result.content[0].text).toContain('Successfully created folder');
    expect(result.content[0].text).toContain('inside "Inbox"');
  });

  it('should not create if folder already exists', async () => {
    getFolderIdByName.mockResolvedValueOnce('existing-id');

    const result = await handleCreateFolder({ name: 'Existing' });

    expect(result.content[0].text).toContain('already exists');
  });

  it('should handle missing parent folder', async () => {
    getFolderIdByName
      .mockResolvedValueOnce(null) // No existing folder
      .mockResolvedValueOnce(null); // Parent not found

    const result = await handleCreateFolder({
      name: 'Subfolder',
      parentFolder: 'NonExistent',
    });

    expect(result.content[0].text).toContain('not found');
  });

  it('should require folder name', async () => {
    const result = await handleCreateFolder({});

    expect(result.content[0].text).toBe('Folder name is required.');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleCreateFolder({ name: 'Test' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    getFolderIdByName.mockResolvedValueOnce(null);
    callGraphAPI.mockRejectedValue(new Error('Create failed'));

    const result = await handleCreateFolder({ name: 'Test' });

    expect(result.content[0].text).toBe('Error creating folder: Create failed');
  });
});

describe('handleMoveEmails', () => {
  it('should move emails to target folder', async () => {
    getFolderIdByName.mockResolvedValue('target-folder-id');
    callGraphAPI.mockResolvedValue({});

    const result = await handleMoveEmails({
      emailIds: 'msg-1,msg-2',
      targetFolder: 'Archive',
    });

    expect(result.content[0].text).toContain('Successfully moved 2 email(s)');
    expect(result.content[0].text).toContain('Archive');
  });

  it('should handle target folder not found', async () => {
    getFolderIdByName.mockResolvedValue(null);

    const result = await handleMoveEmails({
      emailIds: 'msg-1',
      targetFolder: 'NonExistent',
    });

    expect(result.content[0].text).toContain('not found');
  });

  it('should handle partial failures', async () => {
    getFolderIdByName.mockResolvedValue('target-id');
    callGraphAPI
      .mockResolvedValueOnce({}) // First email succeeds
      .mockRejectedValueOnce(new Error('Move failed')); // Second fails

    const result = await handleMoveEmails({
      emailIds: 'msg-1,msg-2',
      targetFolder: 'Archive',
    });

    expect(result.content[0].text).toContain('Successfully moved 1');
    expect(result.content[0].text).toContain('Failed to move 1');
  });

  it('should require email IDs', async () => {
    const result = await handleMoveEmails({ targetFolder: 'Archive' });

    expect(result.content[0].text).toContain('Email IDs are required');
  });

  it('should require target folder', async () => {
    const result = await handleMoveEmails({ emailIds: 'msg-1' });

    expect(result.content[0].text).toContain('Target folder name is required');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleMoveEmails({
      emailIds: 'msg-1',
      targetFolder: 'Archive',
    });

    expect(result.content[0].text).toContain('Authentication required');
  });
});

describe('handleGetFolderStats', () => {
  it('should return folder statistics', async () => {
    // resolveFolderName: well-known folder lookup
    callGraphAPI
      .mockResolvedValueOnce({ id: 'inbox-id' }) // resolveFolderName
      .mockResolvedValueOnce({
        // folder details
        id: 'inbox-id',
        displayName: 'Inbox',
        totalItemCount: 42,
        unreadItemCount: 5,
        childFolderCount: 0,
      })
      .mockResolvedValueOnce({
        // newest email
        value: [{ receivedDateTime: '2024-01-15T10:00:00Z' }],
      })
      .mockResolvedValueOnce({
        // oldest email
        value: [{ receivedDateTime: '2024-01-01T08:00:00Z' }],
      });

    const result = await handleGetFolderStats({});

    expect(result.content[0].text).toContain('Inbox');
    expect(result.content[0].text).toContain('42');
    expect(result._meta.totalItems).toBe(42);
  });

  it('should handle folder not found', async () => {
    // 'NonExistent' is not a well-known folder, so resolveFolderName goes
    // straight to the name search, which returns empty
    callGraphAPI.mockResolvedValueOnce({ value: [] });

    const result = await handleGetFolderStats({ folder: 'NonExistent' });

    expect(result.content[0].text).toContain('not found');
  });

  it('should handle minimal verbosity', async () => {
    callGraphAPI
      .mockResolvedValueOnce({ id: 'inbox-id' }) // resolveFolderName: well-known lookup
      .mockResolvedValueOnce({
        // folder details
        id: 'inbox-id',
        displayName: 'Inbox',
        totalItemCount: 10,
        unreadItemCount: 2,
      });
    // minimal verbosity skips date range fetch

    const result = await handleGetFolderStats({
      folder: 'inbox',
      outputVerbosity: 'minimal',
    });

    expect(result.content[0].text).toMatch(/Inbox.*10 items.*2 unread/);
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleGetFolderStats({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    // resolveFolderName succeeds, but folder details call fails
    callGraphAPI
      .mockResolvedValueOnce({ id: 'inbox-id' }) // resolveFolderName
      .mockRejectedValueOnce(new Error('Stats failed')); // folder details

    const result = await handleGetFolderStats({});

    expect(result.content[0].text).toBe(
      'Error getting folder stats: Stats failed'
    );
  });
});
