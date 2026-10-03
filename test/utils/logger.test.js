/**
 * Stderr logger and redaction (#278).
 *
 * Default level logs no personal data; OUTLOOK_DEBUG adds detail with
 * addresses and opaque IDs masked; tokens, codes and secrets never appear.
 */
const {
  log,
  redact,
  isDebugEnabled,
  graphPathShape,
  withCallContext,
} = require('../../utils/logger');

const GRAPH_ID =
  'AAMkADQ5ZTY0YjU1LTk2ZWYtNDQ2Mi1iZTlhLTc0ZmM2ZDM4MzRkMgBGAAAAAACj3l1aVDpZQ5l9nrZ8w2hWBwBp2ZlAAA=';
const JWT =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJ1cG4iOiJqYW5lQGV4YW1wbGUuY29tIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

describe('redact', () => {
  test('masks email addresses, including percent-encoded ones', () => {
    expect(redact('from jane.doe+news@example.co.uk today')).toBe(
      'from <redacted-email> today'
    );
    expect(redact('users/jane%40example.com/messages')).toBe(
      'users/<redacted-email>/messages'
    );
  });

  test('masks addresses with non-ASCII local parts and domains', () => {
    expect(redact('from josé@example.com today')).toBe(
      'from <redacted-email> today'
    );
    // e + combining acute accent
    expect(redact('jose\u0301@example.com')).toBe('<redacted-email>');
    expect(redact('to jane@exämple.de')).toBe('to <redacted-email>');
    expect(redact('用户@例子.广告')).toBe('<redacted-email>');
    expect(redact('users/josé%40example.com/messages')).toBe(
      'users/<redacted-email>/messages'
    );
  });

  test.each([
    ['a long run with no @', 'a'.repeat(200000)],
    ['a long non-ASCII run with no @', 'é'.repeat(200000)],
    ['a long run of dotted words', 'ab.'.repeat(70000)],
    ['many %40 with no domain dot', 'a%40'.repeat(50000)],
    ['an @ before a long dotless domain', `a@${'b'.repeat(200000)}`],
  ])('stays fast on %s', (_label, input) => {
    const started = Date.now();
    redact(input);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('keeps the quotes around a quoted address', () => {
    expect(redact("address eq 'jane@example.com'")).toBe(
      "address eq '<redacted-email>'"
    );
  });

  test('masks Message-IDs (they contain an @)', () => {
    const out = redact('Message-ID: <CAF=abc123XYZ@mail.gmail.com>');
    expect(out).not.toMatch(/mail\.gmail\.com|abc123XYZ/);
    expect(out).toContain('<redacted-email>');
  });

  test('masks long opaque IDs but keeps ordinary words and paths', () => {
    expect(redact(`me/messages/${GRAPH_ID}/attachments`)).toBe(
      'me/messages/<id>/attachments'
    );
    expect(redact('trace 3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(
      'trace <id>'
    );
    expect(redact('Combined search failed: status 400')).toBe(
      'Combined search failed: status 400'
    );
    expect(redact('content-filter-guard-something-really-long')).toBe(
      'content-filter-guard-something-really-long'
    );
  });

  test('masks JWTs and bearer tokens', () => {
    expect(redact(`token ${JWT} end`)).toBe('token <redacted-token> end');
    expect(redact('Authorization: Bearer abc.def-123')).toBe(
      'Authorization: Bearer <redacted-token>'
    );
  });

  test('masks secret-bearing keys in JSON, inspect output and query strings', () => {
    const json = JSON.stringify({
      access_token: 'at-value',
      refresh_token: 'M.C5_rt-value',
      client_secret: 'shh~value',
      device_code: 'dc-value',
      user_code: 'ABCD-EFGH',
      error: 'invalid_grant',
    });
    const out = redact(json);
    for (const secret of [
      'at-value',
      'M.C5_rt-value',
      'shh~value',
      'dc-value',
      'ABCD-EFGH',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('invalid_grant');

    expect(redact("{ userCode: 'WXYZ1234', expiresIn: 900 }")).not.toContain(
      'WXYZ1234'
    );
    expect(
      redact('grant_type=authorization_code&code=0.AXoA-secret&state=s1')
    ).not.toContain('0.AXoA-secret');
    expect(
      redact('client_id=x&client_secret=hunter2&refresh_token=rt2')
    ).not.toMatch(/hunter2|rt2/);
  });

  test('keeps Graph error codes readable', () => {
    expect(
      redact('{"error":{"code":"ErrorItemNotFound","message":"Not found"}}')
    ).toContain('ErrorItemNotFound');
  });

  test('handles non-strings', () => {
    expect(redact(undefined)).toBe('');
    expect(redact(42)).toBe('42');
  });
});

describe('isDebugEnabled', () => {
  test.each(['true', '1', 'yes', 'on', 'TRUE', ' On '])('%p is on', (v) => {
    expect(isDebugEnabled(v)).toBe(true);
  });
  test.each([null, '', 'false', '0', 'no', 'off', 'verbose'])(
    '%p is off',
    (v) => {
      expect(isDebugEnabled(v)).toBe(false);
    }
  );

  test('reads OUTLOOK_DEBUG when called without an argument', () => {
    const saved = process.env.OUTLOOK_DEBUG;
    try {
      delete process.env.OUTLOOK_DEBUG;
      expect(isDebugEnabled()).toBe(false);
      process.env.OUTLOOK_DEBUG = 'yes';
      expect(isDebugEnabled()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.OUTLOOK_DEBUG;
      else process.env.OUTLOOK_DEBUG = saved;
    }
  });
});

describe('graphPathShape', () => {
  test('keeps Graph resource names and masks IDs, mailboxes and queries', () => {
    expect(graphPathShape(`me/messages/${GRAPH_ID}/attachments`)).toBe(
      'me/messages/{id}/attachments'
    );
    expect(
      graphPathShape(
        'https://graph.microsoft.com/v1.0/users/jane%40example.com/mailFolders/inbox/messages?$search="secret plans"'
      )
    ).toBe('users/<mailbox>/mailFolders/inbox/messages');
  });

  test('never keeps an unknown segment (folder names, free text)', () => {
    expect(graphPathShape('me/mailFolders/Project Phoenix/messages')).toBe(
      'me/mailFolders/{id}/messages'
    );
  });
});

describe('log', () => {
  let errorSpy;
  const saved = process.env.OUTLOOK_DEBUG;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    if (saved === undefined) delete process.env.OUTLOOK_DEBUG;
    else process.env.OUTLOOK_DEBUG = saved;
  });

  const lines = () => errorSpy.mock.calls.map((c) => c.join(' '));

  test('info always writes one redacted line to stderr', () => {
    delete process.env.OUTLOOK_DEBUG;
    log.info('mailbox', 'jane@example.com');
    expect(lines()).toEqual(['mailbox <redacted-email>']);
  });

  test('debug is silent by default', () => {
    delete process.env.OUTLOOK_DEBUG;
    log.debug('Searching for "quarterly report"');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('debug writes redacted detail when OUTLOOK_DEBUG is on', () => {
    process.env.OUTLOOK_DEBUG = 'yes';
    log.debug('search from', 'jane@example.com', {
      access_token: 'at-secret',
    });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(/^\[debug\] search from <redacted-email>/);
    expect(lines()[0]).not.toContain('at-secret');
  });

  test('debug formats errors with redacted message and stack', () => {
    process.env.OUTLOOK_DEBUG = 'true';
    log.debug('failed:', new Error('no mailbox for jane@example.com'));
    expect(lines()[0]).toContain('no mailbox for <redacted-email>');
    expect(lines()[0]).not.toContain('jane@example.com');
  });

  test('note outside a call writes its own info line', () => {
    log.note('auth', 'refresh-failed');
    expect(lines()).toEqual(['auth=refresh-failed']);
  });

  test('note inside a call is collected for the call line instead', async () => {
    const notes = await withCallContext(async (ctx) => {
      log.note('graph', '403 GET me/messages');
      await Promise.resolve();
      log.note('auth', 'refresh-failed');
      return ctx.notes;
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(Object.fromEntries(notes)).toEqual({
      graph: '403 GET me/messages',
      auth: 'refresh-failed',
    });
  });

  test('increment counts inside a call', () => {
    const notes = withCallContext((ctx) => {
      log.increment('graphRetries');
      log.increment('graphRetries');
      return ctx.notes;
    });
    expect(notes.get('graphRetries')).toBe(2);
  });
});
