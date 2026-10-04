/**
 * Graph client logging (#278): a failed request is summarised on the tool
 * call's line as status + method + a PII-free path shape; the response body,
 * query string and addresses stay out of default stderr. Retries are counted,
 * with detail only under OUTLOOK_DEBUG.
 */
const https = require('https');
const { EventEmitter } = require('events');
const config = require('../../config');
const { withCallContext } = require('../../utils/logger');

jest.mock('https');

const { callGraphAPI } = require('../../utils/graph-api');

const ADDRESS = 'jane.doe@example.com';
const GRAPH_ID =
  'AAMkADQ5ZTY0YjU1LTk2ZWYtNDQ2Mi1iZTlhLTc0ZmM2ZDM4MzRkMgBGAAAAAACj3l1aVDpZQ5l9nrZ8w2hWBwBp2ZlAAA=';
const ERROR_BODY = JSON.stringify({
  error: {
    code: 'ErrorAccessDenied',
    message: `Access is denied for ${ADDRESS}`,
  },
});

const originalTestMode = config.USE_TEST_MODE;
const savedDebug = process.env.OUTLOOK_DEBUG;
let outcomes;
let errorSpy;

function script(...entries) {
  outcomes = entries;
}

beforeEach(() => {
  delete process.env.OUTLOOK_DEBUG;
  config.USE_TEST_MODE = false;
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  https.request.mockImplementation((_url, _options, callback) => {
    const outcome = outcomes.shift() || { status: 200, body: '{}' };
    const req = new EventEmitter();
    req.write = jest.fn();
    req.destroy = jest.fn();
    req.end = jest.fn(() => {
      Promise.resolve().then(() => {
        if (outcome.errorCode) {
          const err = new Error(`connect ${outcome.errorCode}`);
          err.code = outcome.errorCode;
          req.emit('error', err);
          return;
        }
        const res = new EventEmitter();
        res.statusCode = outcome.status;
        res.headers = outcome.headers || {};
        res.setEncoding = jest.fn();
        callback(res);
        res.emit('data', outcome.body || '{}');
        res.emit('end');
      });
    });
    return req;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  config.USE_TEST_MODE = originalTestMode;
  if (savedDebug === undefined) delete process.env.OUTLOOK_DEBUG;
  else process.env.OUTLOOK_DEBUG = savedDebug;
});

const stderr = () => errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');

/** Run inside a tool-call context and return [error, notes]. */
function inCall(fn) {
  return withCallContext(async (ctx) => {
    let error;
    try {
      await fn();
    } catch (e) {
      error = e;
    }
    return [error, ctx.notes];
  });
}

test('a Graph error status is noted as status, method and path shape only', async () => {
  script({ status: 403, body: ERROR_BODY });
  const [error, notes] = await inCall(() =>
    callGraphAPI(
      'token',
      'GET',
      `users/${ADDRESS}/messages/${GRAPH_ID}`,
      null,
      {
        $search: '"secret merger"',
      }
    )
  );
  expect(error).toBeDefined();
  expect(notes.get('graph')).toBe('403 GET users/<mailbox>/messages/{id}');
  // Nothing written by default: the dispatcher prints the note on its line.
  expect(errorSpy).not.toHaveBeenCalled();
});

test('a network failure is noted with its error code', async () => {
  script({ errorCode: 'ECONNREFUSED' });
  const [error, notes] = await inCall(() =>
    callGraphAPI('token', 'POST', 'me/sendMail', { message: {} })
  );
  expect(error).toBeDefined();
  expect(notes.get('graph')).toBe('ECONNREFUSED POST me/sendMail');
  expect(errorSpy).not.toHaveBeenCalled();
});

test('retries are counted, with no default-level line', async () => {
  script(
    { status: 429, headers: { 'retry-after': '0' }, body: '{}' },
    { status: 200, body: '{"value":[]}' }
  );
  const [error, notes] = await inCall(() =>
    callGraphAPI('token', 'GET', 'me/messages')
  );
  expect(error).toBeUndefined();
  expect(notes.get('graphRetries')).toBe(1);
  expect(notes.has('graph')).toBe(false);
  expect(errorSpy).not.toHaveBeenCalled();
});

test('debug shows the retry and error detail, redacted', async () => {
  process.env.OUTLOOK_DEBUG = 'true';
  script(
    { status: 429, headers: { 'retry-after': '0' }, body: '{}' },
    { status: 403, body: ERROR_BODY }
  );
  await inCall(() =>
    callGraphAPI('token-abc', 'GET', `users/${ADDRESS}/messages`)
  );
  const text = stderr();
  expect(text).toMatch(/\[debug\].*retry 1\/\d/);
  expect(text).not.toContain(ADDRESS);
  expect(text).not.toContain('token-abc');
});
