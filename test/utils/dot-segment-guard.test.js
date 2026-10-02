/**
 * Caller-supplied IDs are interpolated into Graph resource paths. A `.`/`..`
 * segment survives encodeURIComponent and the URL parser then resolves it,
 * walking the request to a different resource (another mailbox, another API
 * version). These tests run the REAL graph-api module with `https` mocked and
 * assert that no request is ever issued for such paths — for reads, PATCH,
 * DELETE, raw MIME, $batch, and a relative deltaToken.
 */
const https = require('https');
const { EventEmitter } = require('events');
const config = require('../../config');

jest.mock('https');
jest.mock('../../auth');

const { ensureAuthenticated } = require('../../auth');
const {
  assertSafeResourcePath,
  callGraphAPI,
  callGraphAPIRaw,
  callGraphAPIBatch,
} = require('../../utils/graph-api');
const handleReadEmail = require('../../email/read');
const handleMarkAsRead = require('../../email/mark-as-read');
const handleDraft = require('../../email/draft');
const handleListEmailsDelta = require('../../email/delta');
const { handleGetMimeContent } = require('../../email/mime');

const originalTestMode = config.USE_TEST_MODE;

function mockOk(body = { value: [] }) {
  https.request.mockImplementation((_url, _opts, cb) => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.setTimeout = jest.fn();
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = jest.fn();
      process.nextTick(() => {
        cb(res);
        res.emit('data', JSON.stringify(body));
        res.emit('end');
      });
    };
    return req;
  });
}

function textOf(result) {
  return result.content.map((c) => c.text).join('\n');
}

const TRAVERSALS = [
  '../../users/victim@contoso.com/messages/AAA',
  'AAA/../../../beta/me',
  '%2e%2e/%2e%2e/users/victim@contoso.com/messages/AAA',
  '%2E%2E/x',
  '%252e%252e/x',
  './AAA',
];

beforeEach(() => {
  jest.clearAllMocks();
  config.USE_TEST_MODE = false;
  ensureAuthenticated.mockResolvedValue('tok');
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockOk();
});

afterEach(() => {
  console.error.mockRestore();
});

afterAll(() => {
  config.USE_TEST_MODE = originalTestMode;
});

describe('assertSafeResourcePath', () => {
  test.each(TRAVERSALS)('rejects %s', (id) => {
    expect(() => assertSafeResourcePath(`me/messages/${id}`)).toThrow(
      /dot|"\."/
    );
  });

  test('accepts ordinary Graph ids, including dots inside a segment', () => {
    expect(() =>
      assertSafeResourcePath(
        'users/first.last@contoso.com/messages/AAMkAGI2..x=/attachments'
      )
    ).not.toThrow();
  });

  test('ignores the query string', () => {
    expect(() =>
      assertSafeResourcePath("me/messages?$filter=subject eq '../..'")
    ).not.toThrow();
  });
});

describe('callGraphAPI never issues a request for dot-segment paths', () => {
  test.each(['GET', 'PATCH', 'DELETE'])('%s is refused', async (method) => {
    await expect(
      callGraphAPI('tok', method, `me/messages/${TRAVERSALS[0]}`, {
        isRead: true,
      })
    ).rejects.toThrow(/Invalid resource path/);
    expect(https.request).not.toHaveBeenCalled();
  });

  test('normal paths still go out', async () => {
    await callGraphAPI('tok', 'GET', 'me/messages/AAMk=');
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(https.request.mock.calls[0][0]).toBe(
      'https://graph.microsoft.com/v1.0/me/messages/AAMk%3D'
    );
  });
});

describe('callGraphAPIRaw / callGraphAPIBatch', () => {
  test('raw MIME refuses a bare ".." id', async () => {
    await expect(callGraphAPIRaw('tok', '..')).rejects.toThrow(
      /Invalid resource path/
    );
    expect(https.request).not.toHaveBeenCalled();
  });

  test('raw MIME refuses a dot segment in the mailbox prefix', async () => {
    await expect(callGraphAPIRaw('tok', 'AAA', 'me/..')).rejects.toThrow(
      /Invalid resource path/
    );
    expect(https.request).not.toHaveBeenCalled();
  });

  test('$batch refuses a sub-request with a dot segment', async () => {
    await expect(
      callGraphAPIBatch('tok', [
        { id: '1', method: 'GET', url: '/me/messages/AAA' },
        { id: '2', method: 'DELETE', url: `/me/messages/${TRAVERSALS[0]}` },
      ])
    ).rejects.toThrow(/Invalid resource path/);
    expect(https.request).not.toHaveBeenCalled();
  });
});

describe('tool handlers surface the refusal instead of reaching another resource', () => {
  test('read-email (GET)', async () => {
    const result = await handleReadEmail({ id: TRAVERSALS[0] });
    expect(https.request).not.toHaveBeenCalled();
    expect(textOf(result)).toMatch(/Invalid resource path/);
  });

  test('update-email mark-read (PATCH)', async () => {
    const result = await handleMarkAsRead({ id: TRAVERSALS[0], isRead: true });
    expect(https.request).not.toHaveBeenCalled();
    expect(textOf(result)).toMatch(/Invalid resource path/);
  });

  test('draft delete (DELETE)', async () => {
    const result = await handleDraft({ action: 'delete', id: TRAVERSALS[0] });
    expect(https.request).not.toHaveBeenCalled();
    expect(textOf(result)).toMatch(/Invalid resource path/);
  });

  test('export target=mime (raw)', async () => {
    const result = await handleGetMimeContent({ id: '..' });
    expect(https.request).not.toHaveBeenCalled();
    expect(textOf(result)).toMatch(/Invalid resource path/);
  });

  test('a relative deltaToken cannot dot-walk past the mailbox binding (F7)', async () => {
    const result = await handleListEmailsDelta({
      deltaToken:
        'me/../users/victim@contoso.com/mailFolders/inbox/messages/delta',
    });
    expect(https.request).not.toHaveBeenCalled();
    expect(textOf(result)).toMatch(/Invalid resource path/);
  });
});
