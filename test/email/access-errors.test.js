/**
 * A 401 or 403 from Microsoft Graph on a listing, or while a named folder is
 * being resolved, is the same tool error a search gives (#341): sign in, or
 * the refusal with `auth action=about`, never the raw response text or advice
 * to try the `folders` tool. The real folder resolver runs; only the Graph
 * client is mocked, with errors shaped as the client throws them.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { emailTools } = require('../../email');
const { resolveFolderPath } = require('../../email/folder-utils');
const { handleBatchExportEmails } = require('../../email/export');
const { accessError } = require('../../utils/graph-failure');
const { authRequiredError } = require('../../utils/tool-error');
const {
  callGraphAPI,
  callGraphAPIPaginated,
} = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { enableSharedMailbox } = require('../helpers/shared-mailbox');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

enableSharedMailbox();

const searchEmails = emailTools.find((t) => t.name === 'search-emails').handler;

const unauthorised = () =>
  Object.assign(new Error('UNAUTHORIZED'), { status: 401 });
const forbidden = () =>
  Object.assign(
    new Error(
      'API call failed with status 403: {"error":{"code":"ErrorAccessDenied","message":"Access is denied. Check credentials and try again."}}'
    ),
    { status: 403, graphCode: 'ErrorAccessDenied' }
  );
const serverError = () =>
  Object.assign(
    new Error(
      'API call failed with status 500: {"error":{"code":"InternalServerError","message":"x"}}'
    ),
    { status: 500, graphCode: 'InternalServerError' }
  );

const AUTH_TEXT = authRequiredError().content[0].text;
const ABOUT = 'Next step: Run `auth` with action=about';
const MESSAGE = {
  id: 'm1',
  subject: 'Hello',
  from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
  receivedDateTime: '2026-01-01T00:00:00Z',
  isRead: true,
};

/** Every Graph request fails with a fresh error from `make`. */
function failEverything(make) {
  callGraphAPI.mockImplementation(() => Promise.reject(make()));
  callGraphAPIPaginated.mockImplementation(() => Promise.reject(make()));
}

function expectRefusal(result, what) {
  const text = result.content[0].text;
  expect(result.isError).toBe(true);
  expect(text).toContain(
    `Microsoft Graph refused this ${what} (403 ErrorAccessDenied).`
  );
  expect(text).toContain(ABOUT);
  // Status and code only: not Graph's response body, and no other tool.
  expect(text).not.toContain('Access is denied');
  expect(text).not.toContain('folders');
  expect(text).not.toContain('Error ');
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue('token');
});
afterEach(() => {
  console.error.mockRestore();
});

describe('accessError', () => {
  test('a 401 is the sign-in error, in either shape the client gives', () => {
    expect(accessError(unauthorised(), null, 'listing')).toEqual(
      authRequiredError()
    );
    expect(accessError(new Error('UNAUTHORIZED'), null, 'listing')).toEqual(
      authRequiredError()
    );
  });

  test('a 403 names what was refused, by status and code', () => {
    expectRefusal(accessError(forbidden(), null, 'listing'), 'listing');
  });

  test('a 403 on a shared mailbox names it, with the usual causes', () => {
    const text = accessError(forbidden(), 'team@corp.com', 'listing').content[0]
      .text;

    expect(text).toContain(
      'Access denied to shared mailbox "team@corp.com" (403 ErrorAccessDenied).'
    );
    expect(text).toContain('Mail.Read.Shared');
    expect(text).toContain(ABOUT);
  });

  test.each([
    ['a 500', serverError()],
    [
      'a 400',
      Object.assign(new Error('API call failed with status 400: {}'), {
        status: 400,
      }),
    ],
    ['a 404', Object.assign(new Error('x'), { status: 404 })],
    ['an error with no status', new Error('Folder "X" not found.')],
  ])('%s is left to the handler', (_n, error) => {
    expect(accessError(error, null, 'listing')).toBeNull();
  });
});

describe('resolveFolderPath', () => {
  test.each([
    ['401', unauthorised],
    ['403', forbidden],
  ])(
    'passes a %s on as it is, without the folders advice',
    async (_n, make) => {
      const error = make();
      callGraphAPI.mockRejectedValue(error);

      await expect(resolveFolderPath('token', 'Projects')).rejects.toBe(error);
    }
  );

  test('still wraps any other failure (control)', async () => {
    callGraphAPI.mockRejectedValue(serverError());

    await expect(resolveFolderPath('token', 'Projects')).rejects.toThrow(
      'Error resolving folder "Projects": API call failed with status 500'
    );
    await expect(resolveFolderPath('token', 'Projects')).rejects.toThrow(
      'Use the folders tool (action=list) to see available folders.'
    );
  });
});

describe('search-emails: a plain listing', () => {
  test('401: sign in', async () => {
    failEverything(unauthorised);

    const result = await searchEmails({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(AUTH_TEXT);
    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
  });

  test('403: the refusal, with auth about as the next step', async () => {
    failEverything(forbidden);

    expectRefusal(await searchEmails({ count: 5 }), 'listing');
    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
  });

  test('403 on a shared mailbox names the mailbox', async () => {
    failEverything(forbidden);

    const result = await searchEmails({ sharedMailbox: 'team@corp.com' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      'Access denied to shared mailbox "team@corp.com" (403 ErrorAccessDenied).'
    );
    expect(result.content[0].text).toContain(ABOUT);
  });

  test('any other failure keeps its text (control)', async () => {
    failEverything(serverError);

    const result = await searchEmails({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Error listing emails: API call failed with status 500: {"error":{"code":"InternalServerError","message":"x"}}'
    );
  });

  test('a listing that succeeds is unchanged (control)', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [MESSAGE] });

    const result = await searchEmails({});

    expect(result.isError).toBeUndefined();
    expect(result._meta.returned).toBe(1);
    expect(callGraphAPIPaginated).toHaveBeenCalledWith(
      'token',
      'GET',
      'me/mailFolders/inbox/messages',
      expect.objectContaining({ $orderby: 'receivedDateTime desc' }),
      expect.any(Number)
    );
  });
});

describe('search-emails: resolving a named folder', () => {
  const MODES = [
    ['a listing', { folder: 'Projects' }, 'listing'],
    ['a search', { folder: 'Projects', subject: 'invoice' }, 'search'],
    [
      'a conversation listing',
      { folder: 'Projects', groupByConversation: true },
      'listing',
    ],
  ];

  test.each(MODES)('401 in %s: sign in', async (_n, args) => {
    failEverything(unauthorised);

    const result = await searchEmails(args);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(AUTH_TEXT);
    // The folder lookup failed, so no message request was made.
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    expect(callGraphAPIPaginated).not.toHaveBeenCalled();
  });

  test.each(MODES)('403 in %s: the refusal', async (_n, args, what) => {
    failEverything(forbidden);

    expectRefusal(await searchEmails(args), what);
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    expect(callGraphAPIPaginated).not.toHaveBeenCalled();
  });

  test('a folder that does not exist keeps its own message (control)', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await searchEmails({ folder: 'Projects' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Folder "Projects" not found.');
  });

  test('a named folder that resolves is listed as before (control)', async () => {
    callGraphAPI.mockResolvedValue({
      value: [{ id: 'folder-1', displayName: 'Projects', childFolderCount: 0 }],
    });
    callGraphAPIPaginated.mockResolvedValue({ value: [MESSAGE] });

    const result = await searchEmails({ folder: 'Projects' });

    expect(result.isError).toBeUndefined();
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    expect(callGraphAPIPaginated.mock.calls[0][2]).toBe(
      'me/mailFolders/folder-1/messages'
    );
  });
});

describe('export: the search behind a batch export', () => {
  let outputDir;
  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-access-'));
  });
  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  const exportFrom = (folder) =>
    handleBatchExportEmails({
      outputDir,
      searchQuery: { subject: 'invoice', ...(folder && { folder }) },
    });

  test.each([
    ['the search request', undefined],
    ['the folder lookup', 'Projects'],
  ])('401 on %s: sign in', async (_n, folder) => {
    failEverything(unauthorised);

    const result = await exportFrom(folder);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(AUTH_TEXT);
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['the search request', undefined],
    ['the folder lookup', 'Projects'],
  ])('403 on %s: the refusal', async (_n, folder) => {
    failEverything(forbidden);

    expectRefusal(await exportFrom(folder), 'export');
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });

  test('any other failure keeps its text (control)', async () => {
    failEverything(serverError);

    const result = await exportFrom();

    expect(result.content[0].text).toMatch(
      /^Batch export failed: API call failed with status 500/
    );
  });
});
