const {
  handleSearchEmails,
  buildFromFilter,
  buildToFilter,
  classifyEmailFilter,
  filterToClientSide,
  filterQueryClientSide,
  filterFromClientSide,
  filterSubjectClientSide,
} = require('../../email/search');
const { callGraphAPIPaginated } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { resolveFolderPath } = require('../../email/folder-utils');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
jest.mock('../../email/folder-utils');

const mockAccessToken = 'test_token';
const INBOX_ENDPOINT = 'me/mailFolders/inbox/messages';

// Helper to build mock email objects
function mockEmail(overrides = {}) {
  return {
    id: overrides.id || 'email-1',
    subject: overrides.subject || 'Test Email',
    from: overrides.from || {
      emailAddress: {
        name: 'John Doe',
        address: 'john@example.com',
      },
    },
    toRecipients: overrides.toRecipients || [
      { emailAddress: { name: 'Jane Smith', address: 'jane@example.com' } },
    ],
    receivedDateTime: overrides.receivedDateTime || '2026-02-15T10:30:00Z',
    isRead: overrides.isRead ?? false,
    bodyPreview: overrides.bodyPreview || 'This is a test email body preview.',
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
  resolveFolderPath.mockResolvedValue(INBOX_ENDPOINT);
});

afterEach(() => {
  console.error.mockRestore();
});

// ──────────────────────────────────────────────────
// classifyEmailFilter
// ──────────────────────────────────────────────────
describe('classifyEmailFilter', () => {
  test('should classify domain starting with @', () => {
    expect(classifyEmailFilter('@example.com')).toBe('domain');
  });

  test('should classify domain without @ but with dots', () => {
    expect(classifyEmailFilter('souliv.com.au')).toBe('domain');
  });

  test('should classify full email address', () => {
    expect(classifyEmailFilter('user@example.com')).toBe('email');
  });

  test('should classify plain name', () => {
    expect(classifyEmailFilter('John')).toBe('name');
  });
});

// ──────────────────────────────────────────────────
// buildFromFilter
// ──────────────────────────────────────────────────
describe('buildFromFilter', () => {
  test('should produce eq filter for email address', () => {
    const filter = buildFromFilter('user@example.com');
    expect(filter).toBe("from/emailAddress/address eq 'user@example.com'");
  });

  test('should produce contains filter for domain', () => {
    const filter = buildFromFilter('example.com');
    expect(filter).toBe("contains(from/emailAddress/address, 'example.com')");
  });

  test('should produce contains filter for name', () => {
    const filter = buildFromFilter('John');
    expect(filter).toBe("contains(from/emailAddress/name, 'John')");
  });

  // ── #230: single quotes must be OData-escaped (doubled) ──

  test('should escape single quotes in an email address', () => {
    const filter = buildFromFilter("o'brien@example.com");
    expect(filter).toBe("from/emailAddress/address eq 'o''brien@example.com'");
  });

  test('should escape single quotes in a display name', () => {
    const filter = buildFromFilter("O'Brien");
    expect(filter).toBe("contains(from/emailAddress/name, 'O''Brien')");
  });

  test('should escape single quotes in a domain', () => {
    const filter = buildFromFilter("d'angelo.com");
    expect(filter).toBe("contains(from/emailAddress/address, 'd''angelo.com')");
  });

  test('should neutralise an OData injection attempt', () => {
    const filter = buildFromFilter("x' or startswith(subject,'");
    // Every quote doubled, so the payload stays inside the string literal
    // rather than closing it and appending a new clause.
    expect(filter).toBe(
      "contains(from/emailAddress/name, 'x'' or startswith(subject,''')"
    );
    // The raw, literal-terminating form must not survive.
    expect(filter).not.toContain("'x' or");
  });
});

// ──────────────────────────────────────────────────
// buildToFilter
// ──────────────────────────────────────────────────
describe('buildToFilter', () => {
  test('should produce any() filter for email address', () => {
    const filter = buildToFilter('user@example.com');
    expect(filter).toBe(
      "toRecipients/any(r: r/emailAddress/address eq 'user@example.com')"
    );
  });

  test('should produce any() contains filter for domain', () => {
    const filter = buildToFilter('example.com');
    expect(filter).toBe(
      "toRecipients/any(r: contains(r/emailAddress/address, 'example.com'))"
    );
  });

  test('should produce any() contains filter for name', () => {
    const filter = buildToFilter('Jane');
    expect(filter).toBe(
      "toRecipients/any(r: contains(r/emailAddress/name, 'Jane'))"
    );
  });

  // ── #230: single quotes must be OData-escaped (doubled) ──

  test('should escape single quotes in an email address', () => {
    const filter = buildToFilter("o'brien@example.com");
    expect(filter).toBe(
      "toRecipients/any(r: r/emailAddress/address eq 'o''brien@example.com')"
    );
  });

  test('should escape single quotes in a display name', () => {
    const filter = buildToFilter("O'Brien");
    expect(filter).toBe(
      "toRecipients/any(r: contains(r/emailAddress/name, 'O''Brien'))"
    );
  });

  test('should escape single quotes in a domain', () => {
    const filter = buildToFilter("d'angelo.com");
    expect(filter).toBe(
      "toRecipients/any(r: contains(r/emailAddress/address, 'd''angelo.com'))"
    );
  });

  test('should neutralise an OData injection attempt', () => {
    const filter = buildToFilter("x' or startswith(subject,'");
    expect(filter).toBe(
      "toRecipients/any(r: contains(r/emailAddress/name, 'x'' or startswith(subject,'''))"
    );
    expect(filter).not.toContain("'x' or");
  });
});

// ──────────────────────────────────────────────────
// filterToClientSide
// ──────────────────────────────────────────────────
describe('filterToClientSide', () => {
  const messages = [
    mockEmail({
      id: '1',
      toRecipients: [
        {
          emailAddress: {
            name: 'Sarah Blake',
            address: 'sblake@bristax.com.au',
          },
        },
      ],
    }),
    mockEmail({
      id: '2',
      toRecipients: [
        { emailAddress: { name: 'Bob Jones', address: 'bob@other.com' } },
      ],
    }),
    mockEmail({
      id: '3',
      toRecipients: [
        { emailAddress: { name: 'Anna', address: 'anna@bristax.com.au' } },
        { emailAddress: { name: 'Charlie', address: 'charlie@example.com' } },
      ],
    }),
  ];

  test('should match by email address', () => {
    const result = filterToClientSide(messages, 'sblake@bristax.com.au');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('should match by domain', () => {
    const result = filterToClientSide(messages, 'bristax.com.au');
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(['1', '3']);
  });

  test('should match by display name', () => {
    const result = filterToClientSide(messages, 'Sarah');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('should be case-insensitive', () => {
    const result = filterToClientSide(messages, 'SBLAKE@BRISTAX.COM.AU');
    expect(result).toHaveLength(1);
  });

  test('should return empty array when no match', () => {
    const result = filterToClientSide(messages, 'nonexistent@nowhere.com');
    expect(result).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────
// filterQueryClientSide
// ──────────────────────────────────────────────────
describe('filterQueryClientSide', () => {
  const messages = [
    mockEmail({
      id: '1',
      subject: 'Tax Return Drafts 2025',
      bodyPreview: 'Please find attached the tax return drafts.',
    }),
    mockEmail({
      id: '2',
      subject: 'Meeting Tomorrow',
      bodyPreview: 'Reminder about our meeting.',
    }),
    mockEmail({
      id: '3',
      subject: 'Invoice #123',
      bodyPreview: 'Your Bristax invoice is attached.',
      from: {
        emailAddress: {
          name: 'Bristax Admin',
          address: 'admin@bristax.com.au',
        },
      },
    }),
  ];

  test('should match in subject', () => {
    const result = filterQueryClientSide(messages, 'Tax Return');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('should match in bodyPreview', () => {
    const result = filterQueryClientSide(messages, 'bristax');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  test('should match in from address', () => {
    const result = filterQueryClientSide(messages, 'admin@bristax');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  test('should match in from name', () => {
    const result = filterQueryClientSide(messages, 'Bristax Admin');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  test('should be case-insensitive', () => {
    const result = filterQueryClientSide(messages, 'TAX RETURN');
    expect(result).toHaveLength(1);
  });

  test('should return empty array when no match', () => {
    const result = filterQueryClientSide(messages, 'nonexistent');
    expect(result).toHaveLength(0);
  });

  test('multi-word query splits on whitespace and ANDs (F-12)', () => {
    const githubMessages = [
      mockEmail({
        id: 'gh1',
        subject: '[GitHub] Your fine-grained personal access token',
        bodyPreview: 'A token was created on your account.',
      }),
      mockEmail({
        id: 'unrelated',
        subject: 'Order confirmation',
        bodyPreview: 'Thanks for your purchase.',
      }),
    ];
    // Previously this would have failed because no field contained
    // the literal phrase "github token"; F-12 changed the matcher to
    // require all whitespace-separated words to be present (in any
    // order, anywhere in subject/body/from).
    const result = filterQueryClientSide(githubMessages, 'github token');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('gh1');
  });

  test('multi-word query rejects when not all words present', () => {
    // 'unicorn' appears nowhere; even though 'tax' is present in
    // multiple messages, the AND requirement fails.
    const result = filterQueryClientSide(messages, 'tax unicorn');
    expect(result).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────
// handleSearchEmails — Bug 1: Silent fallback prevention
// ──────────────────────────────────────────────────
describe('handleSearchEmails — silent fallback prevention', () => {
  test('should return 0 results when from filter matches nothing', async () => {
    // All API calls return empty
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      from: 'nonexistent@example.com',
    });

    expect(result.content[0].text).toContain('No emails found');
    expect(result.content[0].text).toContain('searchAllFolders');
    expect(result._meta.searchMetadata.filterApplied).toBe(false);
    expect(result._meta.returned).toBe(0);
  });

  test('should return 0 results when subject filter matches nothing', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      subject: 'Nonexistent Subject Line',
    });

    expect(result.content[0].text).toContain('No emails found');
    expect(result._meta.searchMetadata.filterApplied).toBe(false);
    expect(result._meta.returned).toBe(0);
  });

  test('should mention the active filters in no-results message', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      from: 'test@example.com',
    });

    expect(result.content[0].text).toContain('filters: from');
  });

  test('should suggest searchAllFolders in no-results message', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      subject: 'Missing',
    });

    expect(result.content[0].text).toContain('searchAllFolders: true');
    expect(result.content[0].text).toContain('folders');
  });

  test('should include searchMetadata in _meta on successful search', async () => {
    const emails = [mockEmail({ id: '1' }), mockEmail({ id: '2' })];
    callGraphAPIPaginated.mockResolvedValue({ value: emails });

    const result = await handleSearchEmails({
      from: 'john@example.com',
    });

    expect(result._meta.searchMetadata).toBeDefined();
    expect(result._meta.searchMetadata.strategiesAttempted).toContain(
      'combined-search'
    );
    expect(result._meta.returned).toBe(2);
  });

  test('should still return recent emails when no filters specified', async () => {
    const emails = [mockEmail({ id: '1' }), mockEmail({ id: '2' })];
    // First call (combined search) — no search terms so goes to boolean, then recent
    callGraphAPIPaginated.mockResolvedValue({ value: emails });

    const result = await handleSearchEmails({});

    expect(result._meta.returned).toBe(2);
    expect(result.content[0].text).toContain('Search Results');
  });
});

// ──────────────────────────────────────────────────
// handleSearchEmails — kqlQuery branch (#169)
// ──────────────────────────────────────────────────
describe('handleSearchEmails — kqlQuery silent-drop prevention (#169)', () => {
  test('returns 0 results (with guidance) when kqlQuery matches nothing — no fallthrough to combined-search', async () => {
    // The bug: previous behaviour would call Graph $search, get [],
    // then *fall through* to combined-search, which would run
    // *without* the kqlQuery filter and return unrelated recent emails.
    //
    // Uses a free-form expression deliberately. Field-scoped expressions are
    // now translated into OData filters and retried (#217), which preserves
    // the caller's intent; this invariant is about expressions whose meaning
    // cannot be reproduced, where terminating is the only honest option.
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      kqlQuery: 'personal access token',
      searchAllFolders: true,
    });

    expect(result.content[0].text).toContain('No emails found');
    expect(result._meta.returned).toBe(0);
    // Critical: the only Graph call should have been the kqlQuery one;
    // we must NOT fall through to combined-search and re-query without
    // the filter.
    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    // strategy line should be raw-kql, never combined-search
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
  });

  test('returns kqlQuery results when Graph returns matches', async () => {
    const emails = [mockEmail({ id: '1', subject: 'PR review' })];
    callGraphAPIPaginated.mockResolvedValue({ value: emails });

    const result = await handleSearchEmails({
      kqlQuery: 'subject:PR',
    });

    expect(result._meta.returned).toBe(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
  });

  test('does NOT auto-wrap a kqlQuery that already contains quotes', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({
      kqlQuery: 'subject:"personal access token"',
    });

    // Inspect the params passed to Graph — $search should be the
    // *original* string, not double-wrapped to `"subject:"foo""`.
    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('subject:"personal access token"');
  });

  test('does NOT auto-wrap a kqlQuery that contains a colon (KQL field syntax)', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ kqlQuery: 'from:github.com' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('from:github.com');
  });

  test('quotes a bare single-token kqlQuery so Graph treats it as a phrase', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ kqlQuery: 'invoice' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('"invoice"');
  });

  test('does NOT auto-wrap a multi-word kqlQuery (whitespace = trust caller)', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ kqlQuery: 'invoice OR receipt' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('invoice OR receipt');
  });

  test('surfaces Graph errors instead of falling through to unrelated results', async () => {
    callGraphAPIPaginated.mockRejectedValueOnce(
      new Error('Graph 400: invalid $search syntax')
    );

    const result = await handleSearchEmails({
      kqlQuery: 'badly-formed:::query',
    });

    expect(result._meta.returned).toBe(0);
    // Final strategy should be the raw-kql-error marker, not a
    // misleading "combined-search" line.
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql-error');
    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────
// handleSearchEmails — Bug 2: Client-side to filter
// ──────────────────────────────────────────────────
describe('handleSearchEmails — client-side to filter', () => {
  test('should use client-side to filter when API returns 0 results', async () => {
    const bristaxEmail = mockEmail({
      id: 'bristax-1',
      subject: 'Tax Invoice',
      toRecipients: [
        {
          emailAddress: {
            name: 'Sarah Blake',
            address: 'sblake@bristax.com.au',
          },
        },
      ],
    });
    const otherEmail = mockEmail({
      id: 'other-1',
      subject: 'Unrelated',
      toRecipients: [
        { emailAddress: { name: 'Bob', address: 'bob@other.com' } },
      ],
    });

    callGraphAPIPaginated
      // First call: combined search returns empty
      .mockResolvedValueOnce({ value: [] })
      // Second call: single-term 'to' with lambda filter returns empty
      .mockResolvedValueOnce({ value: [] })
      // Third call: client-side fallback fetch returns all messages
      .mockResolvedValueOnce({ value: [bristaxEmail, otherEmail] });

    const result = await handleSearchEmails({
      to: 'sblake@bristax.com.au',
    });

    // Should have filtered client-side and found the Bristax email
    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Tax Invoice');
  });

  test('should use client-side to filter when InefficientFilter thrown', async () => {
    const bristaxEmail = mockEmail({
      id: 'bristax-1',
      subject: 'Tax Invoice',
      toRecipients: [
        {
          emailAddress: {
            name: 'Sarah Blake',
            address: 'sblake@bristax.com.au',
          },
        },
      ],
    });

    callGraphAPIPaginated
      // Combined search throws
      .mockRejectedValueOnce(new Error('InefficientFilter'))
      // Single-term 'to' throws InefficientFilter
      .mockRejectedValueOnce(new Error('InefficientFilter'))
      // Client-side fallback fetch
      .mockResolvedValueOnce({ value: [bristaxEmail] });

    const result = await handleSearchEmails({
      to: 'sblake@bristax.com.au',
    });

    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Tax Invoice');
  });

  test('should return 0 results when client-side to filter finds no matches', async () => {
    const otherEmail = mockEmail({
      id: 'other-1',
      toRecipients: [
        { emailAddress: { name: 'Bob', address: 'bob@other.com' } },
      ],
    });

    callGraphAPIPaginated
      // Combined search empty
      .mockResolvedValueOnce({ value: [] })
      // Single-term 'to' empty
      .mockResolvedValueOnce({ value: [] })
      // Client-side fetch — no matching recipients
      .mockResolvedValueOnce({ value: [otherEmail] });

    const result = await handleSearchEmails({
      to: 'sblake@bristax.com.au',
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).toContain('No emails found');
  });
});

// ──────────────────────────────────────────────────
// handleSearchEmails — Bug 3: Client-side query search
// ──────────────────────────────────────────────────
describe('handleSearchEmails — client-side query search', () => {
  test('should use client-side body search when subject search returns empty', async () => {
    const matchingEmail = mockEmail({
      id: 'match-1',
      subject: 'Invoice #456',
      bodyPreview: 'Please review the bristax quarterly report attached.',
    });
    const otherEmail = mockEmail({
      id: 'other-1',
      subject: 'Newsletter',
      bodyPreview: 'Weekly news update.',
    });

    callGraphAPIPaginated
      // Combined search empty
      .mockResolvedValueOnce({ value: [] })
      // Single-term 'query' contains(subject) empty
      .mockResolvedValueOnce({ value: [] })
      // Client-side body search fetch
      .mockResolvedValueOnce({ value: [matchingEmail, otherEmail] });

    const result = await handleSearchEmails({
      query: 'bristax',
    });

    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Invoice #456');
  });

  test('should return 0 results when client-side body search finds nothing', async () => {
    const otherEmail = mockEmail({
      id: 'other-1',
      subject: 'Newsletter',
      bodyPreview: 'Weekly news update.',
    });

    callGraphAPIPaginated
      // Combined search empty
      .mockResolvedValueOnce({ value: [] })
      // Single-term 'query' empty
      .mockResolvedValueOnce({ value: [] })
      // Client-side body search — no match
      .mockResolvedValueOnce({ value: [otherEmail] });

    const result = await handleSearchEmails({
      query: 'bristax',
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).toContain('No emails found');
  });
});

// ──────────────────────────────────────────────────
// handleSearchEmails — cross-folder search (#169 V37-F-2)
// ──────────────────────────────────────────────────
describe('handleSearchEmails — cross-folder search (#169 V37-F-2)', () => {
  test('client-side scan depth is decoupled from result count (scans CLIENT_SCAN_LIMIT, not maxCount*5)', async () => {
    // The bug: the client-side fallback fetched only maxCount*5 (=50 at the
    // default count) recent messages. With searchAllFolders that window spans
    // every folder, so inbox matches got pushed out and cross-folder returned
    // FEWER results than inbox-only. The scan budget must be independent of
    // the requested result count.
    const githubEmail = mockEmail({
      id: 'gh-1',
      subject: '[GitHub] Your fine-grained personal access token expired',
      bodyPreview: 'A token on your account has expired.',
    });

    callGraphAPIPaginated
      // combined-search ($search) empty
      .mockResolvedValueOnce({ value: [] })
      // single-term query (AND contains(subject)) empty
      .mockResolvedValueOnce({ value: [] })
      // client-side scan returns the match
      .mockResolvedValueOnce({ value: [githubEmail] });

    const result = await handleSearchEmails({
      query: 'github token',
      searchAllFolders: true,
    });

    // Match is found across folders.
    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('[GitHub]');
    expect(result._meta.searchMetadata.finalStrategy).toBe('client-side-query');

    // The client-side scan (3rd call) targets me/messages with a scan budget
    // of CLIENT_SCAN_LIMIT (default 500), NOT the requested count (10) * 5.
    const scanCall = callGraphAPIPaginated.mock.calls[2];
    expect(scanCall[2]).toBe('me/messages'); // cross-folder endpoint
    expect(scanCall[4]).toBe(500); // maxCount arg = CLIENT_SCAN_LIMIT
    // Scan coverage is surfaced so clients can detect truncation.
    expect(result._meta.searchMetadata.scanLimit).toBe(500);
    expect(result._meta.searchMetadata.truncated).toBe(false);
  });

  test('multi-word query builds an AND of per-word contains(subject) (non-contiguous match)', async () => {
    callGraphAPIPaginated
      // combined-search empty
      .mockResolvedValueOnce({ value: [] })
      // single-term query — inspect its $filter, then return empty
      .mockResolvedValueOnce({ value: [] })
      // client-side scan empty (we only care about the single-term params here)
      .mockResolvedValueOnce({ value: [] });

    await handleSearchEmails({ query: 'github token' });

    // The single-term 'query' call (2nd) must AND a contains() per word so
    // "github token" can match "[GitHub] ... token" where words are apart.
    const singleTermParams = callGraphAPIPaginated.mock.calls[1][3];
    expect(singleTermParams.$filter).toBe(
      "contains(subject, 'github') and contains(subject, 'token')"
    );
  });

  test('labels the scope as "all folders" (not "inbox") when searchAllFolders=true', async () => {
    // No results anywhere → the no-results copy must not claim "inbox".
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      query: 'nothing matches this',
      searchAllFolders: true,
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).toContain('all folders');
    expect(result.content[0].text).not.toContain('in "inbox"');
  });
});

// ──────────────────────────────────────────────────
// handleSearchEmails — searchExpression rename (#169)
// ──────────────────────────────────────────────────
describe('handleSearchEmails — searchExpression alias (#169)', () => {
  test('searchExpression drives the raw-$search branch (same as kqlQuery)', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ searchExpression: 'from:github.com' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('from:github.com');
  });

  test('searchExpression takes precedence over the deprecated kqlQuery alias', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({
      searchExpression: 'subject:new',
      kqlQuery: 'subject:old',
    });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('subject:new');
  });

  test('kqlQuery still works as a back-compat alias', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({ kqlQuery: 'subject:PR' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('subject:PR');
    // The alias must route into the raw-KQL branch. `subject:PR` is
    // field-scoped, so a zero-result run now continues into the #217
    // translated retry — assert the branch, not the terminal label.
    expect(result._meta.searchMetadata.strategiesAttempted).toContain(
      'raw-kql'
    );
  });
});

// ──────────────────────────────────────────────────
// handleSearchEmails — review hardening (#169 code-review fixes)
// ──────────────────────────────────────────────────
describe('handleSearchEmails — client-side fallback hardening (#169)', () => {
  test('client-side fallback honours unreadOnly (does not leak read mail)', async () => {
    const readInvoice = mockEmail({
      id: 'read',
      subject: 'Invoice paid',
      isRead: true,
      bodyPreview: 'invoice attached',
    });
    const unreadInvoice = mockEmail({
      id: 'unread',
      subject: 'Invoice due',
      isRead: false,
      bodyPreview: 'invoice attached',
    });

    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] }) // combined
      .mockResolvedValueOnce({ value: [] }) // single-term query
      .mockResolvedValueOnce({ value: [readInvoice, unreadInvoice] }); // scan

    const result = await handleSearchEmails({
      query: 'invoice',
      unreadOnly: true,
    });

    // Both match "invoice", but only the UNREAD one survives the boolean filter.
    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Invoice due');
    expect(result.content[0].text).not.toContain('Invoice paid');
  });

  test('discloses scan coverage in searchMetadata when a bounded scan matches nothing', async () => {
    const nonMatching = mockEmail({
      id: 'x',
      subject: 'Newsletter',
      bodyPreview: 'weekly news',
    });

    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] }) // combined
      .mockResolvedValueOnce({ value: [] }) // single-term
      .mockResolvedValueOnce({ value: [nonMatching] }); // scan — no 'zebra'

    const result = await handleSearchEmails({
      query: 'zebra',
      searchAllFolders: true,
    });

    expect(result._meta.returned).toBe(0);
    expect(result._meta.searchMetadata.finalStrategy).toBe('no-results');
    // Coverage disclosed even though nothing matched.
    expect(result._meta.searchMetadata.scanLimit).toBe(500);
    expect(result._meta.searchMetadata.candidatesScanned).toBe(1);
    expect(result._meta.searchMetadata.truncated).toBe(false);
  });

  test('does not double-scan when the client-side fetch itself throws', async () => {
    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] }) // combined
      .mockResolvedValueOnce({ value: [] }) // single-term query
      .mockRejectedValueOnce(new Error('network blip')); // scan throws

    const result = await handleSearchEmails({ query: 'anything' });

    // combined + single-term + exactly ONE client-side attempt = 3 (was 4).
    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(3);
    expect(result._meta.returned).toBe(0);
    const strategies = result._meta.searchMetadata.strategiesAttempted;
    expect(strategies.filter((s) => s === 'client-side-query')).toHaveLength(1);
  });

  test('treats a whitespace-only query as no filter (not a match-all scan)', async () => {
    const recent = [mockEmail({ id: 'r1' }), mockEmail({ id: 'r2' })];
    callGraphAPIPaginated.mockResolvedValue({ value: recent });

    const result = await handleSearchEmails({ query: '   ' });

    expect(result._meta.returned).toBe(2);
    const strategies = result._meta.searchMetadata.strategiesAttempted;
    expect(strategies).not.toContain('single-term-query');
    expect(strategies).not.toContain('client-side-query');
  });

  test('treats a whitespace-only searchExpression as absent (no $search: "")', async () => {
    callGraphAPIPaginated.mockResolvedValue({
      value: [mockEmail({ id: 'r1' })],
    });

    const result = await handleSearchEmails({ searchExpression: '   ' });

    const firstParams = callGraphAPIPaginated.mock.calls[0][3];
    expect(firstParams.$search).not.toBe('""');
    const strategies = result._meta.searchMetadata.strategiesAttempted;
    expect(strategies).not.toContain('raw-kql');
  });
});

// ──────────────────────────────────────────────────
// handleSearchEmails — contextual no-results guidance (#231)
// ──────────────────────────────────────────────────
describe('handleSearchEmails — contextual no-results guidance (#231)', () => {
  test('should not repeat the stale "use from instead of to" advice', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({ to: 'nobody@example.com' });
    const text = result.content[0].text;

    // Untrue since v3.7.1 (#139 / PR #141 added the client-side-to fallback).
    expect(text).not.toContain('instead of');
    expect(text).not.toContain('more reliable on personal accounts');
  });

  test('should not suggest searchAllFolders when it is already enabled', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      from: 'nobody@example.com',
      searchAllFolders: true,
    });
    const text = result.content[0].text;

    expect(text).toContain('No emails found');
    expect(text).not.toContain('Try `searchAllFolders: true`');
    expect(text).toContain('All folders were already searched');
  });

  test('should not offer to-related advice when the caller never used to', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({ from: 'nobody@example.com' });

    expect(result.content[0].text).not.toContain('`to`');
  });

  test('should report the client-side fallback the ladder actually used', async () => {
    callGraphAPIPaginated
      // combined-search → empty
      .mockResolvedValueOnce({ value: [] })
      // single-term-to → empty
      .mockResolvedValueOnce({ value: [] })
      // client-side-to candidate fetch → nothing matching
      .mockResolvedValueOnce({
        value: [
          mockEmail({
            id: 'x',
            toRecipients: [
              { emailAddress: { name: 'Bob', address: 'bob@other.com' } },
            ],
          }),
        ],
      });

    const result = await handleSearchEmails({ to: 'nobody@example.com' });
    const text = result.content[0].text;

    expect(result._meta.searchMetadata.strategiesAttempted).toContain(
      'client-side-to'
    );
    expect(text).toContain('matched locally');
    expect(text).toContain('`to`');
  });

  test('should point out that combined filters must all match', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      from: 'someone@example.com',
      subject: 'Nonexistent',
    });

    expect(result.content[0].text).toContain('must match the same message');
  });

  test('should tailor advice to a searchExpression call', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      searchExpression: 'totally-absent-token',
    });
    const text = result.content[0].text;

    expect(text).toContain('filters: searchExpression');
    expect(text).not.toContain('instead of');
  });
});

// ──────────────────────────────────────────────────
// handleSearchEmails — partial-filter superset prevention (#229)
// ──────────────────────────────────────────────────
describe('handleSearchEmails — partial-filter superset prevention (#229)', () => {
  const sbdhEmails = [
    mockEmail({
      id: 's1',
      subject: 'Weekly update',
      from: {
        emailAddress: { name: 'SBDH', address: 'info@sbdh.org.au' },
      },
    }),
    mockEmail({
      id: 's2',
      subject: 'Newsletter',
      from: {
        emailAddress: { name: 'SBDH', address: 'info@sbdh.org.au' },
      },
    }),
  ];

  test('should not return the from-only superset when subject also supplied', async () => {
    callGraphAPIPaginated
      // combined-search → empty (personal account rejects the combined filter)
      .mockResolvedValueOnce({ value: [] })
      // single-term-from → the from-only set, none matching the subject
      .mockResolvedValueOnce({ value: sbdhEmails })
      // single-term-subject → empty
      .mockResolvedValueOnce({ value: [] });

    const result = await handleSearchEmails({
      from: 'info@sbdh.org.au',
      subject: 'Zebra Quokka Nonexistent',
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).toContain('No emails found');
    expect(result._meta.searchMetadata.filterApplied).toBe(false);
  });

  test('should narrow the from-only set by subject rather than dropping it', async () => {
    const matching = mockEmail({
      id: 's3',
      subject: 'Your Order Confirmation',
      from: { emailAddress: { name: 'SBDH', address: 'info@sbdh.org.au' } },
    });

    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: [...sbdhEmails, matching] });

    const result = await handleSearchEmails({
      from: 'info@sbdh.org.au',
      subject: 'Order',
    });

    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Your Order Confirmation');
    expect(result._meta.searchMetadata.clientSideFilters).toContain('subject');
    expect(result._meta.searchMetadata.droppedFilters).toEqual([]);
    expect(result._meta.searchMetadata.filterApplied).toBe(true);
  });

  test('should not return the from-only superset when to also supplied', async () => {
    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] })
      // single-term-from wins, but none of them went to the requested recipient
      .mockResolvedValueOnce({ value: sbdhEmails })
      // single-term-to → empty
      .mockResolvedValueOnce({ value: [] })
      // client-side-to candidate scan → nothing matching either
      .mockResolvedValueOnce({ value: sbdhEmails });

    const result = await handleSearchEmails({
      from: 'info@sbdh.org.au',
      to: 'zzznonexistent@nowhere.invalid',
    });

    expect(result._meta.returned).toBe(0);
    expect(result._meta.searchMetadata.filterApplied).toBe(false);
  });

  test('should not let the boolean-only step drop the from filter', async () => {
    const unreadFromSomeoneElse = mockEmail({
      id: 'u1',
      subject: 'Unrelated unread',
      from: {
        emailAddress: { name: 'Someone', address: 'someone@other.example' },
      },
      isRead: false,
    });

    callGraphAPIPaginated
      // combined-search → empty
      .mockResolvedValueOnce({ value: [] })
      // single-term-from → empty
      .mockResolvedValueOnce({ value: [] })
      // boolean-filters-only → unread mail from a completely different sender
      .mockResolvedValueOnce({ value: [unreadFromSomeoneElse] });

    const result = await handleSearchEmails({
      from: 'info@sbdh.org.au',
      unreadOnly: true,
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).not.toContain('Unrelated unread');
    expect(result._meta.searchMetadata.filterApplied).toBe(false);
  });

  test('should also narrow the client-side to fallback by the other terms', async () => {
    const wanted = mockEmail({
      id: 'w1',
      subject: 'Invoice 42',
      toRecipients: [
        { emailAddress: { name: 'Nathan', address: 'nathan@live.com' } },
      ],
    });
    const sameRecipientWrongSubject = mockEmail({
      id: 'w2',
      subject: 'Something else entirely',
      toRecipients: [
        { emailAddress: { name: 'Nathan', address: 'nathan@live.com' } },
      ],
    });

    callGraphAPIPaginated
      // combined-search → empty
      .mockResolvedValueOnce({ value: [] })
      // single-term-to → empty, pushes us to the client-side fallback
      .mockResolvedValueOnce({ value: [] })
      // client-side-to candidate scan
      .mockResolvedValueOnce({
        value: [wanted, sameRecipientWrongSubject],
      });

    const result = await handleSearchEmails({
      to: 'nathan@live.com',
      subject: 'Invoice',
    });

    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Invoice 42');
    expect(result.content[0].text).not.toContain('Something else entirely');
    expect(result._meta.searchMetadata.droppedFilters).toEqual([]);
  });

  test('should report no dropped filters on a clean combined search', async () => {
    callGraphAPIPaginated.mockResolvedValue({
      value: [mockEmail({ id: 'c1' })],
    });

    const result = await handleSearchEmails({
      from: 'john@example.com',
      subject: 'Test',
    });

    expect(result._meta.searchMetadata.finalStrategy).toBe('combined-search');
    expect(result._meta.searchMetadata.droppedFilters).toEqual([]);
    expect(result._meta.searchMetadata.filterApplied).toBe(true);
  });
});

// ──────────────────────────────────────────────────
// filterFromClientSide / filterSubjectClientSide (#229)
// ──────────────────────────────────────────────────
describe('filterFromClientSide', () => {
  const messages = [
    mockEmail({
      id: 'a',
      from: { emailAddress: { name: 'SBDH', address: 'info@sbdh.org.au' } },
    }),
    mockEmail({
      id: 'b',
      from: { emailAddress: { name: 'Other', address: 'x@other.example' } },
    }),
  ];

  test('should match on the sender address', () => {
    expect(filterFromClientSide(messages, 'info@sbdh.org.au')).toHaveLength(1);
  });

  test('should match on a bare domain', () => {
    expect(filterFromClientSide(messages, 'sbdh.org.au')).toHaveLength(1);
  });

  test('should match on the display name, case-insensitively', () => {
    expect(filterFromClientSide(messages, 'sbdh')).toHaveLength(1);
  });

  test('should return nothing when no sender matches', () => {
    expect(filterFromClientSide(messages, 'nobody@nowhere.invalid')).toEqual(
      []
    );
  });
});

describe('filterSubjectClientSide', () => {
  const messages = [
    mockEmail({ id: 'a', subject: 'Your Order Confirmation' }),
    mockEmail({ id: 'b', subject: 'Weekly update' }),
    // mockEmail() substitutes a default subject, so build this one by hand.
    { id: 'c' },
  ];

  test('should match a case-insensitive substring', () => {
    const matched = filterSubjectClientSide(messages, 'order');
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe('a');
  });

  test('should return all messages for an empty needle', () => {
    expect(filterSubjectClientSide(messages, '   ')).toHaveLength(3);
  });

  test('should not throw on a message with no subject field', () => {
    expect(messages[2].subject).toBeUndefined();
    expect(() => filterSubjectClientSide(messages, 'zzz')).not.toThrow();
    expect(filterSubjectClientSide(messages, 'zzz')).toEqual([]);
  });
});

// ──────────────────────────────────────────────────
// handleSearchEmails — field-scoped searchExpression translation (#217)
// ──────────────────────────────────────────────────
describe('handleSearchEmails — field-scoped searchExpression (#217)', () => {
  const sbdh = [
    mockEmail({
      id: 'p1',
      subject: 'Small Business Debt Helpline update',
      from: { emailAddress: { name: 'SBDH', address: 'info@sbdh.org.au' } },
    }),
  ];

  test('should translate a from: expression and retry as an OData filter', async () => {
    callGraphAPIPaginated
      // raw-kql $search → 0 on a personal account
      .mockResolvedValueOnce({ value: [] })
      // translated combined-search → the messages that were there all along
      .mockResolvedValueOnce({ value: sbdh });

    const result = await handleSearchEmails({
      searchExpression: 'from:info@sbdh.org.au',
    });

    expect(result._meta.returned).toBe(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe(
      'raw-kql-translated'
    );
    expect(result._meta.searchMetadata.strategiesAttempted).toContain(
      'raw-kql'
    );

    // The retry must carry the caller's intent as a real filter.
    const [, , , retryParams] = callGraphAPIPaginated.mock.calls[1];
    expect(retryParams.$filter).toContain('info@sbdh.org.au');
  });

  test('should report the rewrite in searchMetadata.kqlTranslatedTo', async () => {
    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: sbdh });

    const result = await handleSearchEmails({
      searchExpression: 'from:info@sbdh.org.au',
    });

    // A translated retry answers a rewritten query, so the rewrite has to be
    // inspectable rather than something the caller takes on trust. (#217)
    expect(result._meta.searchMetadata.kqlTranslatedTo).toEqual({
      from: 'info@sbdh.org.au',
    });
  });

  test('should omit kqlTranslatedTo when no translation ran', async () => {
    callGraphAPIPaginated.mockResolvedValueOnce({ value: sbdh });

    const result = await handleSearchEmails({ from: 'info@sbdh.org.au' });

    expect(result._meta.searchMetadata).not.toHaveProperty('kqlTranslatedTo');
  });

  test('should translate a quoted subject: expression', async () => {
    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: sbdh });

    const result = await handleSearchEmails({
      searchExpression: 'subject:"Small Business Debt Helpline"',
    });

    expect(result._meta.returned).toBe(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe(
      'raw-kql-translated'
    );
    const [, , , retryParams] = callGraphAPIPaginated.mock.calls[1];
    expect(retryParams.$filter).toBe(
      "contains(subject, 'Small Business Debt Helpline')"
    );
  });

  test('should translate a to: expression, reaching the client-side fallback', async () => {
    const addressed = mockEmail({
      id: 't1',
      toRecipients: [
        { emailAddress: { name: 'Nathan', address: 'nathan@live.com' } },
      ],
    });

    callGraphAPIPaginated
      // raw-kql → 0
      .mockResolvedValueOnce({ value: [] })
      // translated combined-search → 0 (personal account rejects the lambda)
      .mockResolvedValueOnce({ value: [] })
      // translated single-term-to → 0
      .mockResolvedValueOnce({ value: [] })
      // client-side-to candidate scan
      .mockResolvedValueOnce({ value: [addressed] });

    const result = await handleSearchEmails({
      searchExpression: 'to:nathan@live.com',
    });

    expect(result._meta.returned).toBe(1);
    expect(result._meta.searchMetadata.strategiesAttempted).toContain(
      'client-side-to'
    );
    expect(result._meta.searchMetadata.finalStrategy).toBe(
      'raw-kql-translated'
    );
  });

  test('should translate a multi-field expression into both filters', async () => {
    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: sbdh });

    const result = await handleSearchEmails({
      searchExpression: 'from:info@sbdh.org.au subject:Small',
    });

    expect(result._meta.returned).toBe(1);
    const [, , , retryParams] = callGraphAPIPaginated.mock.calls[1];
    expect(retryParams.$filter).toContain('info@sbdh.org.au');
    expect(retryParams.$filter).toContain("contains(subject, 'Small')");
  });

  test('should still report searchExpression as the caller-facing filter', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      searchExpression: 'from:nobody@nowhere.invalid',
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).toContain('filters: searchExpression');
  });

  // ── The #169 V37-F-1 guarantee, for everything not field-scoped ──

  test.each([
    ['free text', 'personal access token'],
    ['a boolean expression', 'invoice OR receipt'],
    ['an unknown field prefix', 'body:test'],
    ['a scoped term mixed with free text', 'from:x@y.com hello'],
    ['a repeated field', 'from:a@b.com from:c@d.com'],
    ['a wildcard value', 'from:*@b.com'],
    ['a trailing wildcard', 'from:a@b.com*'],
    ['a grouped value', 'subject:(foo)'],
  ])(
    'should NOT translate %s — terminates after the single raw-kql call',
    async (_label, expression) => {
      callGraphAPIPaginated.mockResolvedValue({ value: [] });

      const result = await handleSearchEmails({
        searchExpression: expression,
      });

      expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
      expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
      expect(result._meta.returned).toBe(0);
    }
  );

  // Graph does not answer a field-scoped expression with 0 on a personal
  // account — it rejects the request outright:
  //   400 BadRequest "Syntax error: character ':' is not valid at position 4
  //   in 'from:info@sbdh.org.au'."
  // Verified live 2026-09-09. The error path is the one that actually fires.

  test('should translate after Graph rejects a field-scoped expression', async () => {
    callGraphAPIPaginated
      .mockRejectedValueOnce(
        new Error(
          `API call failed with status 400: {"error":{"code":"BadRequest","message":"Syntax error: character ':' is not valid at position 4 in 'from:info@sbdh.org.au'."}}`
        )
      )
      .mockResolvedValueOnce({ value: sbdh });

    const result = await handleSearchEmails({
      searchExpression: 'from:info@sbdh.org.au',
    });

    expect(result._meta.returned).toBe(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe(
      'raw-kql-translated'
    );
    expect(result._meta.searchMetadata.strategiesAttempted).toContain(
      'raw-kql-error'
    );
    const [, , , retryParams] = callGraphAPIPaginated.mock.calls[1];
    expect(retryParams.$filter).toContain('info@sbdh.org.au');
  });

  test('should still surface the error for an untranslatable expression', async () => {
    callGraphAPIPaginated.mockRejectedValue(
      new Error('API call failed with status 400: invalid $search syntax')
    );

    const result = await handleSearchEmails({
      searchExpression: 'invoice OR receipt',
    });

    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql-error');
    expect(result._meta.returned).toBe(0);
  });

  test('should surface the original error when the translated retry finds nothing', async () => {
    callGraphAPIPaginated
      .mockRejectedValueOnce(
        new Error("Syntax error: character ':' is not valid")
      )
      // translated ladder finds nothing anywhere
      .mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      searchExpression: 'from:nobody@nowhere.invalid',
    });

    expect(result._meta.returned).toBe(0);
    expect(result._meta.searchMetadata.finalStrategy).toBe(
      'raw-kql-translated'
    );
    expect(result.content[0].text).toContain('filters: searchExpression');
  });

  test('should not translate when the raw expression already found matches', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: sbdh });

    const result = await handleSearchEmails({
      searchExpression: 'from:info@sbdh.org.au',
    });

    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
  });
});

// ──────────────────────────────────────────────────
// Review follow-ups on the #229 narrowing
// ──────────────────────────────────────────────────
describe('handleSearchEmails — narrowing correctness follow-ups', () => {
  test('should request the fields the local matchers read when narrowing is possible', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ from: 'a@x.com', to: 'b@y.com' });

    // `outputVerbosity` is a presentation parameter. If a multi-term search
    // used the `list` preset, `filterToClientSide` would see no
    // `toRecipients` on any row and drop every result.
    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$select).toContain('toRecipients');
    expect(params.$select).toContain('bodyPreview');
  });

  test('should keep the lean preset for a single-term search', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ from: 'a@x.com' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$select).not.toContain('toRecipients');
  });

  test('should find the same message at default verbosity as at full verbosity', async () => {
    const wanted = mockEmail({
      id: 'v1',
      from: { emailAddress: { name: 'Alice', address: 'alice@corp.com' } },
      toRecipients: [
        { emailAddress: { name: 'Bob', address: 'bob@corp.com' } },
      ],
    });

    const run = async (outputVerbosity) => {
      jest.resetAllMocks();
      ensureAuthenticated.mockResolvedValue(mockAccessToken);
      resolveFolderPath.mockResolvedValue(INBOX_ENDPOINT);
      callGraphAPIPaginated
        // combined-search → empty
        .mockResolvedValueOnce({ value: [] })
        // single-term-from → the match
        .mockResolvedValueOnce({ value: [wanted] });
      const r = await handleSearchEmails({
        from: 'alice@corp.com',
        to: 'bob@corp.com',
        ...(outputVerbosity && { outputVerbosity }),
      });
      return r._meta.returned;
    };

    expect(await run(undefined)).toBe(1);
    expect(await run('full')).toBe(1);
  });

  test('should not claim filterApplied on an empty InefficientFilter retry', async () => {
    callGraphAPIPaginated
      // combined-search → empty
      .mockResolvedValueOnce({ value: [] })
      // single-term-subject → empty
      .mockResolvedValueOnce({ value: [] })
      // boolean-filters-only → InefficientFilter
      .mockRejectedValueOnce(new Error('InefficientFilter'))
      // retry without $orderby → unread mail that does not match the subject
      .mockResolvedValueOnce({
        value: [mockEmail({ id: 'u1', subject: 'Something else' })],
      })
      .mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      subject: 'NOPE',
      unreadOnly: true,
    });

    expect(result._meta.returned).toBe(0);
    expect(result._meta.searchMetadata.filterApplied).toBe(false);
    // Must reach the no-results rung so the #231 guidance actually renders.
    expect(result.content[0].text).toContain('**Suggestions:**');
  });

  test('should not report a totalAvailable that survived narrowing', async () => {
    const from = { emailAddress: { name: 'Alice', address: 'alice@corp.com' } };
    const page = [
      mockEmail({ id: 'n1', subject: 'Quarterly Report', from }),
      mockEmail({ id: 'n2', subject: 'Lunch', from }),
      mockEmail({ id: 'n3', subject: 'Parking', from }),
    ];

    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: page, '@odata.count': 3 });

    const result = await handleSearchEmails({
      from: 'alice@corp.com',
      subject: 'Report',
    });

    expect(result._meta.returned).toBe(1);
    // Reporting 3 would invite a caller to paginate for two matches that
    // do not exist.
    expect(result._meta.totalAvailable).not.toBe(3);
    expect(result._meta.hasMore).toBe(false);
  });

  test('should disclose how many messages a failed narrowing examined', async () => {
    const from = { emailAddress: { name: 'Alice', address: 'alice@corp.com' } };
    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({
        value: [
          mockEmail({ id: 'd1', subject: 'Lunch', from }),
          mockEmail({ id: 'd2', subject: 'Parking', from }),
        ],
      })
      .mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      from: 'alice@corp.com',
      subject: 'Report',
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).toContain(
      'applied locally to the 2 messages'
    );
  });
});

describe('filterFromClientSide — parity with buildFromFilter', () => {
  const msg = (address, name = 'Someone') => ({
    id: address,
    from: { emailAddress: { name, address } },
  });

  test('should match a subdomain sender for an @domain value', () => {
    // buildFromFilter('@example.com') strips the @ and does contains(), so a
    // substring test on the raw '@example.com' would wrongly exclude this.
    const matched = filterFromClientSide(
      [msg('alerts@mail.example.com')],
      '@example.com'
    );
    expect(matched).toHaveLength(1);
  });

  test('should not match a longer local-part for an exact address', () => {
    // buildFromFilter uses `eq` for a full address.
    expect(filterFromClientSide([msg('bbob@x.com')], 'bob@x.com')).toEqual([]);
    expect(filterFromClientSide([msg('bob@x.com')], 'bob@x.com')).toHaveLength(
      1
    );
  });

  test('should not match a display name for a domain value', () => {
    // buildFromFilter's domain branch only looks at the address.
    const matched = filterFromClientSide(
      [msg('noreply@other.net', 'Example.com Support')],
      'example.com'
    );
    expect(matched).toEqual([]);
  });
});

// ──────────────────────────────────────────────────
// Filter composition — a filtered search must never return a superset
//
// Regression cover for the defect report of 2026-09-09: `to` combined with a
// date window returned the date-window superset, framed as a filtered result.
// Root cause was `addBooleanFilters` assigning `params.$filter` over the term
// filter the single-term rung had just built.
//
// These assert on the RESULT SET (every row satisfies every supplied filter),
// not merely that the call succeeded — the whole family of defects here return
// HTTP 200 and well-formed output.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — filter composition (superset prevention)', () => {
  /**
   * Mock Graph faithfully enough to catch $select-dependent defects: project
   * every returned row down to the requested $select, exactly as Graph does.
   * A mock that returns full objects regardless of $select hides any bug where
   * a client-side matcher reads a field the request never asked for.
   */
  function mockGraphWithProjection({ rows, rejectLambda = true }) {
    // Not `async`: the call sites all `await` inside a try/catch, so a
    // synchronous throw models a Graph rejection just as faithfully.
    callGraphAPIPaginated.mockImplementation(
      (_token, _method, _endpoint, params) => {
        const filter = params.$filter || '';

        // Personal Outlook.com rejects toRecipients/any() lambdas.
        if (rejectLambda && filter.includes('toRecipients/any')) {
          throw new Error(
            'InefficientFilter: The restriction or sort order is too complex.'
          );
        }

        let value = rows;
        // Honour a date-range filter so the "date window applied, term dropped"
        // shape is reproducible.
        const after = /receivedDateTime ge ([^\s]+)/.exec(filter);
        const before = /receivedDateTime le ([^\s]+)/.exec(filter);
        if (after) {
          value = value.filter(
            (m) => Date.parse(m.receivedDateTime) >= Date.parse(after[1])
          );
        }
        if (before) {
          value = value.filter(
            (m) => Date.parse(m.receivedDateTime) <= Date.parse(before[1])
          );
        }

        const select = params.$select;
        const projected = value.map((m) => {
          if (!select) return m;
          const out = {};
          for (const key of select.split(',').map((s) => s.trim())) {
            if (key in m) out[key] = m[key];
          }
          return out;
        });
        return { value: projected, '@odata.count': projected.length };
      }
    );
  }

  const TARGET = 'third-party@example.com';

  // Four inbound newsletters inside a June 2023 window, addressed to the
  // mailbox owner — never to TARGET.
  const newslettersInWindow = [
    mockEmail({
      id: 'n1',
      subject: 'ORDER UPDATE: Magnetic Car Window',
      from: { emailAddress: { name: 'eBay', address: 'ebay@ebay.com' } },
      toRecipients: [
        { emailAddress: { name: 'Owner', address: 'owner@example.com' } },
      ],
      receivedDateTime: '2023-06-01T00:09:00Z',
    }),
    mockEmail({
      id: 'n2',
      subject: 'EastLink Transaction Receipt',
      from: {
        emailAddress: {
          name: 'EastLink',
          address: 'do-not-reply@breeze.com.au',
        },
      },
      toRecipients: [
        { emailAddress: { name: 'Owner', address: 'owner@example.com' } },
      ],
      receivedDateTime: '2023-06-01T02:20:00Z',
    }),
  ];

  test('should not return a date-window superset when `to` cannot be applied', async () => {
    mockGraphWithProjection({ rows: newslettersInWindow });

    const result = await handleSearchEmails({
      to: TARGET,
      searchAllFolders: true,
      receivedAfter: '2023-06-01T00:00:00Z',
      receivedBefore: '2023-07-01T00:00:00Z',
      count: 4,
      outputVerbosity: 'standard',
    });

    const text = result.content[0].text;
    // Not one of these was addressed to TARGET.
    expect(text).not.toContain('ORDER UPDATE');
    expect(text).not.toContain('EastLink');
    expect(text).toContain('No emails found');
  });

  test('should keep the `to` predicate in the request when a date window is also supplied', async () => {
    mockGraphWithProjection({ rows: [], rejectLambda: false });

    await handleSearchEmails({
      to: TARGET,
      receivedAfter: '2023-06-01T00:00:00Z',
      receivedBefore: '2023-07-01T00:00:00Z',
    });

    // Every request that carried the date window must ALSO carry the `to`
    // predicate, until the ladder deliberately drops to the date-only rung.
    const termRungs = callGraphAPIPaginated.mock.calls.filter(([, , , p]) =>
      (p.$filter || '').includes('toRecipients')
    );
    expect(termRungs.length).toBeGreaterThan(0);
    for (const [, , , params] of termRungs) {
      expect(params.$filter).toContain('receivedDateTime ge');
      expect(params.$filter).toContain('receivedDateTime le');
    }
  });

  test('should return only messages actually addressed to `to` within the window', async () => {
    const wanted = mockEmail({
      id: 'want-1',
      subject: 'Another transfer',
      toRecipients: [
        { emailAddress: { name: 'Third Party', address: TARGET } },
      ],
      receivedDateTime: '2023-06-15T01:26:00Z',
    });
    mockGraphWithProjection({ rows: [...newslettersInWindow, wanted] });

    const result = await handleSearchEmails({
      to: TARGET,
      searchAllFolders: true,
      receivedAfter: '2023-06-01T00:00:00Z',
      receivedBefore: '2023-07-01T00:00:00Z',
    });

    const text = result.content[0].text;
    expect(text).toContain('Another transfer');
    expect(text).not.toContain('ORDER UPDATE');
    expect(text).not.toContain('EastLink');
  });

  test('should not drop `from` when a date window is supplied', async () => {
    mockGraphWithProjection({ rows: [], rejectLambda: false });

    await handleSearchEmails({
      from: 'alice@corp.com',
      receivedAfter: '2023-06-01T00:00:00Z',
    });

    const fromRungs = callGraphAPIPaginated.mock.calls.filter(([, , , p]) =>
      (p.$filter || '').includes('from/emailAddress')
    );
    expect(fromRungs.length).toBeGreaterThan(0);
    for (const [, , , params] of fromRungs) {
      expect(params.$filter).toContain('receivedDateTime ge');
    }
  });

  test('should not drop `subject` when a boolean filter is supplied', async () => {
    mockGraphWithProjection({ rows: [], rejectLambda: false });

    await handleSearchEmails({ subject: 'invoice', unreadOnly: true });

    const subjectRungs = callGraphAPIPaginated.mock.calls.filter(([, , , p]) =>
      (p.$filter || '').includes('contains(subject')
    );
    expect(subjectRungs.length).toBeGreaterThan(0);
    for (const [, , , params] of subjectRungs) {
      expect(params.$filter).toContain('isRead eq false');
    }
  });

  test('should request toRecipients for a single-term `to` search so local narrowing can match', async () => {
    mockGraphWithProjection({ rows: [], rejectLambda: false });

    await handleSearchEmails({
      to: TARGET,
      receivedAfter: '2023-06-01T00:00:00Z',
    });

    // Every rung that could feed a local `to` narrowing pass must have asked
    // for the field that matcher reads.
    for (const [, , , params] of callGraphAPIPaginated.mock.calls) {
      expect(params.$select).toContain('toRecipients');
    }
  });

  test('should request bodyPreview for a single-term `query` search', async () => {
    mockGraphWithProjection({ rows: [], rejectLambda: false });

    await handleSearchEmails({
      query: 'invoice',
      receivedAfter: '2023-06-01T00:00:00Z',
    });

    for (const [, , , params] of callGraphAPIPaginated.mock.calls) {
      expect(params.$select).toContain('bodyPreview');
    }
  });
});
