const {
  handleSearchEmails,
  buildFromFilter,
  buildToFilter,
  classifyEmailFilter,
  filterToClientSide,
  filterQueryClientSide,
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
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      kqlQuery: 'subject:"personal access token"',
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
// handleSearchEmails — shared mailbox scoping
// ──────────────────────────────────────────────────
describe('handleSearchEmails — shared mailbox', () => {
  test('passes sharedMailbox through to folder resolution', async () => {
    resolveFolderPath.mockResolvedValue(
      'users/shared@company.com/mailFolders/archiv-id/messages'
    );
    callGraphAPIPaginated.mockResolvedValue({ value: [mockEmail()] });

    await handleSearchEmails({
      sharedMailbox: 'shared@company.com',
      folder: 'Archiv',
    });

    expect(resolveFolderPath).toHaveBeenCalledWith(
      mockAccessToken,
      'Archiv',
      'shared@company.com'
    );
  });

  test('accepts email as an alias for sharedMailbox', async () => {
    resolveFolderPath.mockResolvedValue(
      'users/shared@company.com/mailFolders/inbox/messages'
    );
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ email: 'shared@company.com', folder: 'inbox' });

    expect(resolveFolderPath).toHaveBeenCalledWith(
      mockAccessToken,
      'inbox',
      'shared@company.com'
    );
  });

  test('searchAllFolders targets the shared mailbox messages endpoint', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({
      sharedMailbox: 'shared@company.com',
      searchAllFolders: true,
    });

    // First positional arg index 2 is the endpoint passed to Graph
    const endpoint = callGraphAPIPaginated.mock.calls[0][2];
    expect(endpoint).toBe('users/shared@company.com/messages');
    // Folder resolution should be skipped in all-folders mode
    expect(resolveFolderPath).not.toHaveBeenCalled();
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
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
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
