/**
 * Graph client resilience (#244): retries on throttling/transient statuses,
 * request timeout, a concurrency gate, and no mutation of caller queryParams.
 *
 * `https` is mocked with a scripted queue of outcomes; fake timers drive
 * Retry-After / backoff sleeps and request timeouts deterministically.
 */
const https = require('https');
const { EventEmitter } = require('events');
const config = require('../../config');

jest.mock('https');

const { callGraphAPI, callGraphAPIRaw } = require('../../utils/graph-api');

const originalTestMode = config.USE_TEST_MODE;
const originalEndpoint = config.GRAPH_API_ENDPOINT;
const originalTimeout = config.REQUEST_TIMEOUT_MS;

let outcomes;
let inFlight;
let maxInFlight;

/**
 * Script the next https.request outcomes, in order. Each entry is one of:
 *   { status, headers?, body?, delayMs? } — respond (optionally after delayMs)
 *   { stall: true }                        — never respond (only a timeout ends it)
 *   { errorCode }                          — emit a socket error with that code
 */
function script(...entries) {
  outcomes = entries;
}

function installMock() {
  inFlight = 0;
  maxInFlight = 0;
  https.request.mockImplementation((_url, options, callback) => {
    const outcome = outcomes.shift() || { status: 200, body: {} };
    const req = new EventEmitter();
    req.write = jest.fn();
    req.destroy = jest.fn((err) => {
      if (err) req.emit('error', err);
    });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        inFlight -= 1;
      }
    };
    req.on('error', finish);

    req.end = jest.fn(() => {
      if (outcome.stall) {
        // Emulate Node's socket idle timeout from the `timeout` option.
        if (options.timeout) {
          setTimeout(() => req.emit('timeout'), options.timeout);
        }
        return;
      }
      if (outcome.errorCode) {
        Promise.resolve().then(() => {
          const err = new Error(`socket ${outcome.errorCode}`);
          err.code = outcome.errorCode;
          req.emit('error', err);
        });
        return;
      }
      const respond = () => {
        const res = new EventEmitter();
        res.statusCode = outcome.status;
        res.headers = outcome.headers || {};
        res.setEncoding = jest.fn();
        callback(res);
        const body =
          typeof outcome.body === 'string'
            ? outcome.body
            : JSON.stringify(outcome.body || {});
        res.emit('data', body);
        finish();
        res.emit('end');
      };
      if (outcome.delayMs) {
        setTimeout(respond, outcome.delayMs);
      } else {
        Promise.resolve().then(respond);
      }
    });
    return req;
  });
}

/** Attach a no-op catch so a rejection seen only after timers isn't "unhandled". */
function track(promise) {
  const state = { settled: false, value: undefined, error: undefined };
  promise.then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error) => {
      state.settled = true;
      state.error = error;
    }
  );
  return state;
}

const THROTTLED = '{"error":{"code":"TooManyRequests","message":"Slow down"}}';

beforeAll(() => {
  config.GRAPH_API_ENDPOINT = 'https://graph.microsoft.com/v1.0/';
});

afterAll(() => {
  config.USE_TEST_MODE = originalTestMode;
  config.GRAPH_API_ENDPOINT = originalEndpoint;
  config.REQUEST_TIMEOUT_MS = originalTimeout;
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  config.USE_TEST_MODE = false;
  config.REQUEST_TIMEOUT_MS = 60000;
  script();
  installMock();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('config: OUTLOOK_REQUEST_TIMEOUT_MS', () => {
  const original = process.env.OUTLOOK_REQUEST_TIMEOUT_MS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.OUTLOOK_REQUEST_TIMEOUT_MS;
    } else {
      process.env.OUTLOOK_REQUEST_TIMEOUT_MS = original;
    }
  });

  function loadTimeout() {
    let value;
    jest.isolateModules(() => {
      value = require('../../config').REQUEST_TIMEOUT_MS;
    });
    return value;
  }

  it('defaults to 60000 ms', () => {
    delete process.env.OUTLOOK_REQUEST_TIMEOUT_MS;
    expect(loadTimeout()).toBe(60000);
  });

  it('honours a positive integer override', () => {
    process.env.OUTLOOK_REQUEST_TIMEOUT_MS = '1500';
    expect(loadTimeout()).toBe(1500);
  });

  it('falls back to the default for invalid values', () => {
    jest.spyOn(console, 'warn').mockImplementation();
    process.env.OUTLOOK_REQUEST_TIMEOUT_MS = 'soon';
    expect(loadTimeout()).toBe(60000);
    process.env.OUTLOOK_REQUEST_TIMEOUT_MS = '0';
    expect(loadTimeout()).toBe(60000);
  });
});

describe('callGraphAPI retries', () => {
  it('passes the configured timeout to https.request', async () => {
    script({ status: 200, body: { ok: true } });
    await expect(callGraphAPI('token', 'GET', 'me/messages')).resolves.toEqual({
      ok: true,
    });
    expect(https.request.mock.calls[0][1].timeout).toBe(60000);
  });

  it('honours Retry-After (seconds) on 429 before retrying a GET', async () => {
    script(
      { status: 429, headers: { 'retry-after': '2' }, body: THROTTLED },
      { status: 200, body: { value: ['ok'] } }
    );
    const state = track(callGraphAPI('token', 'GET', 'me/messages'));

    await jest.advanceTimersByTimeAsync(1999);
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(state.settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.value).toEqual({ value: ['ok'] });
  });

  it('retries a 503 without Retry-After after a jittered exponential backoff', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    script(
      { status: 503, body: 'Service Unavailable' },
      { status: 200, body: { ok: 1 } }
    );
    const state = track(callGraphAPI('token', 'GET', 'me/messages'));

    // Full jitter: random() * min(cap, 1000 * 2^0) = 500 ms for the 1st retry.
    await jest.advanceTimersByTimeAsync(499);
    expect(https.request).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.value).toEqual({ ok: 1 });
  });

  it('retries 504 on PATCH, PUT and DELETE', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      https.request.mockClear();
      script({ status: 504, body: 'Gateway Timeout' }, { status: 204 });
      const state = track(
        callGraphAPI('token', method, 'me/messages/abc', { isRead: true })
      );
      await jest.advanceTimersByTimeAsync(0);
      expect(https.request).toHaveBeenCalledTimes(2);
      expect(state.value).toEqual({});
    }
  });

  it('gives up after 4 attempts (3 retries) and surfaces the Graph message', async () => {
    script(
      { status: 429, headers: { 'retry-after': '1' }, body: THROTTLED },
      { status: 429, headers: { 'retry-after': '1' }, body: THROTTLED },
      { status: 429, headers: { 'retry-after': '1' }, body: THROTTLED },
      { status: 429, headers: { 'retry-after': '1' }, body: THROTTLED },
      { status: 200, body: { never: true } }
    );
    const state = track(callGraphAPI('token', 'GET', 'me/messages'));

    await jest.advanceTimersByTimeAsync(10000);
    expect(https.request).toHaveBeenCalledTimes(4);
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error.message).toMatch(/^API call failed with status 429: /);
    expect(state.error.message).toContain('Slow down');
  });

  it('fails fast when Retry-After exceeds 60 seconds', async () => {
    script(
      { status: 429, headers: { 'retry-after': '120' }, body: THROTTLED },
      { status: 200, body: {} }
    );
    await expect(callGraphAPI('token', 'GET', 'me/messages')).rejects.toThrow(
      /API call failed with status 429: .*Slow down/
    );
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it('never retries 401 (stays UNAUTHORIZED)', async () => {
    script({ status: 401, body: 'nope' }, { status: 200, body: {} });
    await expect(callGraphAPI('token', 'GET', 'me/messages')).rejects.toThrow(
      'UNAUTHORIZED'
    );
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it('does not retry other 4xx/5xx statuses', async () => {
    script({ status: 500, body: 'boom' }, { status: 200, body: {} });
    await expect(callGraphAPI('token', 'GET', 'me/messages')).rejects.toThrow(
      'API call failed with status 500'
    );
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it('retries a GET once on ECONNRESET', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    script({ errorCode: 'ECONNRESET' }, { status: 200, body: { ok: 2 } });
    const state = track(callGraphAPI('token', 'GET', 'me/messages'));
    await jest.advanceTimersByTimeAsync(0);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.value).toEqual({ ok: 2 });
  });

  it('retries a GET network error only once', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    script(
      { errorCode: 'ECONNRESET' },
      { errorCode: 'ECONNRESET' },
      { status: 200, body: {} }
    );
    const state = track(callGraphAPI('token', 'GET', 'me/messages'));
    await jest.advanceTimersByTimeAsync(0);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.error.message).toMatch(
      /^Network error during API call: socket ECONNRESET/
    );
  });
});

describe('callGraphAPI POST is retried only on 429', () => {
  it('does not retry POST me/sendMail after a timeout', async () => {
    config.REQUEST_TIMEOUT_MS = 5000;
    script({ stall: true }, { status: 202 });
    const state = track(
      callGraphAPI('token', 'POST', 'me/sendMail', { message: {} })
    );

    await jest.advanceTimersByTimeAsync(4999);
    expect(state.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(60000);

    expect(https.request).toHaveBeenCalledTimes(1);
    expect(state.error.message).toMatch(/timed out after 5000 ms/);
    expect(state.error.code).toBe('ETIMEDOUT');
    expect(https.request.mock.results[0].value.destroy).toHaveBeenCalled();
  });

  it('does not retry POST on 503', async () => {
    script({ status: 503, body: 'busy' }, { status: 202 });
    await expect(
      callGraphAPI('token', 'POST', 'me/sendMail', { message: {} })
    ).rejects.toThrow('API call failed with status 503');
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it('does not retry POST on a network error', async () => {
    script({ errorCode: 'ECONNRESET' }, { status: 202 });
    await expect(
      callGraphAPI('token', 'POST', 'me/messages/abc/send')
    ).rejects.toThrow(/Network error during API call/);
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it('retries POST on 429, re-sending the same body', async () => {
    script(
      { status: 429, headers: { 'retry-after': '1' }, body: THROTTLED },
      { status: 202 }
    );
    const state = track(
      callGraphAPI('token', 'POST', 'me/sendMail', { message: { a: 1 } })
    );
    await jest.advanceTimersByTimeAsync(1000);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.value).toEqual({});
    const bodies = https.request.mock.results.map(
      (r) => r.value.write.mock.calls[0][0]
    );
    expect(bodies).toEqual(['{"message":{"a":1}}', '{"message":{"a":1}}']);
  });

  it('re-sends the same create-event transactionId on a 429 retry (#280)', async () => {
    script(
      { status: 429, headers: { 'retry-after': '1' }, body: THROTTLED },
      { status: 201, body: { id: 'evt-1' } }
    );
    const event = {
      subject: 'Team sync',
      transactionId: '1b4e28ba-2fa1-4d2b-883f-0016d3cca427',
    };
    const state = track(callGraphAPI('token', 'POST', 'me/events', event));
    await jest.advanceTimersByTimeAsync(1000);

    expect(state.value).toEqual({ id: 'evt-1' });
    const ids = https.request.mock.results.map(
      (r) => JSON.parse(r.value.write.mock.calls[0][0]).transactionId
    );
    expect(ids).toEqual([event.transactionId, event.transactionId]);
  });

  it('still retries POST on 429 with a short Retry-After (2 s)', async () => {
    script(
      { status: 429, headers: { 'retry-after': '2' }, body: THROTTLED },
      { status: 202 }
    );
    const state = track(
      callGraphAPI('token', 'POST', 'me/sendMail', { message: {} })
    );
    await jest.advanceTimersByTimeAsync(1999);
    expect(https.request).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.value).toEqual({});
  });

  it('does not retry POST on 429 when Retry-After exceeds 10 s', async () => {
    script(
      { status: 429, headers: { 'retry-after': '15' }, body: THROTTLED },
      { status: 202 }
    );
    await expect(
      callGraphAPI('token', 'POST', 'me/sendMail', { message: {} })
    ).rejects.toThrow(/^API call failed with status 429: .*Slow down/);
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it('stops retrying POST once cumulative sleep would exceed 20 s', async () => {
    // Retry-After 8 s: sleeps of 8 s and 16 s total fit the 20 s budget; a
    // third (24 s total) does not, so the third 429 is returned as an error.
    script(
      { status: 429, headers: { 'retry-after': '8' }, body: THROTTLED },
      { status: 429, headers: { 'retry-after': '8' }, body: THROTTLED },
      { status: 429, headers: { 'retry-after': '8' }, body: THROTTLED },
      { status: 202 }
    );
    const state = track(
      callGraphAPI('token', 'POST', 'me/sendMail', { message: {} })
    );
    await jest.advanceTimersByTimeAsync(60000);
    expect(https.request).toHaveBeenCalledTimes(3);
    expect(state.error.message).toMatch(/^API call failed with status 429: /);
  });

  it('applies no POST budget to other methods (PATCH keeps retrying)', async () => {
    script(
      { status: 429, headers: { 'retry-after': '15' }, body: THROTTLED },
      { status: 200, body: { ok: true } }
    );
    const state = track(
      callGraphAPI('token', 'PATCH', 'me/messages/abc', { isRead: true })
    );
    await jest.advanceTimersByTimeAsync(15000);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.value).toEqual({ ok: true });
  });
});

describe('writes are not retried after network failures', () => {
  it.each(['PUT', 'PATCH', 'DELETE'])(
    '%s is not retried after a timeout',
    async (method) => {
      config.REQUEST_TIMEOUT_MS = 5000;
      script({ stall: true }, { status: 200, body: {} });
      const state = track(
        callGraphAPI('token', method, 'me/messages/abc', { isRead: true })
      );
      await jest.advanceTimersByTimeAsync(5000);
      await jest.advanceTimersByTimeAsync(60000);
      expect(https.request).toHaveBeenCalledTimes(1);
      expect(state.error.code).toBe('ETIMEDOUT');
    }
  );

  it.each(['PUT', 'PATCH', 'DELETE'])(
    '%s is not retried after ECONNRESET',
    async (method) => {
      script({ errorCode: 'ECONNRESET' }, { status: 200, body: {} });
      await expect(
        callGraphAPI('token', method, 'me/messages/abc', { isRead: true })
      ).rejects.toThrow(/Network error during API call: socket ECONNRESET/);
      expect(https.request).toHaveBeenCalledTimes(1);
    }
  );
});

describe('Retry-After parsing', () => {
  it('falls back to backoff for a non-numeric (HTTP-date) Retry-After', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    script(
      {
        status: 429,
        headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' },
        body: THROTTLED,
      },
      { status: 200, body: { ok: 3 } }
    );
    const state = track(callGraphAPI('token', 'GET', 'me/messages'));
    await jest.advanceTimersByTimeAsync(499);
    expect(https.request).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.value).toEqual({ ok: 3 });
  });
});

describe('callGraphAPI timeout', () => {
  it('rejects a stalled GET at the timeout (after its single retry)', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    config.REQUEST_TIMEOUT_MS = 5000;
    script({ stall: true }, { stall: true }, { status: 200, body: {} });
    const state = track(callGraphAPI('token', 'GET', 'me/messages'));

    await jest.advanceTimersByTimeAsync(4999);
    expect(state.settled).toBe(false);
    expect(https.request).toHaveBeenCalledTimes(1);

    // First attempt timed out at 5000 ms; the 0 ms backoff (Math.random = 0)
    // is a fresh timer, so let the clock move on by one more tick.
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.settled).toBe(false);

    await jest.advanceTimersByTimeAsync(4999);
    expect(state.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.error.message).toMatch(
      /^Network error during API call: .*timed out after 5000 ms/
    );
  });
});

describe('callGraphAPI queryParams', () => {
  it('does not mutate the caller object, and every attempt keeps $filter', async () => {
    script(
      { status: 429, headers: { 'retry-after': '1' }, body: THROTTLED },
      { status: 200, body: { value: [] } }
    );
    const params = { $filter: "flag/flagStatus eq 'flagged'", $top: 5 };
    const state = track(
      callGraphAPI('token', 'GET', 'me/messages', null, params)
    );
    await jest.advanceTimersByTimeAsync(1000);

    expect(state.value).toEqual({ value: [] });
    expect(params).toEqual({
      $filter: "flag/flagStatus eq 'flagged'",
      $top: 5,
    });
    const urls = https.request.mock.calls.map((c) => c[0]);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain('$filter=flag%2FflagStatus');
      expect(url).toContain('%24top=5');
    }
  });
});

describe('concurrency gate', () => {
  it('never has more than 4 requests in flight', async () => {
    script(
      ...Array.from({ length: 10 }, (_, i) => ({
        status: 200,
        body: { i },
        delayMs: 100,
      }))
    );
    const states = Array.from({ length: 10 }, () =>
      track(callGraphAPI('token', 'GET', 'me/mailFolders/inbox'))
    );

    await jest.advanceTimersByTimeAsync(0);
    expect(https.request).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(1000);

    expect(https.request).toHaveBeenCalledTimes(10);
    expect(maxInFlight).toBe(4);
    expect(states.every((s) => s.settled && !s.error)).toBe(true);
  });

  it('releases slots after a timed-out and a failed request', async () => {
    config.REQUEST_TIMEOUT_MS = 5000;
    script(
      { stall: true },
      { errorCode: 'ECONNRESET' },
      ...Array.from({ length: 4 }, () => ({
        status: 200,
        body: {},
        delayMs: 100,
      }))
    );
    const timedOut = track(
      callGraphAPI('token', 'PATCH', 'me/messages/a', { isRead: true })
    );
    const reset = track(
      callGraphAPI('token', 'PATCH', 'me/messages/b', { isRead: true })
    );
    await jest.advanceTimersByTimeAsync(5000);
    expect(timedOut.error.code).toBe('ETIMEDOUT');
    expect(reset.error.message).toMatch(/ECONNRESET/);
    expect(inFlight).toBe(0);

    https.request.mockClear();
    maxInFlight = 0;
    const next = Array.from({ length: 4 }, () =>
      track(callGraphAPI('token', 'GET', 'me/mailFolders/inbox'))
    );
    await jest.advanceTimersByTimeAsync(0);
    // All four start at once: no slot was leaked by the failed requests.
    expect(https.request).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBe(4);
    await jest.advanceTimersByTimeAsync(100);
    expect(next.every((s) => s.settled && !s.error)).toBe(true);
  });

  it('releases the slot while sleeping before a retry', async () => {
    script(
      { status: 429, headers: { 'retry-after': '5' }, body: THROTTLED },
      { status: 429, headers: { 'retry-after': '5' }, body: THROTTLED },
      { status: 429, headers: { 'retry-after': '5' }, body: THROTTLED },
      { status: 429, headers: { 'retry-after': '5' }, body: THROTTLED },
      { status: 200, body: { fifth: true } }
    );
    const throttled = Array.from({ length: 4 }, () =>
      track(callGraphAPI('token', 'GET', 'me/messages'))
    );
    await jest.advanceTimersByTimeAsync(0);
    // All four are now sleeping on Retry-After; a fifth call must not queue.
    const fifth = track(callGraphAPI('token', 'GET', 'me/mailFolders/inbox'));
    await jest.advanceTimersByTimeAsync(0);
    expect(fifth.value).toEqual({ fifth: true });
    expect(throttled.every((s) => !s.settled)).toBe(true);
    await jest.advanceTimersByTimeAsync(5000);
    expect(throttled.every((s) => s.settled && !s.error)).toBe(true);
  });
});

describe('callGraphAPIRaw retries', () => {
  it('retries a 429 and keeps the Accept: message/rfc822 header', async () => {
    script(
      { status: 429, headers: { 'retry-after': '1' }, body: THROTTLED },
      { status: 200, body: 'MIME-Version: 1.0\r\n\r\nhi' }
    );
    const state = track(callGraphAPIRaw('token', 'msg-1'));
    await jest.advanceTimersByTimeAsync(1000);

    expect(https.request).toHaveBeenCalledTimes(2);
    expect(state.value).toBe('MIME-Version: 1.0\r\n\r\nhi');
    for (const call of https.request.mock.calls) {
      expect(call[1].method).toBe('GET');
      expect(call[1].headers.Accept).toBe('message/rfc822');
    }
  });

  it('keeps the MIME export error text after retries are exhausted', async () => {
    script(
      { status: 429, headers: { 'retry-after': '120' }, body: THROTTLED },
      { status: 200, body: 'x' }
    );
    await expect(callGraphAPIRaw('token', 'msg-1')).rejects.toThrow(
      'MIME export failed with status 429'
    );
    expect(https.request).toHaveBeenCalledTimes(1);
  });
});
