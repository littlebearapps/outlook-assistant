// Regression tests for GHSA-mqfm-wfjq-jxq2: callGraphAPI accepts full URLs
// (nextLink / deltaLink continuation) and always attaches the bearer token,
// so it must refuse any URL that isn't the configured Graph host over HTTPS.

const https = require('https');
const { EventEmitter } = require('events');
const config = require('../../config');

jest.mock('https');
jest.mock('../../auth');

const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const handleListEmailsDelta = require('../../email/delta');

const originalTestMode = config.USE_TEST_MODE;
const originalEndpoint = config.GRAPH_API_ENDPOINT;

function mockHttpsOk(body = { value: [] }) {
  https.request.mockImplementation((_url, _options, callback) => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end = jest.fn();
    const res = new EventEmitter();
    res.statusCode = 200;
    process.nextTick(() => {
      callback(res);
      res.emit('data', JSON.stringify(body));
      res.emit('end');
    });
    return req;
  });
}

beforeAll(() => {
  config.GRAPH_API_ENDPOINT = 'https://graph.microsoft.com/v1.0/';
});

afterAll(() => {
  config.USE_TEST_MODE = originalTestMode;
  config.GRAPH_API_ENDPOINT = originalEndpoint;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'log').mockImplementation();
  config.USE_TEST_MODE = false;
  mockHttpsOk();
});

afterEach(() => {
  console.error.mockRestore();
  console.log.mockRestore();
});

describe('callGraphAPI full-URL host allowlist (GHSA-mqfm)', () => {
  test.each([
    'https://attacker.example/x',
    'http://graph.microsoft.com/v1.0/me/messages',
    'https://graph.microsoft.com@attacker.example/v1.0/me',
    'https://user:pass@graph.microsoft.com/v1.0/me',
    'https://graph.microsoft.com.attacker.example/v1.0/me',
    'https://attacker.example/graph.microsoft.com/v1.0/me',
    'https://evilgraph.microsoft.com/v1.0/me',
    'https://graph.microsoft.com:8443/v1.0/me',
    'http://localhost/test',
    'https://not a url',
  ])('rejects %j without sending a request', async (url) => {
    await expect(callGraphAPI('secret-token', 'GET', url)).rejects.toThrow(
      /Refusing to call non-Graph URL/
    );
    expect(https.request).not.toHaveBeenCalled();
  });

  test('the rejection message never contains the access token', async () => {
    const error = await callGraphAPI(
      'secret-token',
      'GET',
      'https://attacker.example/x'
    ).catch((e) => e);

    expect(error.message).not.toContain('secret-token');
  });

  test.each([
    'https://graph.microsoft.com/v1.0/me/messages?$skip=10',
    'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc',
    'https://GRAPH.microsoft.com/v1.0/me/messages',
    'https://graph.microsoft.com:443/v1.0/me/messages',
  ])('accepts genuine Graph continuation URL %j', async (url) => {
    await callGraphAPI('secret-token', 'GET', url);

    expect(https.request).toHaveBeenCalledTimes(1);
    expect(https.request.mock.calls[0][0]).toBe(url);
  });

  test('relative paths still resolve against the configured endpoint', async () => {
    await callGraphAPI('secret-token', 'GET', 'me/messages');

    expect(https.request.mock.calls[0][0]).toBe(
      'https://graph.microsoft.com/v1.0/me/messages'
    );
  });
});

describe('search-emails deltaMode with a hostile deltaToken (GHSA-mqfm)', () => {
  test('never sends the bearer token to a foreign host', async () => {
    ensureAuthenticated.mockResolvedValue('secret-token');

    const result = await handleListEmailsDelta({
      deltaToken: 'https://attacker.example/steal',
    });

    expect(https.request).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain('secret-token');
  });
});
