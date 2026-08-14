/**
 * Regression tests (issues #3 / #4): the `search-emails` delta and
 * Message-ID lookup modes must route to the owning shared/delegated mailbox
 * when `sharedMailbox`/`email` is supplied, rather than silently querying the
 * signed-in account.
 *
 * The real `buildMailboxPrefix` runs so the `me` vs `users/{mailbox}`
 * construction is exercised; the shared folder resolver (`folder/resolve`) is
 * stubbed to a deterministic value so delta-mode endpoint assertions don't
 * depend on live folder enumeration.
 */
const handleListEmailsDelta = require('../../email/delta');
const { handleSearchByMessageId } = require('../../email/search');
const { handler: searchEmailsHandler } =
  require('../../email/index').emailTools.find(
    (t) => t.name === 'search-emails'
  );
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { resolveFolder } = require('../../folder/resolve');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
jest.mock('../../folder/resolve');

const TOKEN = 'test_token';
const MAILBOX = 'office@werdropo.com';
const RESOLVED_REF = 'AAMkResolvedFolderRef=';

/** Return the endpoint (3rd positional arg) of the Nth callGraphAPI call. */
function endpointOfCall(n = 0) {
  return callGraphAPI.mock.calls[n][2];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue(TOKEN);
  resolveFolder.mockResolvedValue({
    id: RESOLVED_REF,
    displayName: 'Vendors',
    parentId: null,
    path: 'Vendors',
  });
});

afterEach(() => {
  console.error.mockRestore();
});

describe('delta initial sync — shared-mailbox routing', () => {
  test('routes to /users/{mailbox} when sharedMailbox is set', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    await handleListEmailsDelta({ folder: 'Vendors', sharedMailbox: MAILBOX });
    expect(resolveFolder).toHaveBeenCalledWith(TOKEN, {
      name: 'Vendors',
      mailbox: MAILBOX,
    });
    expect(endpointOfCall()).toBe(
      `users/${MAILBOX}/mailFolders/${RESOLVED_REF}/messages/delta`
    );
  });

  test('accepts `email` as an alias', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    await handleListEmailsDelta({ email: MAILBOX });
    expect(endpointOfCall()).toBe(
      `users/${MAILBOX}/mailFolders/${RESOLVED_REF}/messages/delta`
    );
  });

  test('defaults to /me when no mailbox supplied', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    await handleListEmailsDelta({ folder: 'inbox' });
    expect(resolveFolder).toHaveBeenCalledWith(TOKEN, {
      name: 'inbox',
      mailbox: null,
    });
    expect(endpointOfCall()).toBe(
      `me/mailFolders/${RESOLVED_REF}/messages/delta`
    );
  });

  test('continuation (deltaToken) branch is left untouched for a matching mailbox', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    const deltaLink = `https://graph.microsoft.com/v1.0/users/${MAILBOX}/mailFolders/inbox/messages/delta?$deltatoken=abc`;
    const result = await handleListEmailsDelta({
      deltaToken: deltaLink,
      sharedMailbox: MAILBOX,
    });
    // The deltaLink URL is used verbatim; the resolver must NOT run.
    expect(resolveFolder).not.toHaveBeenCalled();
    expect(endpointOfCall()).toBe(deltaLink);
    expect(result._meta.mailbox).toBe(MAILBOX);
    // The folder arg is ignored when a token is supplied — don't echo it.
    expect(result._meta.folder).toBeNull();
    expect(result._meta.folderSource).toBe('deltaToken');
  });

  test('rejects a /me token supplied with a sharedMailbox', async () => {
    const result = await handleListEmailsDelta({
      deltaToken:
        'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc',
      sharedMailbox: MAILBOX,
    });
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/mailbox mismatch/i);
    expect(result.content[0].text).toContain(`users/${MAILBOX}`);
  });

  test('rejects a token issued for a different shared mailbox', async () => {
    const result = await handleListEmailsDelta({
      deltaToken:
        'https://graph.microsoft.com/v1.0/users/other@werdropo.com/mailFolders/inbox/messages/delta?$deltatoken=abc',
      sharedMailbox: MAILBOX,
    });
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/mailbox mismatch/i);
  });

  test('rejects a shared-mailbox token supplied without a mailbox', async () => {
    const result = await handleListEmailsDelta({
      deltaToken: `https://graph.microsoft.com/v1.0/users/${MAILBOX}/mailFolders/inbox/messages/delta?$deltatoken=abc`,
    });
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/mailbox mismatch/i);
  });

  test('passes a /me token through when no mailbox is supplied', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    const deltaLink =
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc';
    const result = await handleListEmailsDelta({ deltaToken: deltaLink });
    expect(endpointOfCall()).toBe(deltaLink);
    expect(result._meta.mailbox).toBe('me');
  });

  test('surfaces the resolver error instead of querying Graph', async () => {
    resolveFolder.mockRejectedValue(new Error('Folder "Nope" not found.'));
    const result = await handleListEmailsDelta({
      folder: 'Nope',
      sharedMailbox: MAILBOX,
    });
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/not found/i);
  });
});

describe('message-id lookup — shared-mailbox routing', () => {
  test('routes GET to /users/{mailbox}/messages when sharedMailbox is set', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    await handleSearchByMessageId({
      messageId: '<abc123@example.com>',
      sharedMailbox: MAILBOX,
    });
    expect(endpointOfCall()).toBe(`users/${MAILBOX}/messages`);
  });

  test('accepts `email` as an alias', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    await handleSearchByMessageId({
      messageId: '<abc123@example.com>',
      email: MAILBOX,
    });
    expect(endpointOfCall()).toBe(`users/${MAILBOX}/messages`);
  });

  test('defaults to /me/messages when no mailbox supplied', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    await handleSearchByMessageId({ messageId: '<abc123@example.com>' });
    expect(endpointOfCall()).toBe('me/messages');
  });
});

describe('search-emails router — forwards sharedMailbox to message-id lookup', () => {
  test('internetMessageId + sharedMailbox reaches /users/{mailbox}/messages', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    await searchEmailsHandler({
      internetMessageId: '<abc123@example.com>',
      sharedMailbox: MAILBOX,
    });
    // Proves the router no longer drops sharedMailbox before the handler.
    expect(endpointOfCall()).toBe(`users/${MAILBOX}/messages`);
  });

  test('internetMessageId without mailbox stays on /me/messages', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    await searchEmailsHandler({ internetMessageId: '<abc123@example.com>' });
    expect(endpointOfCall()).toBe('me/messages');
  });
});

// `search-emails` with no filters falls through to list mode (email/list.js),
// which used to resolve the folder against /me regardless of sharedMailbox —
// silently listing the WRONG mailbox.
describe('search-emails list-mode fallthrough — shared-mailbox routing', () => {
  const { callGraphAPIPaginated } = require('../../utils/graph-api');

  test('no-filter call with sharedMailbox lists the shared mailbox folder', async () => {
    resolveFolder.mockResolvedValue({
      id: 'sub-id',
      displayName: 'Vendors',
      parentId: null,
      path: 'Inbox/Vendors',
    });
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await searchEmailsHandler({
      folder: 'Inbox/Vendors',
      sharedMailbox: MAILBOX,
    });

    expect(resolveFolder).toHaveBeenCalledWith(TOKEN, {
      name: 'Inbox/Vendors',
      mailbox: MAILBOX,
    });
    expect(callGraphAPIPaginated.mock.calls[0][2]).toBe(
      `users/${MAILBOX}/mailFolders/sub-id/messages`
    );
  });

  test('no-filter call without a mailbox stays on /me', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await searchEmailsHandler({ folder: 'inbox' });

    // Well-known folders short-circuit the resolver entirely.
    expect(callGraphAPIPaginated.mock.calls[0][2]).toBe(
      'me/mailFolders/inbox/messages'
    );
  });
});
