/**
 * Shared/delegated mailbox scoping for the `folders` tool and the shared
 * folder resolver.
 *
 * Two layers are covered:
 *  1. `folder/resolve.js` with a real `callGraphAPI` mock — asserts that the
 *     `users/{mailbox}` prefix reaches every Graph path the resolver builds.
 *  2. The five `folders` actions with the resolver mocked — asserts each
 *     handler forwards `sharedMailbox`/`email` rather than silently operating
 *     on the signed-in account.
 */
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const TOKEN = 'test_token';
const MAILBOX = 'shared@company.com';

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(TOKEN);
});

afterEach(() => {
  console.error.mockRestore();
});

describe('folder/resolve — mailbox scoping', () => {
  const { resolveFolder, listChildFolders } = jest.requireActual(
    '../../folder/resolve'
  );

  it('scopes a well-known alias to the shared mailbox', async () => {
    callGraphAPI.mockResolvedValue({
      id: 'archive-id',
      displayName: 'Archive',
    });

    const result = await resolveFolder(TOKEN, {
      name: 'archive',
      mailbox: MAILBOX,
    });

    expect(callGraphAPI.mock.calls[0][2]).toBe(
      `users/${MAILBOX}/mailFolders/archive`
    );
    expect(result.id).toBe('archive-id');
  });

  it('scopes a nested path walk to the shared mailbox', async () => {
    callGraphAPI
      // segment 1: well-known "inbox"
      .mockResolvedValueOnce({ id: 'inbox-id', displayName: 'Inbox' })
      // segment 2: childFolders of inbox
      .mockResolvedValueOnce({
        value: [{ id: 'vendors-id', displayName: 'Vendors' }],
      });

    const result = await resolveFolder(TOKEN, {
      name: 'Inbox/Vendors',
      mailbox: MAILBOX,
    });

    expect(callGraphAPI.mock.calls[1][2]).toBe(
      `users/${MAILBOX}/mailFolders/inbox-id/childFolders`
    );
    expect(result.id).toBe('vendors-id');
    expect(result.path).toBe('Inbox/Vendors');
  });

  it('scopes an explicit folder ID lookup to the shared mailbox', async () => {
    callGraphAPI.mockResolvedValue({ id: 'raw-id', displayName: 'Raw' });

    await resolveFolder(TOKEN, { id: 'raw-id', mailbox: MAILBOX });

    expect(callGraphAPI.mock.calls[0][2]).toBe(
      `users/${MAILBOX}/mailFolders/raw-id`
    );
  });

  it('resolves a custom subfolder by bare name inside the shared mailbox', async () => {
    callGraphAPI
      // top-level listing — no match
      .mockResolvedValueOnce({
        value: [{ id: 'inbox-id', displayName: 'Inbox', childFolderCount: 1 }],
      })
      // buildTree descends into Inbox
      .mockResolvedValueOnce({
        value: [
          { id: 'archiv-id', displayName: 'Archiv', childFolderCount: 0 },
        ],
      });

    const result = await resolveFolder(TOKEN, {
      name: 'Archiv',
      mailbox: MAILBOX,
    });

    expect(result.id).toBe('archiv-id');
    expect(result.path).toBe('Inbox/Archiv');
  });

  it('defaults to /me when no mailbox is supplied', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    await listChildFolders(TOKEN, null);

    expect(callGraphAPI.mock.calls[0][2]).toBe('me/mailFolders');
  });
});

describe('folders tool — sharedMailbox routing', () => {
  jest.mock('../../folder/resolve');
  const {
    handleListFolders,
    handleCreateFolder,
    handleMoveEmails,
    handleGetFolderStats,
    handleDeleteFolder,
  } = require('../../folder');
  const { resolveFolder, listChildFolders } = require('../../folder/resolve');

  const resolved = {
    id: 'target-id',
    displayName: 'Target',
    parentId: null,
    path: 'Target',
  };

  it('list enumerates the shared mailbox and labels the output', async () => {
    listChildFolders.mockResolvedValue([
      {
        id: 'f1',
        displayName: 'Inbox',
        parentFolderId: 'root',
        childFolderCount: 0,
      },
    ]);

    const result = await handleListFolders({ sharedMailbox: MAILBOX });

    // 4th positional arg is the mailbox.
    expect(listChildFolders).toHaveBeenCalledWith(
      TOKEN,
      null,
      expect.any(String),
      MAILBOX
    );
    expect(result.content[0].text).toContain(`Mailbox: ${MAILBOX}`);
  });

  it('create posts into the shared mailbox', async () => {
    resolveFolder.mockResolvedValue(resolved);
    listChildFolders.mockResolvedValue([]);
    callGraphAPI.mockResolvedValue({ id: 'new-id' });

    await handleCreateFolder({
      name: 'Acme',
      parentFolder: 'Target',
      sharedMailbox: MAILBOX,
    });

    expect(resolveFolder).toHaveBeenCalledWith(TOKEN, {
      name: 'Target',
      id: '',
      mailbox: MAILBOX,
    });
    expect(callGraphAPI.mock.calls[0][2]).toBe(
      `users/${MAILBOX}/mailFolders/target-id/childFolders`
    );
  });

  it('move relocates messages within the shared mailbox', async () => {
    resolveFolder.mockResolvedValue(resolved);
    callGraphAPI.mockResolvedValue({});

    await handleMoveEmails({
      emailIds: 'msg-1',
      targetFolder: 'Target',
      email: MAILBOX, // alias
    });

    expect(callGraphAPI.mock.calls[0][2]).toBe(
      `users/${MAILBOX}/messages/msg-1/move`
    );
  });

  it('stats reads counts from the shared mailbox', async () => {
    resolveFolder.mockResolvedValue(resolved);
    callGraphAPI.mockResolvedValue({
      id: 'target-id',
      displayName: 'Target',
      totalItemCount: 0,
      unreadItemCount: 0,
    });

    await handleGetFolderStats({ folder: 'Target', sharedMailbox: MAILBOX });

    expect(callGraphAPI.mock.calls[0][2]).toBe(
      `users/${MAILBOX}/mailFolders/target-id`
    );
  });

  it('delete removes the folder from the shared mailbox, not /me', async () => {
    resolveFolder.mockResolvedValue(resolved);
    callGraphAPI.mockResolvedValue({});

    const result = await handleDeleteFolder({
      folderName: 'Target',
      sharedMailbox: MAILBOX,
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      TOKEN,
      'DELETE',
      `users/${MAILBOX}/mailFolders/target-id`
    );
    expect(result.content[0].text).toContain('deleted successfully');
  });

  it('delete still refuses protected folders in a shared mailbox', async () => {
    const result = await handleDeleteFolder({
      folderName: 'inbox',
      sharedMailbox: MAILBOX,
    });

    expect(result.content[0].text).toContain('Cannot delete protected folder');
    expect(callGraphAPI).not.toHaveBeenCalled();
  });
});
