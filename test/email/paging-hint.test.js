/**
 * The "more emails available" hint (#279), end to end: dispatcher →
 * search-emails → callGraphAPIPaginated → mocked HTTPS. When Graph has
 * another page beyond `count`, the result must say so and must not present
 * the page size as a total.
 */
const https = require('https');
const { EventEmitter } = require('events');

jest.mock('https');

const config = require('../../config');
const { createRequestHandler } = require('../../request-handler');
const { TOOLS } = require('../../tools');
const { tokenStorage } = require('../../auth');

const call = createRequestHandler(TOOLS);
const originalEndpoint = config.GRAPH_API_ENDPOINT;
const originalTestMode = config.USE_TEST_MODE;

const NEXT = 'https://graph.microsoft.com/v1.0/me/messages?$skip=2';

function message(id) {
  return {
    id,
    subject: `Report ${id}`,
    from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
    receivedDateTime: '2026-01-01T09:00:00Z',
    isRead: false,
    bodyPreview: 'Hello',
  };
}

/** Every Graph request answers with `body`. */
function graphAnswers(body) {
  https.request.mockImplementation((_url, _options, callback) => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end = jest.fn();
    req.setTimeout = jest.fn();
    req.destroy = jest.fn();
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.setEncoding = jest.fn();
    process.nextTick(() => {
      callback(res);
      res.emit('data', JSON.stringify(body));
      res.emit('end');
    });
    return req;
  });
}

function search(args) {
  return call({
    method: 'tools/call',
    params: { name: 'search-emails', arguments: args },
    id: 1,
  });
}

beforeAll(() => {
  config.GRAPH_API_ENDPOINT = 'https://graph.microsoft.com/v1.0/';
  config.USE_TEST_MODE = false;
});

afterAll(() => {
  config.GRAPH_API_ENDPOINT = originalEndpoint;
  config.USE_TEST_MODE = originalTestMode;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(tokenStorage, 'getValidAccessToken').mockResolvedValue('token');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ['list mode', { count: 2 }],
  ['search mode', { subject: 'Report', count: 2 }],
])('%s', (_label, args) => {
  test('shows the hint when Graph has another page', async () => {
    graphAnswers({
      value: [message('a'), message('b')],
      '@odata.nextLink': NEXT,
    });

    const result = await search(args);
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(result._meta.returned).toBe(2);
    expect(result._meta.hasMore).toBe(true);
    expect(result._meta.totalAvailable).toBeNull();
    expect(text).toContain('More emails available');
    // "(2/2)" would present the page size as the total.
    expect(text).not.toContain('(2/2)');
  });

  test('shows the hint when items beyond count were trimmed', async () => {
    graphAnswers({ value: [message('a'), message('b'), message('c')] });

    const result = await search(args);

    expect(result._meta.returned).toBe(2);
    expect(result._meta.hasMore).toBe(true);
    expect(result.content[0].text).toContain('More emails available');
  });

  test('shows no hint when everything fitted', async () => {
    graphAnswers({ value: [message('a'), message('b')] });

    const result = await search(args);

    expect(result._meta.hasMore).toBe(false);
    expect(result.content[0].text).not.toContain('More emails available');
  });
});
