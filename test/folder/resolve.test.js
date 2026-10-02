/**
 * Unit tests for the shared folder resolver. (#216)
 */
const { resolveFolder, listChildFolders } = require('../../folder/resolve');
const { callGraphAPI } = require('../../utils/graph-api');

jest.mock('../../utils/graph-api');

const TOKEN = 'test_token';

function folder(id, displayName, extra = {}) {
  return {
    id,
    displayName,
    parentFolderId: 'parentFolderId' in extra ? extra.parentFolderId : 'root',
    childFolderCount: extra.childFolderCount || 0,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
  console.error.mockRestore();
});

describe('resolveFolder — well-known aliases', () => {
  it('resolves an alias directly via the well-known endpoint', async () => {
    callGraphAPI.mockResolvedValueOnce(
      folder('inbox-id', 'Inbox', { parentFolderId: null })
    );

    const r = await resolveFolder(TOKEN, { name: 'inbox' });

    expect(r).toEqual({
      id: 'inbox-id',
      displayName: 'Inbox',
      parentId: null,
      path: 'Inbox',
    });
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    expect(callGraphAPI.mock.calls[0][2]).toBe('me/mailFolders/inbox');
  });

  it('maps "sent" alias to sentitems', async () => {
    callGraphAPI.mockResolvedValueOnce(folder('sent-id', 'Sent Items'));
    await resolveFolder(TOKEN, { name: 'Sent' });
    expect(callGraphAPI.mock.calls[0][2]).toBe('me/mailFolders/sentitems');
  });
});

describe('resolveFolder — explicit ID', () => {
  it('fetches the folder by ID without guessing from a name', async () => {
    callGraphAPI.mockResolvedValueOnce(
      folder('abc123', 'Some Folder', { parentFolderId: 'p' })
    );

    const r = await resolveFolder(TOKEN, { id: 'abc123' });

    expect(r.id).toBe('abc123');
    expect(r.displayName).toBe('Some Folder');
    expect(callGraphAPI.mock.calls[0][2]).toBe('me/mailFolders/abc123');
  });

  it('prefers ID over name when both are given', async () => {
    callGraphAPI.mockResolvedValueOnce(folder('abc123', 'ByID'));
    await resolveFolder(TOKEN, { name: 'Ignored', id: 'abc123' });
    expect(callGraphAPI.mock.calls[0][2]).toBe('me/mailFolders/abc123');
  });
});

describe('resolveFolder — bare name', () => {
  it('resolves a unique top-level name in one call (back-compat fast path)', async () => {
    callGraphAPI.mockResolvedValueOnce({
      value: [folder('p1', 'Projects'), folder('a1', 'Archive')],
    });

    const r = await resolveFolder(TOKEN, { name: 'Projects' });

    expect(r.id).toBe('p1');
    expect(r.path).toBe('Projects');
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
  });

  it('finds a nested folder not present at the top level', async () => {
    callGraphAPI
      // top-level
      .mockResolvedValueOnce({
        value: [
          folder('triage', 'Triage', { childFolderCount: 1 }),
          folder('other', 'Other'),
        ],
      })
      // children of Triage (buildTree)
      .mockResolvedValueOnce({
        value: [folder('del', 'Delete', { parentFolderId: 'triage' })],
      });

    const r = await resolveFolder(TOKEN, { name: 'Delete' });

    expect(r.id).toBe('del');
    expect(r.path).toBe('Triage/Delete');
  });

  it('is case-insensitive', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [folder('p1', 'Projects')] });
    const r = await resolveFolder(TOKEN, { name: 'projects' });
    expect(r.id).toBe('p1');
  });

  it('throws an ambiguity error when a top-level name matches twice', async () => {
    callGraphAPI.mockResolvedValueOnce({
      value: [folder('r1', 'Reports'), folder('r2', 'Reports')],
    });

    await expect(resolveFolder(TOKEN, { name: 'Reports' })).rejects.toThrow(
      /ambiguous/i
    );
  });

  it('throws an ambiguity error listing paths when a nested name matches twice', async () => {
    callGraphAPI
      .mockResolvedValueOnce({
        value: [
          folder('a', 'Triage', { childFolderCount: 1 }),
          folder('b', 'Old', { childFolderCount: 1 }),
        ],
      })
      .mockResolvedValueOnce({
        value: [folder('d1', 'Delete', { parentFolderId: 'a' })],
      })
      .mockResolvedValueOnce({
        value: [folder('d2', 'Delete', { parentFolderId: 'b' })],
      });

    await expect(resolveFolder(TOKEN, { name: 'Delete' })).rejects.toThrow(
      /Triage\/Delete/
    );
  });

  it('throws not-found when nothing matches', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [folder('p1', 'Projects')] });

    await expect(resolveFolder(TOKEN, { name: 'Ghost' })).rejects.toThrow(
      /not found/i
    );
  });
});

describe('resolveFolder — path syntax', () => {
  it('traverses a two-segment path', async () => {
    callGraphAPI
      // top-level (find Triage)
      .mockResolvedValueOnce({
        value: [folder('triage', 'Triage', { childFolderCount: 1 })],
      })
      // children of Triage (find Delete)
      .mockResolvedValueOnce({
        value: [folder('del', 'Delete', { parentFolderId: 'triage' })],
      });

    const r = await resolveFolder(TOKEN, { name: 'Triage/Delete' });

    expect(r.id).toBe('del');
    expect(r.path).toBe('Triage/Delete');
  });

  it('supports a well-known alias as the first path segment', async () => {
    callGraphAPI
      // GET me/mailFolders/inbox
      .mockResolvedValueOnce(
        folder('inbox-id', 'Inbox', { parentFolderId: null })
      )
      // children of Inbox
      .mockResolvedValueOnce({
        value: [folder('rec', 'Receipts', { parentFolderId: 'inbox-id' })],
      });

    const r = await resolveFolder(TOKEN, { name: 'inbox/Receipts' });

    expect(r.id).toBe('rec');
    expect(r.path).toBe('Inbox/Receipts');
    expect(callGraphAPI.mock.calls[0][2]).toBe('me/mailFolders/inbox');
  });

  it('throws not-found for a missing intermediate/leaf segment', async () => {
    callGraphAPI
      .mockResolvedValueOnce({
        value: [folder('triage', 'Triage', { childFolderCount: 1 })],
      })
      .mockResolvedValueOnce({
        value: [folder('del', 'Delete', { parentFolderId: 'triage' })],
      });

    await expect(
      resolveFolder(TOKEN, { name: 'Triage/Missing' })
    ).rejects.toThrow(/Triage\/Missing/);
  });

  it('is case-insensitive across segments', async () => {
    callGraphAPI
      .mockResolvedValueOnce({
        value: [folder('triage', 'Triage', { childFolderCount: 1 })],
      })
      .mockResolvedValueOnce({
        value: [folder('del', 'Delete', { parentFolderId: 'triage' })],
      });

    const r = await resolveFolder(TOKEN, { name: 'triage/DELETE' });
    expect(r.id).toBe('del');
  });
});

describe('listChildFolders — pagination', () => {
  it('follows @odata.nextLink across pages', async () => {
    callGraphAPI
      .mockResolvedValueOnce({
        value: [folder('a', 'A')],
        '@odata.nextLink': 'https://graph/next',
      })
      .mockResolvedValueOnce({ value: [folder('b', 'B')] });

    const all = await listChildFolders(TOKEN, null);

    expect(all.map((f) => f.id)).toEqual(['a', 'b']);
    expect(callGraphAPI).toHaveBeenCalledTimes(2);
    // Second call uses the nextLink URL directly.
    expect(callGraphAPI.mock.calls[1][2]).toBe('https://graph/next');
  });

  it('resolves a top-level name that only appears on a later page', async () => {
    callGraphAPI
      .mockResolvedValueOnce({
        value: [folder('a', 'A')],
        '@odata.nextLink': 'https://graph/next',
      })
      .mockResolvedValueOnce({ value: [folder('deep', 'Deep')] });

    const r = await resolveFolder(TOKEN, { name: 'Deep' });
    expect(r.id).toBe('deep');
  });
});

describe('resolveFolder — validation', () => {
  it('throws when neither name nor id is given', async () => {
    await expect(resolveFolder(TOKEN, {})).rejects.toThrow(/required/i);
  });

  it('collapses a single-real-segment path to a name lookup', async () => {
    callGraphAPI.mockResolvedValueOnce(folder('inbox-id', 'Inbox'));
    const r = await resolveFolder(TOKEN, { name: '/inbox/' });
    expect(r.displayName).toBe('Inbox');
    expect(callGraphAPI.mock.calls[0][2]).toBe('me/mailFolders/inbox');
  });

  it('rejects an interior empty path segment (typo guard)', async () => {
    await expect(resolveFolder(TOKEN, { name: 'A//B' })).rejects.toThrow(
      /empty path segment/
    );
    // No Graph call — rejected before any traversal.
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only id as absent and falls back to the name', async () => {
    callGraphAPI.mockResolvedValueOnce(folder('inbox-id', 'Inbox'));
    const r = await resolveFolder(TOKEN, { name: 'inbox', id: '   ' });
    expect(r.displayName).toBe('Inbox');
    // Resolved via the alias endpoint, not by the blank id.
    expect(callGraphAPI.mock.calls[0][2]).toBe('me/mailFolders/inbox');
  });

  it('does not request the non-existent wellKnownName $select field', async () => {
    // Graph 400s on `wellKnownName` for mailFolder — the resolver must never
    // select it. (Regression guard for a live-caught bug.)
    callGraphAPI.mockResolvedValueOnce(folder('inbox-id', 'Inbox'));
    await resolveFolder(TOKEN, { id: 'inbox-id' });
    const selectArg = callGraphAPI.mock.calls[0][4]?.$select || '';
    expect(selectArg).not.toContain('wellKnownName');
  });
});

describe('resolveFolder — depth/ambiguity safety', () => {
  it('refuses a bare-name result when the tree is truncated at the depth cap', async () => {
    // Every childFolders response reports a fresh child-with-children, so the
    // walk keeps descending until MAX_TREE_DEPTH and must refuse rather than
    // return a possibly-incomplete "unique" match. A counter gives each folder
    // a distinct id so the visited-set doesn't short-circuit the descent.
    let n = 0;
    callGraphAPI.mockImplementation(async () => ({
      value: [{ id: `f${n++}`, displayName: 'Level', childFolderCount: 1 }],
    }));

    await expect(resolveFolder(TOKEN, { name: 'Ghost' })).rejects.toThrow(
      /resolution limit|too large/
    );
  });
});
