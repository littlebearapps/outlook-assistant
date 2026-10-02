const {
  WELL_KNOWN_FOLDERS,
  resolveFolderPath,
  getFolderIdByName,
} = require('../../email/folder-utils');
const { callGraphAPI } = require('../../utils/graph-api');

jest.mock('../../utils/graph-api');

describe('resolveFolderPath', () => {
  const mockAccessToken = 'dummy_access_token';

  beforeEach(() => {
    callGraphAPI.mockClear();
    // Mock console.error to avoid cluttering test output
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe('well-known folders', () => {
    test('should return inbox endpoint when no folder name is provided', async () => {
      const result = await resolveFolderPath(mockAccessToken, null);
      expect(result).toBe(WELL_KNOWN_FOLDERS.inbox);
      expect(callGraphAPI).not.toHaveBeenCalled();
    });

    test('should return inbox endpoint when undefined folder name is provided', async () => {
      const result = await resolveFolderPath(mockAccessToken, undefined);
      expect(result).toBe(WELL_KNOWN_FOLDERS.inbox);
      expect(callGraphAPI).not.toHaveBeenCalled();
    });

    test('should return inbox endpoint when empty string is provided', async () => {
      const result = await resolveFolderPath(mockAccessToken, '');
      expect(result).toBe(WELL_KNOWN_FOLDERS.inbox);
      expect(callGraphAPI).not.toHaveBeenCalled();
    });

    test('should return correct endpoint for well-known folders', async () => {
      const result = await resolveFolderPath(mockAccessToken, 'drafts');
      expect(result).toBe(WELL_KNOWN_FOLDERS.drafts);
      expect(callGraphAPI).not.toHaveBeenCalled();
    });

    test('should handle case-insensitive well-known folder names', async () => {
      const result1 = await resolveFolderPath(mockAccessToken, 'INBOX');
      const result2 = await resolveFolderPath(mockAccessToken, 'Drafts');
      const result3 = await resolveFolderPath(mockAccessToken, 'SENT');

      expect(result1).toBe(WELL_KNOWN_FOLDERS.inbox);
      expect(result2).toBe(WELL_KNOWN_FOLDERS.drafts);
      expect(result3).toBe(WELL_KNOWN_FOLDERS.sent);
      expect(callGraphAPI).not.toHaveBeenCalled();
    });

    test('should resolve Graph API well-known folder names (sentitems, deleteditems, junkemail)', async () => {
      const result1 = await resolveFolderPath(mockAccessToken, 'sentitems');
      const result2 = await resolveFolderPath(mockAccessToken, 'deleteditems');
      const result3 = await resolveFolderPath(mockAccessToken, 'junkemail');
      const result4 = await resolveFolderPath(mockAccessToken, 'outbox');

      expect(result1).toBe(WELL_KNOWN_FOLDERS.sentitems);
      expect(result2).toBe(WELL_KNOWN_FOLDERS.deleteditems);
      expect(result3).toBe(WELL_KNOWN_FOLDERS.junkemail);
      expect(result4).toBe(WELL_KNOWN_FOLDERS.outbox);
      expect(callGraphAPI).not.toHaveBeenCalled();
    });

    test('should resolve display name aliases (Sent Items, Deleted Items, Junk Email)', async () => {
      const result1 = await resolveFolderPath(mockAccessToken, 'Sent Items');
      const result2 = await resolveFolderPath(mockAccessToken, 'Deleted Items');
      const result3 = await resolveFolderPath(mockAccessToken, 'Junk Email');
      const result4 = await resolveFolderPath(mockAccessToken, 'spam');

      expect(result1).toBe(WELL_KNOWN_FOLDERS.sent);
      expect(result2).toBe(WELL_KNOWN_FOLDERS.deleted);
      expect(result3).toBe(WELL_KNOWN_FOLDERS.junk);
      expect(result4).toBe(WELL_KNOWN_FOLDERS.junk);
      expect(callGraphAPI).not.toHaveBeenCalled();
    });
  });

  describe('custom folders (path-aware resolver, #216)', () => {
    test('should resolve a unique top-level folder to its messages endpoint', async () => {
      callGraphAPI.mockResolvedValueOnce({
        value: [
          { id: 'cid', displayName: 'MyCustomFolder', childFolderCount: 0 },
        ],
      });

      const result = await resolveFolderPath(mockAccessToken, 'MyCustomFolder');

      expect(result).toBe('me/mailFolders/cid/messages');
    });

    test('should be case-insensitive', async () => {
      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: 'pa', displayName: 'projectalpha', childFolderCount: 0 }],
      });

      const result = await resolveFolderPath(mockAccessToken, 'ProjectAlpha');

      expect(result).toBe('me/mailFolders/pa/messages');
    });

    test('should resolve a NESTED folder by path', async () => {
      callGraphAPI
        // top-level (find Triage)
        .mockResolvedValueOnce({
          value: [{ id: 'triage', displayName: 'Triage', childFolderCount: 1 }],
        })
        // children of Triage (find Delete)
        .mockResolvedValueOnce({
          value: [
            {
              id: 'del',
              displayName: 'Delete',
              parentFolderId: 'triage',
              childFolderCount: 0,
            },
          ],
        });

      const result = await resolveFolderPath(mockAccessToken, 'Triage/Delete');

      expect(result).toBe('me/mailFolders/del/messages');
    });

    test('should throw a not-found error for an unknown folder', async () => {
      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: 'x', displayName: 'Other', childFolderCount: 0 }],
      });

      await expect(
        resolveFolderPath(mockAccessToken, 'NonExistent')
      ).rejects.toThrow('not found');
    });

    test('should surface an ambiguity error', async () => {
      callGraphAPI.mockResolvedValueOnce({
        value: [
          { id: 'a', displayName: 'Reports', childFolderCount: 0 },
          { id: 'b', displayName: 'Reports', childFolderCount: 0 },
        ],
      });

      await expect(
        resolveFolderPath(mockAccessToken, 'Reports')
      ).rejects.toThrow('ambiguous');
    });

    test('should wrap a non-not-found API error', async () => {
      callGraphAPI.mockRejectedValueOnce(new Error('API Error'));

      await expect(
        resolveFolderPath(mockAccessToken, 'CustomFolder')
      ).rejects.toThrow('Error resolving folder');
    });
  });
});

describe('getFolderIdByName', () => {
  const mockAccessToken = 'dummy_access_token';

  beforeEach(() => {
    callGraphAPI.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('should return folder ID when exact match is found', async () => {
    const folderId = 'folder-id-123';
    const folderName = 'TestFolder';

    callGraphAPI.mockResolvedValueOnce({
      value: [{ id: folderId, displayName: folderName }],
    });

    const result = await getFolderIdByName(mockAccessToken, folderName);

    expect(result).toBe(folderId);
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      'me/mailFolders',
      null,
      { $filter: `displayName eq '${folderName}'` }
    );
  });

  test('should return folder ID when case-insensitive match is found', async () => {
    const folderId = 'folder-id-456';
    const folderName = 'TestFolder';

    // First call returns empty (exact match fails)
    callGraphAPI.mockResolvedValueOnce({ value: [] });

    // Second call returns folders with case-insensitive match
    callGraphAPI.mockResolvedValueOnce({
      value: [{ id: folderId, displayName: 'testfolder' }],
    });

    const result = await getFolderIdByName(mockAccessToken, folderName);

    expect(result).toBe(folderId);
    expect(callGraphAPI).toHaveBeenCalledTimes(2);
  });

  test('should return null when folder is not found', async () => {
    const folderName = 'NonExistentFolder';

    // First call returns empty
    callGraphAPI.mockResolvedValueOnce({ value: [] });

    // Second call returns folders without a match
    callGraphAPI.mockResolvedValueOnce({
      value: [{ id: 'id1', displayName: 'OtherFolder' }],
    });

    const result = await getFolderIdByName(mockAccessToken, folderName);

    expect(result).toBeNull();
    expect(callGraphAPI).toHaveBeenCalledTimes(2);
  });

  test('should return null when API call fails', async () => {
    const folderName = 'TestFolder';

    callGraphAPI.mockRejectedValueOnce(new Error('API Error'));

    const result = await getFolderIdByName(mockAccessToken, folderName);

    expect(result).toBeNull();
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
  });
});
