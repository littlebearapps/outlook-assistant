const handleListEvents = require('../../calendar/list');
const { buildListEventsFilter } = require('../../calendar/list');
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
      "start/dateTime ge '2026-01-01T00:00:00Z'"
    );
  });

  test('startBefore produces a strict upper bound on start', async () => {
    await handleListEvents({ startBefore: '2026-02-01T00:00:00Z' });

    expect(filterOf(callGraphAPI.mock.calls[0])).toBe(
      "start/dateTime lt '2026-02-01T00:00:00Z'"
    );
  });

  test('subject filter uses Graph contains()', async () => {
    await handleListEvents({ subject: 'Miele' });

    expect(filterOf(callGraphAPI.mock.calls[0])).toBe(
      "contains(subject, 'Miele')"
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
        "start/dateTime ge '2026-01-01T00:00:00Z'",
        "start/dateTime lt '2026-02-01T00:00:00Z'",
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
    expect(filter).toBe("contains(subject, 'x'') or ''1''=''1')");

    // Defence-in-depth: the filter must not contain a raw " or " operator
    // sitting outside a quoted string. We strip out everything between
    // matched single-quote pairs and assert no " or " is left in the
    // skeleton.
    const skeleton = stripQuotedStrings(filter);
    expect(skeleton.toLowerCase()).not.toMatch(/\bor\b/);
    expect(skeleton).not.toContain('=');
  });

  test('startAfter alone with subject does not include default "now"', async () => {
    // Regression guard: once ANY filter param is present, the implicit "now"
    // lower bound must NOT be silently added — that would surprise callers
    // who specifically asked for past events.
    await handleListEvents({
      subject: 'Standup',
    });

    const filter = filterOf(callGraphAPI.mock.calls[0]);
    expect(filter).toBe("contains(subject, 'Standup')");
    expect(filter).not.toMatch(/start\/dateTime ge/);
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

  test('escapes single quotes in startAfter', () => {
    // Defensive: even though ISO timestamps don't contain quotes,
    // we don't trust the caller's input.
    expect(buildListEventsFilter({ startAfter: "2026-01-01' or '" })).toBe(
      "start/dateTime ge '2026-01-01'' or '''"
    );
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
