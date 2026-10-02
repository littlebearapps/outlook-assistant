/**
 * `folder` accepted raw Graph folder IDs in delta sync and conversation
 * listing before name resolution was added. An ID-like value must still be
 * treated as an ID — not searched for as a display name (which fails).
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const handleListEmailsDelta = require('../../email/delta');
const { handleListConversations } = require('../../email/conversations');
const { looksLikeFolderId } = require('../../folder/resolve');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

const FOLDER_ID =
  'AAMkAGVmMDEzMTM4LTZmYWUtNDdkNC1hMDZiLTU1OGY5OTZhYmY4OAAuAAAAAAAiQ8W967B7TKBjgx9rVEURAQAiIsqMbYjsT5e-T7KzowPTAAAAAAEMAAA=';

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue('tok');
});

afterEach(() => {
  console.error.mockRestore();
});

describe('looksLikeFolderId', () => {
  test.each([
    FOLDER_ID,
    `AQMkADAwATM0MDAAMS1iNTcwLWI2NTEtMDACLTAwCgAuAAADd${'x'.repeat(20)}`,
  ])('treats %s as an ID', (value) => {
    expect(looksLikeFolderId(value)).toBe(true);
  });

  test.each([
    'inbox',
    'Archiv',
    'Inbox/Vendors/Acme',
    'Project Alpha Q3 2026',
    '',
    null,
  ])('treats %p as a name', (value) => {
    expect(looksLikeFolderId(value)).toBe(false);
  });
});

describe('raw folder IDs keep working', () => {
  test('delta initial sync addresses the ID directly (no name search)', async () => {
    callGraphAPI.mockImplementation((_t, _m, endpoint) =>
      Promise.resolve(
        endpoint.endsWith('/delta')
          ? { value: [] }
          : { id: FOLDER_ID, displayName: 'Custom', parentFolderId: null }
      )
    );

    await handleListEmailsDelta({ folder: FOLDER_ID });

    const endpoints = callGraphAPI.mock.calls.map((c) => c[2]);
    expect(endpoints).not.toContain('me/mailFolders');
    expect(endpoints).toContain(`me/mailFolders/${FOLDER_ID}`);
    expect(endpoints).toContain(`me/mailFolders/${FOLDER_ID}/messages/delta`);
  });

  test('conversation listing uses the ID as-is', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    await handleListConversations({ folder: FOLDER_ID });

    expect(callGraphAPI.mock.calls[0][2]).toBe(
      `me/mailFolders/${FOLDER_ID}/messages`
    );
  });
});
