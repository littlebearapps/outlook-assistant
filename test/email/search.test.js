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

  test('does not suggest searchAllFolders when it was already enabled', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      query: 'github token',
      searchAllFolders: true,
    });

    expect(result.content[0].text).toContain('all folders');
    expect(result.content[0].text).not.toContain(
      'Try `searchAllFolders: true`'
    );
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

  test('accepts searchQuery as the canonical raw Graph search parameter', async () => {
    const emails = [mockEmail({ id: '1', subject: 'PR review' })];
    callGraphAPIPaginated.mockResolvedValue({ value: emails });

    const result = await handleSearchEmails({
      searchQuery: 'subject:PR',
    });

    expect(result._meta.returned).toBe(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('subject:PR');
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

describe('handleSearchEmails — folder context and sent items UX (#117)', () => {
  test('includes folder context in metadata', async () => {
    const emails = [mockEmail({ id: '1' })];
    callGraphAPIPaginated.mockResolvedValue({ value: emails });
    resolveFolderPath.mockResolvedValue('me/mailFolders/sentitems/messages');

    const result = await handleSearchEmails({
      folder: 'sentitems',
      to: 'alice@example.com',
    });

    expect(result._meta.folder).toBe('sentitems');
    expect(result._meta.searchAllFolders).toBe(false);
  });

  test('hints to use to: when searching sent items with from:', async () => {
    const emails = [mockEmail({ id: '1' })];
    callGraphAPIPaginated.mockResolvedValue({ value: emails });
    resolveFolderPath.mockResolvedValue('me/mailFolders/sentitems/messages');

    const result = await handleSearchEmails({
      folder: 'sentitems',
      from: 'alice@example.com',
    });

    expect(result.content[0].text).toContain(
      'Sent Items searches usually work better with `to`'
    );
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
