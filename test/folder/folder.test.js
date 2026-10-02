const {
  handleListFolders,
  handleCreateFolder,
  handleMoveEmails,
  handleGetFolderStats,
  handleDeleteFolder,
} = require('../../folder');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { resolveFolder, listChildFolders } = require('../../folder/resolve');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
// The shared resolver is unit-tested in resolve.test.js; here we mock it so
// handler tests exercise handler logic, not Graph traversal. (#216)
jest.mock('../../folder/resolve');

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
  it('should list folders as flat list with IDs', async () => {
    listChildFolders.mockResolvedValue(mockFolders);

    const result = await handleListFolders({});

    expect(result.content[0].text).toContain('Found 2 folders');
    expect(result.content[0].text).toContain('Inbox');
    expect(result.content[0].text).toContain('Sent Items');
    // #216: folder IDs surfaced so callers can address folders directly.
    expect(result.content[0].text).toContain('[id: folder-1]');
  });

  it('should include item counts when requested', async () => {
    listChildFolders.mockResolvedValue(mockFolders);

    const result = await handleListFolders({ includeItemCounts: true });

    expect(result.content[0].text).toContain('42 items');
    expect(result.content[0].text).toContain('5 unread');
  });

  it('should format as hierarchy when requested', async () => {
    listChildFolders.mockResolvedValue(mockFolders);

    const result = await handleListFolders({ includeChildren: true });

    expect(result.content[0].text).toContain('Folder Hierarchy');
  });

  it('should show a nested folder with its full path', async () => {
    listChildFolders
      // top-level
      .mockResolvedValueOnce([
        {
          id: 'triage',
          displayName: 'Triage',
          parentFolderId: 'root',
          childFolderCount: 1,
        },
      ])
      // children of Triage
      .mockResolvedValueOnce([
        {
          id: 'del',
          displayName: 'Delete',
          parentFolderId: 'triage',
          childFolderCount: 0,
        },
      ]);

    const result = await handleListFolders({});

    expect(result.content[0].text).toContain('Triage/Delete');
    expect(result.content[0].text).toContain('[id: del]');
  });

  it('should flag the listing partial when a child fetch fails', async () => {
    listChildFolders
      .mockResolvedValueOnce([
        {
          id: 'secret',
          displayName: 'Secret',
          parentFolderId: 'root',
          childFolderCount: 2,
        },
      ])
      .mockRejectedValueOnce(new Error('403 Access is denied'));

    const result = await handleListFolders({});

    expect(result._meta.partial).toBe(true);
    expect(result._meta.warnings[0]).toContain('Secret');
    expect(result._meta.warnings[0]).toContain('Access is denied');
    expect(result.content[0].text).toContain('Partial listing');
  });

  it('should flag the listing partial when the depth cap is hit', async () => {
    // Every level reports one child, so the walk runs into the depth-20 cap.
    listChildFolders.mockImplementation((_token, parentId) =>
      Promise.resolve([
        {
          id: `f-${parentId || 'root'}`,
          displayName: `L${parentId || 'root'}`,
          parentFolderId: parentId || 'root',
          childFolderCount: 1,
        },
      ])
    );

    const result = await handleListFolders({});

    expect(result._meta.partial).toBe(true);
    expect(result._meta.warnings.join('\n')).toContain('Depth limit (20)');
  });

  it('should handle empty folders', async () => {
    listChildFolders.mockResolvedValue([]);

    const result = await handleListFolders({});

    expect(result.content[0].text).toContain('No folders found');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleListFolders({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    listChildFolders.mockRejectedValue(new Error('API Error'));

    const result = await handleListFolders({});

    expect(result.content[0].text).toBe('Error listing folders: API Error');
  });
});

describe('handleCreateFolder', () => {
  it('should create a folder at root level', async () => {
    listChildFolders.mockResolvedValue([]); // no siblings → no duplicate
    callGraphAPI.mockResolvedValue({ id: 'new-folder-id' });

    const result = await handleCreateFolder({ name: 'My Folder' });

    expect(result.content[0].text).toContain('Successfully created folder');
    expect(result.content[0].text).toContain('My Folder');
    expect(result.content[0].text).toContain('root level');
  });

  it('should include the new folder ID in response (F-31)', async () => {
    listChildFolders.mockResolvedValue([]);
    callGraphAPI.mockResolvedValue({ id: 'new-folder-id-12345' });

    const result = await handleCreateFolder({ name: 'WithId' });

    expect(result.content[0].text).toMatch(/\*\*ID\*\*: new-folder-id-12345/);
    expect(result._meta.folderId).toBe('new-folder-id-12345');
  });

  it('should create a folder inside a parent path', async () => {
    resolveFolder.mockResolvedValue({
      id: 'parent-id',
      displayName: 'Acme',
      path: 'Clients/Acme',
      parentId: 'clients-id',
    });
    listChildFolders.mockResolvedValue([]);
    callGraphAPI.mockResolvedValue({ id: 'new-folder-id' });

    const result = await handleCreateFolder({
      name: 'Subfolder',
      parentFolder: 'Clients/Acme',
    });

    expect(result.content[0].text).toContain('Successfully created folder');
    expect(result.content[0].text).toContain('inside "Clients/Acme"');
  });

  it('should not create if a sibling with the same name exists', async () => {
    listChildFolders.mockResolvedValue([{ id: 'x', displayName: 'Existing' }]);

    const result = await handleCreateFolder({ name: 'Existing' });

    expect(result.content[0].text).toContain('already exists');
  });

  it('should handle missing parent folder', async () => {
    resolveFolder.mockRejectedValue(
      new Error('Folder "NonExistent" not found. Use `folders` action=list ...')
    );

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
    listChildFolders.mockResolvedValue([]);
    callGraphAPI.mockRejectedValue(new Error('Create failed'));

    const result = await handleCreateFolder({ name: 'Test' });

    expect(result.content[0].text).toBe('Error creating folder: Create failed');
  });
});

describe('handleMoveEmails', () => {
  it('should move emails to a target folder (by path)', async () => {
    resolveFolder.mockResolvedValue({
      id: 'target-folder-id',
      displayName: 'Delete',
      path: 'Triage/Delete',
      parentId: 'triage-id',
    });
    callGraphAPI.mockResolvedValue({});

    const result = await handleMoveEmails({
      emailIds: 'msg-1,msg-2',
      targetFolder: 'Triage/Delete',
    });

    expect(result.content[0].text).toContain('Successfully moved 2 email(s)');
    // Reports the resolved full path, not the raw input.
    expect(result.content[0].text).toContain('Triage/Delete');
  });

  it('should move emails by explicit targetFolderId', async () => {
    resolveFolder.mockResolvedValue({
      id: 'abc123',
      displayName: 'Archive',
      path: 'Archive',
      parentId: null,
    });
    callGraphAPI.mockResolvedValue({});

    const result = await handleMoveEmails({
      emailIds: 'msg-1',
      targetFolderId: 'abc123',
    });

    expect(result.content[0].text).toContain('Successfully moved 1 email(s)');
    expect(resolveFolder).toHaveBeenCalledWith(mockAccessToken, {
      name: '',
      id: 'abc123',
      mailbox: null,
    });
  });

  it('should handle target folder not found', async () => {
    resolveFolder.mockRejectedValue(
      new Error('Folder "NonExistent" not found. Use `folders` action=list ...')
    );

    const result = await handleMoveEmails({
      emailIds: 'msg-1',
      targetFolder: 'NonExistent',
    });

    expect(result.content[0].text).toContain('not found');
  });

  it('should surface an ambiguity error from the resolver', async () => {
    resolveFolder.mockRejectedValue(
      new Error(
        'Folder "Delete" is ambiguous — 2 folders match:\n  - Triage/Delete  (folderId: a)\n  - Old/Delete  (folderId: b)'
      )
    );

    const result = await handleMoveEmails({
      emailIds: 'msg-1',
      targetFolder: 'Delete',
    });

    expect(result.content[0].text).toContain('ambiguous');
    expect(result.content[0].text).toContain('Triage/Delete');
  });

  it('should handle partial failures', async () => {
    resolveFolder.mockResolvedValue({
      id: 'target-id',
      displayName: 'Archive',
      path: 'Archive',
      parentId: null,
    });
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

  it('should surface the NEW message ID returned by the move', async () => {
    resolveFolder.mockResolvedValue({
      id: 'target-id',
      displayName: 'Archive',
      path: 'Archive',
      parentId: null,
    });
    callGraphAPI.mockResolvedValue({ id: 'msg-1-new' });

    const result = await handleMoveEmails({
      emailIds: 'msg-1',
      targetFolder: 'Archive',
    });

    expect(result._meta.moved).toEqual([
      { oldId: 'msg-1', newId: 'msg-1-new' },
    ]);
    expect(result.content[0].text).toContain('msg-1 -> msg-1-new');
  });

  it('should fall back to the old ID when the move returns no body', async () => {
    resolveFolder.mockResolvedValue({
      id: 'target-id',
      displayName: 'Archive',
      path: 'Archive',
      parentId: null,
    });
    callGraphAPI.mockResolvedValue(undefined);

    const result = await handleMoveEmails({
      emailIds: 'msg-1',
      targetFolder: 'Archive',
    });

    expect(result._meta.moved).toEqual([{ oldId: 'msg-1', newId: 'msg-1' }]);
  });

  it('should require email IDs', async () => {
    const result = await handleMoveEmails({ targetFolder: 'Archive' });

    expect(result.content[0].text).toContain('Email IDs are required');
  });

  it('should require a target folder or id', async () => {
    const result = await handleMoveEmails({ emailIds: 'msg-1' });

    expect(result.content[0].text).toContain('Target folder is required');
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
    resolveFolder.mockResolvedValue({
      id: 'inbox-id',
      displayName: 'Inbox',
      path: 'Inbox',
      parentId: null,
    });
    callGraphAPI
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

  it('should resolve stats by a nested path', async () => {
    resolveFolder.mockResolvedValue({
      id: 'nested-id',
      displayName: 'Delete',
      path: 'Triage/Delete',
      parentId: 'triage-id',
    });
    callGraphAPI.mockResolvedValueOnce({
      id: 'nested-id',
      displayName: 'Delete',
      totalItemCount: 3,
      unreadItemCount: 0,
      childFolderCount: 0,
    });

    const result = await handleGetFolderStats({
      folder: 'Triage/Delete',
      outputVerbosity: 'minimal',
    });

    expect(resolveFolder).toHaveBeenCalledWith(mockAccessToken, {
      name: 'Triage/Delete',
      id: '',
      mailbox: null,
    });
    expect(result._meta.folderId).toBe('nested-id');
  });

  it('should handle folder not found', async () => {
    resolveFolder.mockRejectedValue(
      new Error('Folder "NonExistent" not found. Use `folders` action=list ...')
    );

    const result = await handleGetFolderStats({ folder: 'NonExistent' });

    expect(result.content[0].text).toContain('not found');
  });

  it('should handle minimal verbosity', async () => {
    resolveFolder.mockResolvedValue({
      id: 'inbox-id',
      displayName: 'Inbox',
      path: 'Inbox',
      parentId: null,
    });
    callGraphAPI.mockResolvedValueOnce({
      id: 'inbox-id',
      displayName: 'Inbox',
      totalItemCount: 10,
      unreadItemCount: 2,
    });

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
    resolveFolder.mockResolvedValue({
      id: 'inbox-id',
      displayName: 'Inbox',
      path: 'Inbox',
      parentId: null,
    });
    callGraphAPI.mockRejectedValueOnce(new Error('Stats failed'));

    const result = await handleGetFolderStats({});

    expect(result.content[0].text).toBe(
      'Error getting folder stats: Stats failed'
    );
  });
});

describe('handleDeleteFolder', () => {
  it('deletes a non-protected folder (resolved by name/path)', async () => {
    resolveFolder.mockResolvedValue({
      id: 'old-id',
      displayName: 'Old',
      path: 'Archive/Old',
      wellKnownName: null,
      parentId: 'archive-id',
    });
    callGraphAPI.mockResolvedValue({});

    const result = await handleDeleteFolder({ folderName: 'Archive/Old' });

    expect(result.content[0].text).toContain('deleted successfully');
    expect(result.content[0].text).toContain('Archive/Old');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'DELETE',
      'me/mailFolders/old-id'
    );
  });

  it('blocks deleting a protected folder by literal name', async () => {
    const result = await handleDeleteFolder({ folderName: 'Inbox' });

    expect(result.content[0].text).toContain('Cannot delete protected folder');
    // Never resolved or deleted.
    expect(resolveFolder).not.toHaveBeenCalled();
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  it('blocks deleting a system folder by display-name variant / alias', async () => {
    // The WELL_KNOWN-based guard catches "Sent Items", "junk", "spam", etc.,
    // not just the Graph names.
    const sent = await handleDeleteFolder({ folderName: 'Sent Items' });
    expect(sent.content[0].text).toContain('Cannot delete protected folder');

    const junk = await handleDeleteFolder({ folderName: 'spam' });
    expect(junk.content[0].text).toContain('Cannot delete protected folder');

    expect(resolveFolder).not.toHaveBeenCalled();
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  it('requires folderId or folderName', async () => {
    const result = await handleDeleteFolder({});

    expect(result.content[0].text).toContain(
      'Either folderId or folderName is required'
    );
  });

  it('surfaces a resolver not-found error', async () => {
    resolveFolder.mockRejectedValue(
      new Error('Folder "Ghost" not found. Use `folders` action=list ...')
    );

    const result = await handleDeleteFolder({ folderName: 'Ghost' });

    expect(result.content[0].text).toContain('not found');
  });
});
