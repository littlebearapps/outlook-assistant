/**
 * The search ladder against a fake Graph that enforces the rules measured on a
 * personal mailbox (test/helpers/fake-graph.js): a request that breaks one is
 * rejected, as it would be live. Covers the error paths: what each kind of
 * failure does at each step, and that a failure is never reported as "nothing
 * matches" or as a filtered result.
 */
const { handleSearchEmails } = require('../../email/search');
const { callGraphAPIPaginated } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { resolveFolderPath } = require('../../email/folder-utils');
const { makeGraph, msg, day } = require('../helpers/fake-graph');
const { enableSharedMailbox } = require('../helpers/shared-mailbox');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
jest.mock('../../email/folder-utils');

enableSharedMailbox();

// 3,000 messages, one a day from 2015-01-01. "Invoice" in every third subject
// and in every seventh body; `to` empresio only on days 100–160 (old mail);
// from Bob every fifth; unread every eleventh; an attachment every thirteenth.
const BOX = Array.from({ length: 3000 }, (_, i) =>
  msg({
    id: `d${i}`,
    date: day(i),
    subject: i % 3 === 0 ? `Invoice ${i}` : `Note ${i}`,
    body: i % 7 === 0 ? 'please see invoice attached' : 'nothing here',
    from: i % 5 === 0 ? 'bob@corp.com' : 'alice@example.com',
    fromName: i % 5 === 0 ? 'Bob' : 'Alice',
    to: i >= 100 && i <= 160 ? 'x@empresio.com' : 'me@live.com',
    isRead: i % 11 !== 0,
    att: i % 13 === 0,
  })
);

const DEFINITIVE = 'no message in this mailbox matches';
const graphError = (status, code, message = 'x') =>
  Object.assign(
    new Error(
      `API call failed with status ${status}: {"error":{"code":"${code}","message":"${message}"}}`
    ),
    { status, graphCode: code }
  );

let graph;
async function run(args, opts = {}, box = BOX) {
  graph = makeGraph(box, opts);
  callGraphAPIPaginated.mockImplementation(graph);
  const result = await handleSearchEmails({ searchAllFolders: true, ...args });
  const text = result.content[0].text;
  return {
    result,
    text,
    meta: result._meta?.searchMetadata || {},
    ids: [...text.matchAll(/ID: `?(d\d+|[a-z]+-\d+)/g)].map((m) => m[1]),
    calls: graph.calls,
  };
}
/** Fail request number `n` (0-based) with `error`. */
const failAt = (n, error) => ({ fail: (i) => (i === n ? error : null) });
/** Fail every request matching `test(params, endpoint)`. */
const failWhen = (test, error) => ({
  fail: (_i, params, endpoint) => (test(params, endpoint) ? error : null),
});
const isScan = (p) => p.$orderby && !/contains\(|from\//.test(p.$filter || '');
const isNextPage = (_p, endpoint) => String(endpoint).startsWith('http');

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue('token');
  resolveFolderPath.mockResolvedValue('me/mailFolders/inbox/messages');
});
afterEach(() => {
  console.error.mockRestore();
});

describe('success paths obey Graph’s rules (controls)', () => {
  test.each([
    [{ subject: 'invoice', count: 50 }],
    [{ subject: 'invoice', receivedBefore: day(500), count: 10 }],
    [{ from: 'bob', count: 25 }],
    [{ from: 'bob@corp.com', subject: 'invoice', unreadOnly: true }],
    [{ unreadOnly: true }],
    [{ hasAttachments: true, receivedAfter: day(2900) }],
    [{ query: 'invoice', count: 50 }],
    [{ query: 'invoice', receivedBefore: day(1000), count: 50 }],
    [{ query: 'invoice', from: 'bob', count: 50 }],
    [{ to: 'me@live.com', count: 10 }],
    [{ searchExpression: 'invoice attached' }],
    [{ searchExpression: 'from:bob@corp.com', receivedAfter: day(2900) }],
  ])('%j: only the known refusals are rejected, newest first', async (args) => {
    const { result, calls, text } = await run(args);

    expect(result.isError).toBeUndefined();
    expect(result._meta.returned).toBeGreaterThan(0);
    // No request put $search beside another parameter or sorted a filter
    // that receivedDateTime doesn't lead: the fake would have refused it and
    // the ladder would have marked nothing, so check the requests directly.
    for (const call of calls) {
      if (call.$search) {
        expect(call.$filter).toBeUndefined();
        expect(call.$orderby).toBeUndefined();
      }
      if (call.$orderby && call.$filter) {
        expect(call.$filter).toMatch(/^receivedDateTime /);
      }
    }
    const days = [...text.matchAll(/ID: `?d(\d+)/g)].map((m) => Number(m[1]));
    expect(days).toEqual([...days].sort((a, b) => b - a));
    expect(result._meta.searchMetadata.incomplete).toBeUndefined();
  });
});

describe('local narrowing over old mail (N1), with paging and the sort rule enforced', () => {
  const oldMatches = (ids) =>
    ids.every((id) => {
      const n = Number(id.slice(1));
      return n >= 100 && n <= 160;
    });

  test.each([
    // The oldest 50 invoices reach day 147; the recipient is on days 100–160.
    [{ subject: 'invoice', to: 'empresio', count: 50 }],
    [
      {
        subject: 'invoice',
        to: 'empresio',
        receivedBefore: day(400),
        count: 50,
      },
    ],
    [{ query: 'invoice', to: 'empresio', receivedBefore: day(400), count: 25 }],
  ])('%j finds the old mail', async (args) => {
    const { ids, result } = await run(args);

    expect(result._meta.returned).toBeGreaterThan(0);
    expect(oldMatches(ids)).toBe(true);
  });

  test('a match in the middle, beyond both pages and the scan, is not claimed absent', async () => {
    // Recipient matches only on days 1400–1420: not among the 500 newest
    // messages, nor the newest or oldest 25 invoices.
    const box = BOX.map((m, i) => ({
      ...m,
      toRecipients: [
        {
          emailAddress: {
            name: 'X',
            address: i >= 1400 && i <= 1420 ? 'x@midcorp.com' : 'me@live.com',
          },
        },
      ],
    }));

    const { result, text, meta } = await run(
      { subject: 'invoice', to: 'midcorp', count: 25 },
      {},
      box
    );

    expect(result._meta.returned).toBe(0);
    expect(text).not.toContain(DEFINITIVE);
    expect(text).toContain('the newest and the oldest');
    expect(text).toContain('`receivedAfter` and `receivedBefore`');
    expect(text).toContain('applied locally to 50 messages');
    expect(meta.filterApplied).toBe(false);
  });

  test('following that advice finds it', async () => {
    const box = BOX.map((m, i) => ({
      ...m,
      toRecipients: [
        {
          emailAddress: {
            name: 'X',
            address: i >= 1400 && i <= 1420 ? 'x@midcorp.com' : 'me@live.com',
          },
        },
      ],
    }));

    const { result } = await run(
      {
        subject: 'invoice',
        to: 'midcorp',
        receivedAfter: day(1390),
        receivedBefore: day(1430),
        count: 25,
      },
      {},
      box
    );

    expect(result._meta.returned).toBe(7);
  });
});

// What each kind of failure means, stated here by status and Graph error
// code, independently of how the implementation recognises them.
const REFUSALS = [
  ['400 InefficientFilter', graphError(400, 'InefficientFilter')],
  [
    '400 ErrorInvalidUrlQueryFilter',
    graphError(400, 'ErrorInvalidUrlQueryFilter'),
  ],
  ['400 SearchWithFilter', graphError(400, 'SearchWithFilter')],
  ['400 SearchWithOrderBy', graphError(400, 'SearchWithOrderBy')],
  [
    '400 BadRequest syntax error',
    graphError(400, 'BadRequest', "Syntax error: character ':' is not valid"),
  ],
];
const FAILURES = [
  ['400 with an unknown code', graphError(400, 'ErrorSomethingNew')],
  ['404 ErrorItemNotFound', graphError(404, 'ErrorItemNotFound')],
  ['429 throttled', graphError(429, 'ApplicationThrottled')],
  ['500', graphError(500, 'InternalServerError')],
  ['502', graphError(502, 'UnknownError')],
  ['503', graphError(503, 'ServiceUnavailable')],
  [
    'a timeout',
    Object.assign(new Error('Request timed out after 60000 ms'), {
      code: 'ETIMEDOUT',
    }),
  ],
  [
    'a network error',
    Object.assign(new Error('Network error during API call: read ECONNRESET'), {
      code: 'ECONNRESET',
    }),
  ],
  [
    'an unreadable response',
    new Error('Error parsing API response: Unexpected end of JSON input'),
  ],
  ['an error nobody has seen before', new Error('something entirely new')],
];

describe('a refusal is an answer; anything else leaves the search incomplete', () => {
  test.each(REFUSALS)(
    '%s on every filter request: the definitive wording stands',
    async (_n, error) => {
      const { text, meta, result } = await run(
        { subject: 'zzzqqq' },
        failWhen((p) => Boolean(p.$filter), error)
      );

      expect(result.isError).toBeUndefined();
      expect(result._meta.returned).toBe(0);
      expect(meta.incomplete).toBeUndefined();
      expect(text).toContain(DEFINITIVE);
    }
  );

  test.each(FAILURES)(
    '%s on every request: not "nothing matches"',
    async (_n, error) => {
      const { text, meta, result } = await run(
        { subject: 'zzzqqq' },
        {
          fail: () => error,
        }
      );

      expect(result.isError).toBeUndefined();
      expect(result._meta.returned).toBe(0);
      expect(meta.incomplete).toBe(true);
      expect(text).not.toContain(DEFINITIVE);
      expect(text).toContain('so a match may still exist');
      expect(text).toContain('A request to Microsoft Graph failed');
    }
  );

  // The same failure at each place a request is made.
  test.each([
    [
      'the combined step',
      { subject: 'zzzqqq' },
      failAt(0, graphError(502, 'UnknownError')),
    ],
    [
      'a single-term step',
      { subject: 'zzzqqq', to: 'empresio' },
      failWhen(
        (p) =>
          /^receivedDateTime .*contains\(subject/.test(p.$filter || '') &&
          !/toRecipients/.test(p.$filter),
        graphError(502, 'UnknownError')
      ),
    ],
    [
      'the oldest page',
      { subject: 'invoice', to: 'nobody-at-all', count: 25 },
      failWhen(
        (p) => /^contains\(subject/.test(p.$filter || ''),
        graphError(502, 'UnknownError')
      ),
    ],
    [
      'the local scan',
      { to: 'nobody-at-all' },
      failWhen(isScan, graphError(502, 'UnknownError')),
    ],
    [
      'a $search follow-up page',
      { query: 'invoice', receivedBefore: day(100), count: 50 },
      failWhen(isNextPage, graphError(502, 'UnknownError')),
    ],
  ])('502 at %s', async (_where, args, opts) => {
    const { text, meta } = await run(args, opts);

    expect(meta.incomplete).toBe(true);
    expect(text).not.toContain(DEFINITIVE);
    expect(text).toContain('A request to Microsoft Graph failed');
  });

  test('a failed $search follow-up page is not described as a window beyond paging', async () => {
    const { text, meta } = await run(
      { query: 'invoice', receivedBefore: day(100), count: 50 },
      failWhen(isNextPage, graphError(502, 'UnknownError'))
    );

    expect(meta.incomplete).toBe(true);
    expect(meta.searchWindowUnreached).toBeUndefined();
    expect(text).not.toContain('beyond what `$search` paging can reach');
  });

  test('the failure line names the status and code, not the response body', async () => {
    const { text } = await run(
      { subject: 'zzzqqq' },
      {
        fail: () => graphError(503, 'ServiceUnavailable', 'secret detail'),
      }
    );

    expect(text).toContain('503 ServiceUnavailable');
    expect(text).not.toContain('secret detail');
  });
});

describe('401 and 403 are tool errors, not empty results', () => {
  const everyRequest = (error) => ({ fail: () => error });

  test.each([
    [{ subject: 'invoice' }],
    [{ query: 'invoice' }],
    [{ to: 'empresio' }],
    [{ unreadOnly: true }],
    [{ searchExpression: 'invoice OR note' }],
    [{ searchExpression: 'from:bob@corp.com' }],
    [{}],
  ])('403 on %j', async (args) => {
    const { result, text } = await run(
      args,
      everyRequest(graphError(403, 'ErrorAccessDenied', 'Access is denied.'))
    );

    expect(result.isError).toBe(true);
    expect(text).toContain(
      'Microsoft Graph refused this search (403 ErrorAccessDenied)'
    );
    expect(text).toContain('Next step:');
    expect(text).toContain('`auth` with action=about');
    expect(text).not.toContain('No emails found');
  });

  test('403 on a shared mailbox names it and keeps the shared-mailbox causes', async () => {
    const { result, text } = await run(
      { subject: 'invoice', sharedMailbox: 'team@contoso.com' },
      everyRequest(graphError(403, 'ErrorAccessDenied'))
    );

    expect(result.isError).toBe(true);
    expect(text).toContain(
      'Access denied to shared mailbox "team@contoso.com"'
    );
    expect(text).toContain("You don't have access to this shared mailbox");
    expect(text).toContain('The Mail.Read.Shared permission is not granted');
    expect(text).toContain('Next step:');
  });

  test.each([
    ['the client’s UNAUTHORIZED', new Error('UNAUTHORIZED')],
    ['a 401 status', graphError(401, 'InvalidAuthenticationToken')],
  ])('%s asks the caller to sign in', async (_n, error) => {
    const { result, text } = await run(
      { subject: 'invoice' },
      everyRequest(error)
    );

    expect(result.isError).toBe(true);
    expect(text).toContain('Authentication required.');
    expect(text).toContain('action=authenticate');
  });

  test('a 403 part-way through a ladder still surfaces', async () => {
    const { result, text } = await run(
      { subject: 'invoice', to: 'empresio', count: 25 },
      failWhen(
        (p) => /^contains\(subject/.test(p.$filter || ''),
        graphError(403, 'ErrorAccessDenied')
      )
    );

    expect(result.isError).toBe(true);
    expect(text).toContain('403 ErrorAccessDenied');
  });
});

describe('searchExpression failures', () => {
  test.each(FAILURES)(
    '%s: incomplete, with the softened wording',
    async (_n, error) => {
      const { text, meta, result } = await run(
        { searchExpression: 'invoice OR note' },
        { fail: () => error }
      );

      expect(result.isError).toBeUndefined();
      expect(result._meta.returned).toBe(0);
      expect(meta.incomplete).toBe(true);
      expect(text).not.toContain(DEFINITIVE);
      expect(text).toContain('A request to Microsoft Graph failed');
    }
  );

  test('a rejected expression says it was rejected, and why', async () => {
    const { text, meta } = await run(
      { searchExpression: 'invoice AND (note' },
      {
        fail: (_i, p) =>
          p.$search
            ? graphError(
                400,
                'BadRequest',
                "Syntax error: character '(' is not valid at position 12"
              )
            : null,
      }
    );

    expect(meta.finalStrategy).toBe('raw-kql-error');
    expect(text).toContain('Microsoft Graph rejected the `searchExpression`');
    expect(text).toContain(
      "Syntax error: character '(' is not valid at position 12"
    );
    expect(text).not.toContain(DEFINITIVE);
  });

  // #340: nothing was searched, so `_meta` must not read as an ordinary
  // empty result.
  test('a rejected expression is marked incomplete in _meta, with the same text', async () => {
    const { text, meta, result, calls } = await run(
      { searchExpression: 'invoice AND (note' },
      {
        fail: (_i, p) =>
          p.$search
            ? graphError(
                400,
                'BadRequest',
                "Syntax error: character '(' is not valid at position 12"
              )
            : null,
      }
    );

    expect(result.isError).toBeUndefined();
    expect(result._meta.returned).toBe(0);
    expect(meta.incomplete).toBe(true);
    expect(meta.partialCoverage).toBe(true);
    expect(meta.filterApplied).toBe(false);
    expect(calls).toHaveLength(1);
    expect(text).toBe(
      'No emails found matching your filters in "all folders" (filters: searchExpression).\n\n' +
        '**Suggestions:**\n' +
        "- Microsoft Graph rejected the `searchExpression`, so nothing was searched: Syntax error: character '(' is not valid at position 12. Check the KQL (operators are upper-case, phrases need their own quotes) and try again\n" +
        '- `searchExpression` is a Graph `$search`: it matches whole words or their beginnings. The structured filters (`from`, `to`, `subject`) match substrings'
    );
  });

  test('a rejection with no reason from Graph is marked incomplete as well', async () => {
    const { text, meta } = await run(
      { searchExpression: 'invoice OR note' },
      { fail: () => graphError(400, 'SearchWithFilter', '') }
    );

    expect(meta.incomplete).toBe(true);
    expect(text).toContain(
      'Microsoft Graph rejected the `searchExpression`, so nothing was searched.'
    );
    expect(text).not.toContain('A request to Microsoft Graph failed');
  });

  test('a pure field-scoped expression: the rejected as-written request is not a failure', async () => {
    const { result, meta } = await run({
      searchExpression: 'from:bob@corp.com',
      count: 5,
    });

    expect(result._meta.returned).toBe(5);
    expect(meta.finalStrategy).toBe('raw-kql-translated');
    expect(meta.incomplete).toBeUndefined();
  });
});

describe('a boolean-only search never returns unfiltered mail', () => {
  test.each([
    ['a failure', graphError(502, 'UnknownError')],
    ['a refusal of both shapes', graphError(400, 'InefficientFilter')],
    ['an unknown error', new Error('something entirely new')],
  ])(
    '%s on the filter request is an error, not a listing',
    async (_n, error) => {
      const { result, text } = await run(
        { unreadOnly: true, count: 10 },
        failWhen((p) => Boolean(p.$filter), error)
      );

      expect(result.isError).toBe(true);
      expect(text).toContain('`unreadOnly`');
      expect(text).toContain('Next step:');
      expect(text).not.toContain('No search filters were applied');
      expect(result._meta).toBeUndefined();
    }
  );

  test('the same for a date window with hasAttachments', async () => {
    const { result, text } = await run(
      { hasAttachments: true, receivedAfter: day(2900) },
      failWhen((p) => Boolean(p.$filter), graphError(503, 'ServiceUnavailable'))
    );

    expect(result.isError).toBe(true);
    expect(text).toContain('`hasAttachments`');
    expect(text).toContain('`receivedAfter`');
  });

  test('the sorted request fails once and the unsorted retry answers: filtered, and marked', async () => {
    const { result, meta, ids } = await run(
      { unreadOnly: true, count: 10 },
      failWhen(
        (p) => Boolean(p.$filter && p.$orderby),
        graphError(400, 'InefficientFilter')
      )
    );

    expect(result.isError).toBeUndefined();
    expect(ids).toHaveLength(10);
    expect(ids.every((id) => Number(id.slice(1)) % 11 === 0)).toBe(true);
    expect(meta.filterApplied).toBe(true);
  });

  test('a plain listing with no filters is still a listing (control)', async () => {
    const { result, meta } = await run({ count: 5 });

    expect(result._meta.returned).toBe(5);
    expect(result.isError).toBeUndefined();
    expect(meta.filterApplied).not.toBe(false);
  });
});

describe('when Graph refuses the sort', () => {
  test('the unsorted page answers once and is not called "the newest and the oldest"', async () => {
    const { text, calls, result } = await run(
      { subject: 'invoice', to: 'nobody-at-all', count: 25 },
      { noSort: true }
    );

    const subjectRequests = calls.filter(
      (c) =>
        /contains\(subject/.test(c.$filter || '') &&
        !/toRecipients/.test(c.$filter)
    );
    // One sorted attempt (refused) and one unsorted read; no second read.
    expect(subjectRequests.filter((c) => !c.$orderby)).toHaveLength(1);
    expect(result._meta.returned).toBe(0);
    expect(text).not.toContain('the newest and the oldest');
    expect(text).not.toContain(DEFINITIVE);
    expect(text).toContain('oldest first');
  });

  test('matches from the unsorted page are returned, in date order', async () => {
    const { ids, text } = await run(
      { subject: 'invoice', to: 'me@live.com', count: 10 },
      { noSort: true }
    );

    expect(ids).toHaveLength(10);
    expect(text).not.toContain('the newest and the oldest');
  });
});

// #342: a page that came from an unsorted request is in date order, and the
// advice with it does not assume it holds the newest matches.
describe('a page from an unsorted request (#342)', () => {
  const OLD_FOOTER = 'set `receivedBefore` to the oldest date shown';
  const NEW_FOOTER =
    '_More emails available. Graph refused to sort this search, so the ones shown are in date order but may not be the newest matches (an unsorted request usually returns the oldest). To see the rest, raise `count` (up to 50) or set `receivedAfter`/`receivedBefore` around the dates you want._';
  const newestFirst = (ids) =>
    [...ids].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  const sortRefused = failWhen(
    (p) => Boolean(p.$filter && p.$orderby),
    graphError(400, 'InefficientFilter')
  );

  test('single-term step: the footer does not say to page back from the oldest date shown', async () => {
    const { ids, text, meta, calls, result } = await run(
      { subject: 'invoice', count: 10 },
      { noSort: true }
    );

    // The ten oldest invoices (every third day from day 0), newest first.
    expect(ids).toEqual([
      'd27',
      'd24',
      'd21',
      'd18',
      'd15',
      'd12',
      'd9',
      'd6',
      'd3',
      'd0',
    ]);
    expect(result._meta.hasMore).toBe(true);
    expect(meta.sortRefused).toBe(true);
    expect(text).toContain(NEW_FOOTER);
    expect(text).not.toContain(OLD_FOOTER);
    // Two refused sorted requests and the one unsorted read, as before.
    expect(calls.map((c) => Boolean(c.$orderby))).toEqual([true, true, false]);
  });

  test('single-term step at count 50: no advice to raise count', async () => {
    const { text } = await run(
      { subject: 'invoice', count: 50 },
      { noSort: true }
    );

    expect(text).toContain('Graph refused to sort this search');
    expect(text).not.toContain('raise `count`');
    expect(text).not.toContain(OLD_FOOTER);
  });

  test('single-term step, narrowed locally: the same footer', async () => {
    const { text, meta } = await run(
      { subject: 'invoice', to: 'me@live.com', count: 10 },
      { noSort: true }
    );

    expect(meta.sortRefused).toBe(true);
    expect(text).toContain(NEW_FOOTER);
    expect(text).not.toContain(OLD_FOOTER);
  });

  test('every match fits on the page: in order, with no footer', async () => {
    const { ids, text, meta, result } = await run(
      { subject: 'Invoice 30', count: 10 },
      { noSort: true }
    );

    expect(ids).toEqual(['d309', 'd306', 'd303', 'd300', 'd30']);
    expect(result._meta.hasMore).toBe(false);
    expect(meta.sortRefused).toBe(true);
    expect(text).not.toContain('More emails');
  });

  test('boolean step: the unsorted retry is put in date order, and says so', async () => {
    const { ids, text, meta, calls, result } = await run(
      { hasAttachments: true, count: 10 },
      sortRefused
    );

    // Graph's unsorted page is its ten oldest (every thirteenth day).
    expect(ids).toHaveLength(10);
    expect(ids).toEqual(newestFirst(ids));
    expect(ids[9]).toBe('d0');
    expect(result.isError).toBeUndefined();
    expect(meta.finalStrategy).toBe('boolean-filters-only');
    expect(meta.filterApplied).toBe(true);
    expect(meta.sortRefused).toBe(true);
    expect(text).toContain(NEW_FOOTER);
    expect(text).not.toContain(OLD_FOOTER);
    // The sorted request and its one retry: nothing added.
    expect(calls.map((c) => Boolean(c.$orderby))).toEqual([true, false]);
  });

  test('boolean step with a date window: still in date order', async () => {
    const { ids, meta } = await run(
      { unreadOnly: true, receivedAfter: day(1000), count: 25 },
      sortRefused
    );

    expect(ids).toHaveLength(25);
    expect(ids).toEqual(newestFirst(ids));
    expect(meta.sortRefused).toBe(true);
  });

  test('boolean step that finds nothing after the retry: "oldest first", not "newest first"', async () => {
    const { text, result } = await run(
      { subject: 'no such subject', unreadOnly: true, count: 10 },
      { noSort: true }
    );

    expect(result._meta.returned).toBe(0);
    expect(text).toContain('oldest first (Graph refused to sort them)');
    expect(text).not.toContain('newest first, so an older match');
    expect(text).not.toContain(DEFINITIVE);
  });

  test.each([
    [{ subject: 'invoice', count: 10 }],
    [{ hasAttachments: true, count: 10 }],
    [{ unreadOnly: true, receivedAfter: day(1000), count: 25 }],
    [{ from: 'bob@corp.com', count: 10 }],
  ])(
    '%j sorted by Graph: the footer and _meta are unchanged (control)',
    async (args) => {
      const { ids, text, meta, calls } = await run(args);

      expect(ids).toEqual(newestFirst(ids));
      expect(meta.sortRefused).toBeUndefined();
      expect(text).toContain(
        '_More emails available. To see them, raise `count` (up to 50) or narrow the date range with `receivedAfter`/`receivedBefore` (for older mail, set `receivedBefore` to the oldest date shown)._'
      );
      expect(calls).toHaveLength(1);
    }
  );
});

describe('the oldest page is read only when it can add something', () => {
  test('not when the newest page already fills count', async () => {
    // `from` answers before the recipient scan; Bob's newest ten all pass.
    const { calls, result, meta } = await run({
      from: 'bob@corp.com',
      to: 'me@live.com',
      count: 10,
    });

    expect(result._meta.returned).toBe(10);
    expect(meta.finalStrategy).toBe('single-term-from');
    const fromOnly = calls.filter(
      (c) => /from\//.test(c.$filter || '') && !/toRecipients/.test(c.$filter)
    );
    expect(fromOnly).toHaveLength(1);
    expect(fromOnly[0].$orderby).toBe('receivedDateTime desc');
  });

  test('read when the newest page leaves room', async () => {
    // Bob's newest ten are all to me; the search wants a recipient who only
    // appears in old mail, so the oldest page is what finds it.
    const { calls, ids } = await run({
      from: 'bob@corp.com',
      to: 'empresio',
      count: 50,
    });

    const fromOnly = calls.filter(
      (c) => /from\//.test(c.$filter || '') && !/toRecipients/.test(c.$filter)
    );
    expect(fromOnly).toHaveLength(2);
    expect(fromOnly[1].$orderby).toBeUndefined();
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe('a window that $search crossed is fully read', () => {
  test('crossed exactly at the cap: still not "unreached"', async () => {
    // Every message matches "body", so $search returns the newest 275. A
    // window that starts at row 240 is crossed on the fifth page (rows
    // 201–250), where the scan also reaches its 250 limit.
    const box = BOX.map((m) => ({
      ...m,
      body: 'body text',
      bodyPreview: 'body text',
    }));
    const { meta, text } = await run(
      {
        query: 'body',
        receivedAfter: day(2999 - 240),
        unreadOnly: true,
        hasAttachments: true,
        from: undefined,
        count: 50,
      },
      {},
      box
    );

    expect(meta.searchWindowUnreached).toBeUndefined();
    expect(text).not.toContain('beyond what `$search` paging can reach');
  });
});
