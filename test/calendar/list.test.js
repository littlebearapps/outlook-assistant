const handleListEvents = require('../../calendar/list');
const {
  buildListEventsFilter,
  listEventsOrderBy,
} = require('../../calendar/list');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const mockAccessToken = 'test_token';

/**
 * Pull the queryParams object passed to callGraphAPI.
 * Signature: (accessToken, method, path, body, queryParams, extraHeaders)
 */
function queryParamsOf(call) {
  return call[4];
}

function filterOf(call) {
  return queryParamsOf(call).$filter;
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
  callGraphAPI.mockResolvedValue({ value: [] });
});

afterEach(() => {
  console.error.mockRestore();
});

describe('handleListEvents — filter parameters', () => {
  test('no-arg call preserves default "start >= now" behaviour', async () => {
    const before = new Date();
    await handleListEvents({});
    const after = new Date();

    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    const filter = filterOf(callGraphAPI.mock.calls[0]);

    // Must use a single "start >= <iso>" condition (not combined with anything else).
    const match = filter.match(/^start\/dateTime ge '([^']+)'$/);
    expect(match).not.toBeNull();
    const ts = new Date(match[1]);
    // The timestamp captured by the handler must fall between the two test
    // bookends — i.e. it is "now" at call time, as before.
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test('startAfter overrides the default "now" filter', async () => {
    await handleListEvents({ startAfter: '2026-01-01T00:00:00Z' });

    expect(filterOf(callGraphAPI.mock.calls[0])).toBe(
      "start/dateTime ge '2026-01-01T00:00:00.000Z'"
    );
  });

  test('startBefore produces a strict upper bound on start', async () => {
    await handleListEvents({ startBefore: '2026-02-01T00:00:00Z' });

    expect(filterOf(callGraphAPI.mock.calls[0])).toBe(
      "start/dateTime lt '2026-02-01T00:00:00.000Z'"
    );
  });

  test('offset datetimes are normalised to UTC before filtering', async () => {
    // Events are requested in UTC, so a +10:00 input must become the same
    // instant in UTC rather than being compared as a local wall-clock time.
    await handleListEvents({
      startAfter: '2026-04-03T09:00:00+10:00',
      startBefore: '2026-04-04T00:00:00+10:00',
    });

    expect(filterOf(callGraphAPI.mock.calls[0])).toBe(
      "start/dateTime ge '2026-04-02T23:00:00.000Z' and start/dateTime lt '2026-04-03T14:00:00.000Z'"
    );
  });

  test('subject filter uses Graph contains()', async () => {
    await handleListEvents({ subject: 'Miele' });

    // A subject-only search leads with a match-everything start clause, as
    // Graph requires $orderby properties to lead the $filter.
    expect(filterOf(callGraphAPI.mock.calls[0])).toBe(
      "start/dateTime ge '1900-01-01T00:00:00.000Z' and contains(subject, 'Miele')"
    );
  });

  test('combined startAfter + startBefore + subject are AND-ed together', async () => {
    await handleListEvents({
      startAfter: '2026-01-01T00:00:00Z',
      startBefore: '2026-02-01T00:00:00Z',
      subject: 'Miele',
    });

    expect(filterOf(callGraphAPI.mock.calls[0])).toBe(
      [
        "start/dateTime ge '2026-01-01T00:00:00.000Z'",
        "start/dateTime lt '2026-02-01T00:00:00.000Z'",
        "contains(subject, 'Miele')",
      ].join(' and ')
    );
  });

  test('single quotes in subject are escaped to prevent OData injection', async () => {
    // The classic injection attempt: close the string literal, OR something
    // that always matches, leave a trailing fragment. After escaping, the
    // entire payload must remain inside a single quoted string literal so
    // Graph treats it as a search substring, not as OData syntax.
    await handleListEvents({ subject: "x') or '1'='1" });

    const filter = filterOf(callGraphAPI.mock.calls[0]);

    // Single quotes must be doubled per OData rules.
    expect(filter).toBe(
      "start/dateTime ge '1900-01-01T00:00:00.000Z' and contains(subject, 'x'') or ''1''=''1')"
    );

    // Defence-in-depth: the filter must not contain a raw " or " operator
    // sitting outside a quoted string. We strip out everything between
    // matched single-quote pairs and assert no " or " is left in the
    // skeleton.
    const skeleton = stripQuotedStrings(filter);
    expect(skeleton.toLowerCase()).not.toMatch(/\bor\b/);
    expect(skeleton).not.toContain('=');
  });

  test('subject alone does not include default "now"', async () => {
    // Regression guard: once ANY filter param is present, the implicit "now"
    // lower bound must NOT be silently added — that would surprise callers
    // who specifically asked for past events.
    await handleListEvents({
      subject: 'Standup',
    });

    const filter = filterOf(callGraphAPI.mock.calls[0]);
    expect(filter).toBe(
      "start/dateTime ge '1900-01-01T00:00:00.000Z' and contains(subject, 'Standup')"
    );
  });
});

describe('buildListEventsFilter — pure unit tests', () => {
  test('returns default now filter for empty args', () => {
    const before = new Date();
    const filter = buildListEventsFilter({});
    const after = new Date();

    const match = filter.match(/^start\/dateTime ge '([^']+)'$/);
    expect(match).not.toBeNull();
    const ts = new Date(match[1]);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test('rejects malformed startAfter as not-an-ISO-datetime', () => {
    expect(() => buildListEventsFilter({ startAfter: 'not-a-date' })).toThrow(
      /Invalid startAfter/
    );
  });

  test('rejects malformed startBefore as not-an-ISO-datetime', () => {
    expect(() => buildListEventsFilter({ startBefore: 'tomorrow' })).toThrow(
      /Invalid startBefore/
    );
  });

  test('injection-style strings in startAfter are rejected before reaching OData', () => {
    // The ISO validation is an earlier, stricter line of defence than the
    // OData escape: anything that isn't parseable as a datetime never makes
    // it into the filter string at all.
    expect(() =>
      buildListEventsFilter({ startAfter: "2026-01-01' or '" })
    ).toThrow(/Invalid startAfter/);
  });

  test('accepts valid ISO 8601 datetimes in multiple forms', () => {
    // Both `Z` (UTC) and offset forms parse cleanly.
    expect(() =>
      buildListEventsFilter({ startAfter: '2026-01-01T00:00:00Z' })
    ).not.toThrow();
    expect(() =>
      buildListEventsFilter({ startBefore: '2026-06-05T17:00:00+01:00' })
    ).not.toThrow();
  });
});

/**
 * Remove anything between matched pairs of single quotes so we can
 * inspect the OData "skeleton" outside quoted-string literals.
 */
function stripQuotedStrings(s) {
  // OData escapes single quotes by doubling them inside a literal.
  // A simple regex that consumes opening quote, any chars that are
  // either non-quote or doubled-quote, then closing quote works.
  return s.replace(/'(?:[^']|'')*'/g, "''");
}

describe('list-events argument validation (audit of #193)', () => {
  test('an invalid date returns isError without authenticating or calling Graph', async () => {
    const result = await handleListEvents({ startAfter: 'not-a-date' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Invalid startAfter/);
    expect(ensureAuthenticated).not.toHaveBeenCalled();
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('a zone-less datetime is rejected rather than read in server-local time', () => {
    expect(() =>
      buildListEventsFilter({ startAfter: '2026-01-01T00:00:00' })
    ).toThrow(/with "Z" or a ±hh:mm offset/);
  });

  test.each([
    '1',
    '-1',
    'Jan 1 2026',
    '1/2/2026',
    '2026-01-01',
    '2026-02-30T00:00:00Z',
    '0000-01-01T00:00:00Z',
    '+275760-09-13T00:00:00Z',
  ])('rejects non-ISO or out-of-range date %p', (value) => {
    expect(() => buildListEventsFilter({ startBefore: value })).toThrow(
      /Invalid startBefore/
    );
  });

  test('accepts fractional seconds and minute precision with an offset', () => {
    expect(
      buildListEventsFilter({ startAfter: '2026-04-03T09:00+10:00' })
    ).toBe("start/dateTime ge '2026-04-02T23:00:00.000Z'");
    expect(
      buildListEventsFilter({ startAfter: '2026-04-02T23:00:00.123456Z' })
    ).toBe("start/dateTime ge '2026-04-02T23:00:00.123Z'");
  });

  test('a non-string subject gets a clean error', async () => {
    const result = await handleListEvents({ subject: 123 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Invalid subject: expected a string.');
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('an over-long subject is rejected', () => {
    expect(() => buildListEventsFilter({ subject: 'x'.repeat(256) })).toThrow(
      /at most 255 characters/
    );
    expect(() =>
      buildListEventsFilter({ subject: 'x'.repeat(255) })
    ).not.toThrow();
  });

  test('a subject with a lone surrogate is rejected', () => {
    expect(() => buildListEventsFilter({ subject: 'a\uD800b' })).toThrow(
      /malformed Unicode/
    );
  });

  test('error messages truncate the echoed input', () => {
    let message = '';
    try {
      buildListEventsFilter({ startAfter: 'x'.repeat(100000) });
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/Invalid startAfter/);
    expect(message.length).toBeLessThan(250);
  });

  test('an inverted window is rejected', () => {
    expect(() =>
      buildListEventsFilter({
        startAfter: '2026-02-01T00:00:00Z',
        startBefore: '2026-01-01T00:00:00Z',
      })
    ).toThrow(/startAfter must be earlier than startBefore/);
  });
});

describe('listEventsOrderBy', () => {
  test.each([
    [{}, 'start/dateTime'],
    [{ startAfter: '2026-01-01T00:00:00Z' }, 'start/dateTime'],
    [
      {
        startAfter: '2026-01-01T00:00:00Z',
        startBefore: '2026-02-01T00:00:00Z',
      },
      'start/dateTime',
    ],
    [{ startBefore: '2026-02-01T00:00:00Z' }, 'start/dateTime desc'],
    [{ subject: 'Standup' }, 'start/dateTime desc'],
    [
      { startAfter: '2026-01-01T00:00:00Z', subject: 'Standup' },
      'start/dateTime',
    ],
  ])('%p sorts by %p', (args, expected) => {
    expect(listEventsOrderBy(args)).toBe(expected);
  });

  test('startBefore-only calls Graph newest first', async () => {
    await handleListEvents({ startBefore: '2026-02-01T00:00:00Z' });

    expect(queryParamsOf(callGraphAPI.mock.calls[0]).$orderby).toBe(
      'start/dateTime desc'
    );
  });
});
