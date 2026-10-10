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

const { enableSharedMailbox } = require('../helpers/shared-mailbox');

enableSharedMailbox();

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

  test('should match a name value against the display name or the address (#328)', () => {
    const filter = buildFromFilter('John');
    expect(filter).toBe(
      "(contains(from/emailAddress/name, 'John') or contains(from/emailAddress/address, 'John'))"
    );
  });

  // ── #230: single quotes must be OData-escaped (doubled) ──

  test('should escape single quotes in an email address', () => {
    const filter = buildFromFilter("o'brien@example.com");
    expect(filter).toBe("from/emailAddress/address eq 'o''brien@example.com'");
  });

  test('should escape single quotes in a display name', () => {
    const filter = buildFromFilter("O'Brien");
    expect(filter).toBe(
      "(contains(from/emailAddress/name, 'O''Brien') or contains(from/emailAddress/address, 'O''Brien'))"
    );
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
      "(contains(from/emailAddress/name, 'x'' or startswith(subject,''') or contains(from/emailAddress/address, 'x'' or startswith(subject,'''))"
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
      "toRecipients/any(r: contains(r/emailAddress/name, 'Jane') or contains(r/emailAddress/address, 'Jane'))"
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
      "toRecipients/any(r: contains(r/emailAddress/name, 'O''Brien') or contains(r/emailAddress/address, 'O''Brien'))"
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
      "toRecipients/any(r: contains(r/emailAddress/name, 'x'' or startswith(subject,''') or contains(r/emailAddress/address, 'x'' or startswith(subject,'''))"
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

  test('sends a pure field-scoped kqlQuery with a quoted value as written', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({
      kqlQuery: 'subject:"personal access token"',
    });

    // The original string, never double-wrapped to `"subject:"foo""`.
    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('subject:"personal access token"');
  });

  test('does NOT wrap a kqlQuery made only of from:/to:/subject: terms', async () => {
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

  test('quotes a multi-word kqlQuery as a whole, operators included (#333)', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ kqlQuery: 'invoice OR receipt' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('"invoice OR receipt"');
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
// $search phrase escaping (#251)
//
// Inside a quoted $search phrase Graph needs `"` and `\` backslash-escaped;
// unescaped, the phrase ends early and Graph answers 400.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — $search phrase escaping (#251)', () => {
  test('escapes double quotes in a free-text query phrase', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ query: 'say "hello"' });

    const searches = callGraphAPIPaginated.mock.calls
      .map(([, , , p]) => p.$search)
      .filter(Boolean);
    expect(searches.length).toBeGreaterThan(0);
    searches.forEach((s) => expect(s).toBe('"say \\"hello\\""'));
  });

  test('doubles a backslash in a free-text query phrase', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ query: 'a\\b' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('"a\\\\b"');
  });

  test('leaves a plain free-text query phrase unchanged', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ query: 'Bunnings' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('"Bunnings"');
  });

  test('escapes the contents of an auto-quoted bare token', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ searchExpression: 'O"Brien\\x' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('"O\\"Brien\\\\x"');
  });

  test('escapes a caller-written expression once when wrapping it (#333)', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({
      searchExpression: 'subject:"a \\"b\\"" OR c\\d',
    });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('"subject:\\"a \\\\\\"b\\\\\\"\\" OR c\\\\d"');
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
    // Sorted since #331, so receivedDateTime leads.
    expect(singleTermParams.$filter).toBe(
      "receivedDateTime ge 1900-01-01T00:00:00Z and contains(subject, 'github') and contains(subject, 'token')"
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
    // Sorted, so receivedDateTime leads the filter. (#331)
    expect(retryParams.$filter).toBe(
      "receivedDateTime ge 1900-01-01T00:00:00Z and contains(subject, 'Small Business Debt Helpline')"
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

    // The page claims more beyond it (#279) and narrowing dropped rows: the
    // total must not survive, but the rows beyond the page were never
    // checked, so `hasMore` stays and coverage is reported as partial
    // (#261 follow-up).
    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({
        value: page,
        '@odata.count': 3,
        hasMore: true,
        '@odata.nextLink':
          'https://graph.microsoft.com/v1.0/me/messages?$skip=3',
      });

    const result = await handleSearchEmails({
      from: 'alice@corp.com',
      subject: 'Report',
    });

    expect(result._meta.returned).toBe(1);
    // Reporting 3 would invite a caller to paginate for two matches that
    // do not exist.
    expect(result._meta.totalAvailable).not.toBe(3);
    expect(result._meta.hasMore).toBe(true);
    expect(result._meta.searchMetadata.partialCoverage).toBe(true);
    expect(result._meta.searchMetadata.narrowedCandidates).toBe(3);
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
        // More beyond this page: without that, the pass saw everything.
        hasMore: true,
      })
      .mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      from: 'alice@corp.com',
      subject: 'Report',
    });

    expect(result._meta.returned).toBe(0);
    // The newest page and then the oldest page (empty here) were both read.
    expect(result.content[0].text).toContain('applied locally to 2 messages');
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

// ──────────────────────────────────────────────────
// `searchExpression` vs `query` — different mechanisms, not a dropped filter
//
// The defect report of 2026-09-09 measured `searchExpression` returning
// irrelevant top hits where `query` returned the obviously-correct message
// (`Bunnings`, `Telstra`), and could not establish whether that was bad
// relevance ranking or residual filter-dropping.
//
// It is neither a drop nor the same request ranked differently: the two
// parameters issue structurally DIFFERENT Graph requests.
//   - `searchExpression` goes out as `$search`, which Graph answers over the
//     whole message including the body, ranked by relevance, not by date.
//   - `query` on a personal account falls back to `contains(subject, ...)`,
//     a precise substring match over the subject only.
// So `query` looks "correct" for a term that appears in a subject line, and
// `searchExpression` surfaces body matches the caller did not expect.
//
// These tests pin that divergence so the documented guidance stays true.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — searchExpression vs query request shape', () => {
  test('searchExpression issues a $search and never a subject contains()', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({
      searchExpression: '"Bunnings"',
      searchAllFolders: true,
      count: 5,
    });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBe('"Bunnings"');
    expect(params.$filter).toBeUndefined();
    // Relevance order is Graph's; we do not impose a date sort on $search.
    expect(params.$orderby).toBeUndefined();
  });

  test('query falls back to a subject contains() when $search fails', async () => {
    // Personal Outlook.com: the $search rung errors, the ladder continues.
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (params.$search) {
        throw new Error(
          'The $search query parameter is currently not supported'
        );
      }
      return Promise.resolve({ value: [] });
    });

    await handleSearchEmails({ query: 'Bunnings', searchAllFolders: true });

    const filters = callGraphAPIPaginated.mock.calls
      .map(([, , , p]) => p.$filter)
      .filter(Boolean);
    expect(
      filters.some((f) => f.includes("contains(subject, 'Bunnings')"))
    ).toBe(true);
  });

  test('an unmatched searchExpression returns no results rather than recent mail', async () => {
    // The control that rules out a total filter drop: if $search were being
    // ignored, this would come back full of unrelated recent messages.
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      searchExpression: '"zzzznonexistentterm"',
      searchAllFolders: true,
    });

    expect(result.content[0].text).toContain('No emails found');
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
  });
});

// ──────────────────────────────────────────────────
// Bounded-scan disclosure on the SUCCESS path
//
// The #231 guidance only fires when a search returns nothing. A client-side
// `to` scan that fills its 500-message budget and returns three hits reads as
// a complete answer — on a 56,000-message mailbox it is nothing of the kind,
// and the caller has no way to know. Disclose the cap whenever it bound the
// result, not only when it produced zero.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — bounded scan disclosure with results', () => {
  test('should disclose truncated scan coverage when the local fallback matched', async () => {
    const wanted = mockEmail({
      id: 'hit-1',
      subject: 'Invoice attached',
      toRecipients: [
        { emailAddress: { name: 'Third Party', address: 'third@example.com' } },
      ],
    });
    // Fill the scan budget so `truncated` is true, with one match in it.
    const filler = Array.from({ length: 499 }, (_, i) =>
      mockEmail({
        id: `filler-${i}`,
        toRecipients: [
          { emailAddress: { name: 'Owner', address: 'owner@example.com' } },
        ],
      })
    );

    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      // Server-side toRecipients lambda is rejected on personal accounts.
      if ((params.$filter || '').includes('toRecipients/any')) {
        throw new Error('InefficientFilter');
      }
      return Promise.resolve({ value: [wanted, ...filler] });
    });

    const result = await handleSearchEmails({ to: 'third@example.com' });

    expect(result.content[0].text).toContain('Invoice attached');
    expect(result._meta.searchMetadata.truncated).toBe(true);
    // The caller must be told the answer is bounded, not exhaustive.
    expect(result.content[0].text).toMatch(/500/);
    expect(result.content[0].text).toMatch(/older|not.*seen|receivedAfter/i);
  });
});

// ──────────────────────────────────────────────────
// #261: Graph rejects `$search` combined with `$orderby` (400 SearchWithOrderBy)
// or `$filter` (400 SearchWithFilter), verified live on a personal mailbox.
// The combined step used to send `$orderby` with every `query`, so `$search`
// never ran and `query` always fell back to the subject match. `$search` now
// goes out alone; the other terms and the date/boolean window are applied to
// the page it returns, sorted newest first.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — $search request shape (#261)', () => {
  const searchCalls = () =>
    callGraphAPIPaginated.mock.calls
      .map(([, , , p]) => p)
      .filter((p) => p && p.$search);

  test.each([
    [{ query: 'Bunnings' }],
    [{ query: 'Bunnings', receivedAfter: '2026-01-01T00:00:00Z' }],
    [{ query: 'Bunnings', unreadOnly: true, hasAttachments: true }],
    [{ query: 'Bunnings', searchAllFolders: true }],
  ])('never sends $orderby or $filter alongside $search: %j', async (args) => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails(args);

    const calls = searchCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const params of calls) {
      expect(params.$orderby).toBeUndefined();
      expect(params.$filter).toBeUndefined();
    }
  });

  // With from/to/subject the structured terms go out as `$filter` and `query`
  // is matched locally (#261 follow-up), so no request may mix the two.
  test.each([
    [{ query: 'Bunnings', subject: 'receipt' }],
    [{ query: 'Bunnings', from: 'info@bunnings.com.au' }],
    [{ query: 'Bunnings', to: 'nathan@live.com' }],
  ])(
    'with a structured term, no request mixes $search and $filter: %j',
    async (args) => {
      callGraphAPIPaginated.mockResolvedValue({ value: [] });

      await handleSearchEmails(args);

      expect(callGraphAPIPaginated).toHaveBeenCalled();
      for (const params of searchCalls()) {
        expect(params.$orderby).toBeUndefined();
        expect(params.$filter).toBeUndefined();
      }
    }
  );

  test('a $search page that arrives out of order comes back newest first', async () => {
    const older = mockEmail({
      id: 'old',
      subject: 'Bunnings order (older)',
      receivedDateTime: '2026-03-01T00:00:00Z',
    });
    const newest = mockEmail({
      id: 'new',
      subject: 'Bunnings order (newest)',
      receivedDateTime: '2026-09-01T00:00:00Z',
    });
    const middle = mockEmail({
      id: 'mid',
      subject: 'Bunnings order (middle)',
      receivedDateTime: '2026-06-01T00:00:00Z',
    });
    callGraphAPIPaginated.mockResolvedValueOnce({
      value: [older, newest, middle],
    });

    const result = await handleSearchEmails({ query: 'Bunnings' });

    const text = result.content[0].text;
    expect(result._meta.searchMetadata.finalStrategy).toBe('combined-search');
    expect(text.indexOf('(newest)')).toBeLessThan(text.indexOf('(middle)'));
    expect(text.indexOf('(middle)')).toBeLessThan(text.indexOf('(older)'));
    // The order is ours, over the page Graph returned, and says so.
    expect(result._meta.searchMetadata.orderedWithinPage).toBe(true);
    expect(text).toContain('newest first');
  });

  test('applies the date window to the $search page locally', async () => {
    const inWindow = mockEmail({
      id: 'in',
      subject: 'Bunnings receipt in window',
      receivedDateTime: '2026-09-10T00:00:00Z',
    });
    const tooOld = mockEmail({
      id: 'old',
      subject: 'Bunnings receipt too old',
      receivedDateTime: '2025-01-10T00:00:00Z',
    });
    const notUnread = mockEmail({
      id: 'read',
      subject: 'Bunnings receipt already read',
      receivedDateTime: '2026-09-11T00:00:00Z',
      isRead: true,
    });
    callGraphAPIPaginated.mockResolvedValueOnce({
      value: [inWindow, tooOld, notUnread],
    });

    const result = await handleSearchEmails({
      query: 'Bunnings',
      unreadOnly: true,
      receivedAfter: '2026-09-01T00:00:00Z',
    });

    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Bunnings receipt in window');
    const meta = result._meta.searchMetadata;
    expect(meta.finalStrategy).toBe('combined-search');
    expect(meta.droppedFilters).toEqual([]);
    expect(meta.filterApplied).toBe(true);
    expect(meta.clientSideFilters).toEqual(
      expect.arrayContaining(['unreadOnly', 'receivedAfter'])
    );
  });

  test('query with subject sends subject and the window as $filter and matches query locally', async () => {
    callGraphAPIPaginated.mockResolvedValueOnce({
      value: [
        mockEmail({ id: 'q1', subject: 'Bunnings receipt' }),
        mockEmail({ id: 'q2', subject: 'Mitre 10 receipt' }),
      ],
    });

    const result = await handleSearchEmails({
      query: 'Bunnings',
      subject: 'receipt',
      receivedAfter: '2026-01-01T00:00:00Z',
    });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBeUndefined();
    expect(params.$filter).toContain("contains(subject, 'receipt')");
    expect(params.$filter).toContain('receivedDateTime ge');
    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Bunnings receipt');
    expect(result._meta.searchMetadata.clientSideFilters).toEqual(['query']);
  });

  test('falls through to the subject ladder when nothing on the $search page passes the local filters', async () => {
    const tooNew = mockEmail({
      id: 'new',
      subject: 'Bunnings receipt',
      receivedDateTime: '2026-09-10T00:00:00Z',
    });
    const olderMatch = mockEmail({
      id: 'old',
      subject: 'Bunnings receipt 2024',
      receivedDateTime: '2024-05-10T00:00:00Z',
    });
    callGraphAPIPaginated
      // combined $search → only mail newer than the window
      .mockResolvedValueOnce({ value: [tooNew] })
      // single-term-query → subject contains() with the window server-side
      .mockResolvedValueOnce({ value: [olderMatch] });

    const result = await handleSearchEmails({
      query: 'Bunnings',
      receivedBefore: '2025-01-01T00:00:00Z',
    });

    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Bunnings receipt 2024');
    expect(result._meta.searchMetadata.finalStrategy).toBe('single-term-query');
    const [, , , ladderParams] = callGraphAPIPaginated.mock.calls[1];
    expect(ladderParams.$search).toBeUndefined();
    expect(ladderParams.$filter).toContain("contains(subject, 'Bunnings')");
    expect(ladderParams.$filter).toContain('receivedDateTime le');
  });

  test('a structured search without query still goes out as a $filter, never $search', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    await handleSearchEmails({ from: 'john@example.com', subject: 'Test' });

    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$search).toBeUndefined();
    // Sorted since #331, so receivedDateTime leads.
    expect(params.$filter).toBe(
      "receivedDateTime ge 1900-01-01T00:00:00Z and contains(subject, 'Test') and from/emailAddress/address eq 'john@example.com'"
    );
  });
});

// ──────────────────────────────────────────────────
// #328: a `from` value with no `@` and no `.` (a bare domain label such as
// `examplecorp`) is classified as a name. It used to match the display name
// only, so mail from someone@examplecorp.com.au was never found, and the
// no-results text then said nothing in the mailbox matched.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — from with a dotless domain label (#328)', () => {
  /** Evaluate the small $filter grammar search.js emits, over plain rows. */
  function evaluateFilter(filter, m) {
    const fields = {
      subject: m.subject || '',
      'from/emailAddress/name': m.from?.emailAddress?.name || '',
      'from/emailAddress/address': m.from?.emailAddress?.address || '',
    };
    const field = (path) => {
      if (!(path in fields)) throw new Error(`unsupported field: ${path}`);
      return fields[path];
    };
    const atom = (text) => {
      const t = text.trim();
      let match = /^contains\(([\w/]+), '((?:[^']|'')*)'\)$/.exec(t);
      if (match) {
        return field(match[1])
          .toLowerCase()
          .includes(match[2].replace(/''/g, "'").toLowerCase());
      }
      match = /^([\w/]+) eq '((?:[^']|'')*)'$/.exec(t);
      if (match) {
        return (
          field(match[1]).toLowerCase() ===
          match[2].replace(/''/g, "'").toLowerCase()
        );
      }
      match = /^receivedDateTime (ge|le) (\S+)$/.exec(t);
      if (match) {
        const rec = Date.parse(m.receivedDateTime);
        const bound = Date.parse(match[2]);
        return match[1] === 'ge' ? rec >= bound : rec <= bound;
      }
      throw new Error(`unsupported filter clause: ${t}`);
    };
    // Split on top-level ' and ', then ' or ' inside a parenthesised group.
    const conjuncts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < filter.length; i++) {
      if (filter[i] === '(') depth++;
      else if (filter[i] === ')') depth--;
      else if (depth === 0 && filter.startsWith(' and ', i)) {
        conjuncts.push(filter.slice(start, i));
        start = i + 5;
      }
    }
    conjuncts.push(filter.slice(start));
    return conjuncts.every((c) => {
      const t = c.trim();
      if (t.startsWith('(') && t.endsWith(')') && t.includes(' or ')) {
        return t.slice(1, -1).split(' or ').some(atom);
      }
      return atom(t);
    });
  }

  function mockGraphEvaluatingFilters(rows) {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (params.$search) throw new Error('unexpected $search');
      const value = params.$filter
        ? rows.filter((m) => evaluateFilter(params.$filter, m))
        : rows;
      return Promise.resolve({ value });
    });
  }

  const fromCorp = (id, subject, date) =>
    mockEmail({
      id,
      subject,
      receivedDateTime: date,
      from: {
        emailAddress: {
          name: 'Jane Citizen',
          address: 'someone@examplecorp.com.au',
        },
      },
    });
  const rows = [
    fromCorp('c1', 'Quarterly statement', '2026-08-01T00:00:00Z'),
    fromCorp('c2', 'Renewal notice', '2025-02-01T00:00:00Z'),
    mockEmail({
      id: 'o1',
      subject: 'Unrelated newsletter',
      from: { emailAddress: { name: 'News', address: 'news@other.example' } },
    }),
  ];

  test("finds a known sender's mail from a dotless domain label", async () => {
    mockGraphEvaluatingFilters(rows);

    const result = await handleSearchEmails({
      from: 'examplecorp',
      searchAllFolders: true,
      count: 50,
    });

    expect(result._meta.returned).toBe(2);
    const text = result.content[0].text;
    expect(text).toContain('Quarterly statement');
    expect(text).toContain('Renewal notice');
    expect(text).not.toContain('Unrelated newsletter');
    expect(result._meta.searchMetadata.filterApplied).toBe(true);
  });

  test('still finds it with a date window', async () => {
    mockGraphEvaluatingFilters(rows);

    const result = await handleSearchEmails({
      from: 'examplecorp',
      searchAllFolders: true,
      receivedAfter: '2026-01-01T00:00:00Z',
    });

    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Quarterly statement');
  });

  test('still matches a display name', async () => {
    mockGraphEvaluatingFilters(rows);

    const result = await handleSearchEmails({
      from: 'Jane',
      searchAllFolders: true,
    });

    expect(result._meta.returned).toBe(2);
  });

  test('the local from matcher checks the address for a name value too', () => {
    const matched = filterFromClientSide(rows, 'examplecorp');
    expect(matched.map((m) => m.id)).toEqual(['c1', 'c2']);
  });

  test('does not claim the mailbox has no match when only one page was checked', async () => {
    callGraphAPIPaginated
      // combined-search → empty (or rejected on a personal account)
      .mockResolvedValueOnce({ value: [] })
      // single-term-from → a page of this sender's mail, none with the
      // subject, and more beyond it
      .mockResolvedValueOnce({ value: [rows[0], rows[1]], hasMore: true })
      // single-term-subject → empty
      .mockResolvedValueOnce({ value: [] });

    const result = await handleSearchEmails({
      from: 'examplecorp',
      subject: 'Zebra',
      searchAllFolders: true,
      count: 2,
    });

    const text = result.content[0].text;
    expect(result._meta.returned).toBe(0);
    expect(text).not.toContain('no message in this mailbox matches');
    expect(text).toContain('All folders were searched');
  });

  test('keeps the definitive wording when every filter was checked server-side', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      from: 'examplecorp',
      searchAllFolders: true,
    });

    expect(result.content[0].text).toContain(
      'All folders were already searched, so no message in this mailbox matches these filters'
    );
  });
});

// ──────────────────────────────────────────────────
// #329: an untranslated `searchExpression` is sent to Graph `$search` as
// written, with no `$filter`, so `receivedAfter`/`receivedBefore` (and the
// boolean filters) never reach the request. That used to happen silently,
// with `filterApplied: true`. They are now reported as dropped.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — raw searchExpression ignores the date window (#329)', () => {
  const recent = mockEmail({
    id: 'r1',
    subject: 'someterm newsletter',
    receivedDateTime: '2026-09-01T00:00:00Z',
  });

  test('reports receivedBefore as dropped, visibly', async () => {
    callGraphAPIPaginated.mockResolvedValueOnce({ value: [recent] });

    const result = await handleSearchEmails({
      searchExpression: 'someterm',
      receivedBefore: '2023-01-01T00:00:00Z',
      searchAllFolders: true,
    });

    const meta = result._meta.searchMetadata;
    expect(meta.finalStrategy).toBe('raw-kql');
    expect(meta.droppedFilters).toEqual(['receivedBefore']);
    expect(meta.filterApplied).toBe(false);
    const text = result.content[0].text;
    expect(text).toContain('`receivedBefore` was not applied');
    // The request itself is unchanged: $search as written, nothing else.
    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$filter).toBeUndefined();
  });

  test('reports every date and boolean filter it could not apply', async () => {
    callGraphAPIPaginated.mockResolvedValueOnce({ value: [recent] });

    const result = await handleSearchEmails({
      searchExpression: 'someterm',
      receivedAfter: '2026-01-01T00:00:00Z',
      receivedBefore: '2026-12-31T00:00:00Z',
      unreadOnly: true,
      hasAttachments: false,
    });

    expect(result._meta.searchMetadata.droppedFilters).toEqual([
      'receivedAfter',
      'receivedBefore',
      'unreadOnly',
    ]);
  });

  test('says so in the no-results guidance too', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      searchExpression: '"zzzznonexistentterm"',
      receivedAfter: '2026-01-01T00:00:00Z',
    });

    const text = result.content[0].text;
    expect(text).toContain('No emails found');
    expect(text).toContain('`receivedAfter` was not applied');
    expect(result._meta.searchMetadata.droppedFilters).toEqual([
      'receivedAfter',
    ]);
  });

  test('a translated expression still applies the date window (nothing dropped)', async () => {
    callGraphAPIPaginated
      // raw-kql → empty (personal accounts answer field-scoped $search with 0)
      .mockResolvedValueOnce({ value: [] })
      // translated combined-search → a match
      .mockResolvedValueOnce({ value: [mockEmail({ id: 't1' })] });

    const result = await handleSearchEmails({
      searchExpression: 'from:john@example.com',
      receivedAfter: '2026-01-01T00:00:00Z',
    });

    const meta = result._meta.searchMetadata;
    expect(meta.finalStrategy).toBe('raw-kql-translated');
    expect(meta.droppedFilters).toEqual([]);
    const [, , , params] = callGraphAPIPaginated.mock.calls[1];
    expect(params.$filter).toContain('receivedDateTime ge');
  });

  test('without a date window nothing is reported', async () => {
    callGraphAPIPaginated.mockResolvedValueOnce({ value: [recent] });

    const result = await handleSearchEmails({ searchExpression: 'someterm' });

    expect(result._meta.searchMetadata.droppedFilters).toEqual([]);
    expect(result._meta.searchMetadata.filterApplied).toBe(true);
    expect(result.content[0].text).not.toContain('was not applied');
  });
});

// ──────────────────────────────────────────────────
// #261 follow-up (whole-branch review): narrowing one `$search` page and then
// dropping its nextLink lost recall. `query` with `from`/`to`/`subject` now
// uses the structured `$filter` and matches `query` locally; a date or boolean
// window on a `$search` reads further pages (newest first, so it can stop once
// rows are older than `receivedAfter`); and any narrowing that drops rows
// while Graph had more keeps `hasMore` and says coverage was partial.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — narrowing across pages (#261 follow-up)', () => {
  const NEXT = (n) => `https://graph.microsoft.com/v1.0/me/messages?$skip=${n}`;
  const sender = (name) => ({
    emailAddress: { name, address: `${name}@example.com` },
  });
  const day = (d) => new Date(Date.UTC(2026, 9, d)).toISOString();

  test('query with from uses the structured $filter, not $search, and matches query locally', async () => {
    const rows = [
      mockEmail({ id: 'a1', subject: 'Invoice 1', from: sender('acme') }),
      mockEmail({ id: 'a2', subject: 'Newsletter', from: sender('acme') }),
      mockEmail({ id: 'a3', subject: 'Invoice 3', from: sender('acme') }),
    ];
    callGraphAPIPaginated.mockResolvedValueOnce({ value: rows });

    const result = await handleSearchEmails({
      query: 'invoice',
      from: 'acme',
      count: 10,
    });

    const [, , , first] = callGraphAPIPaginated.mock.calls[0];
    expect(first.$search).toBeUndefined();
    expect(first.$filter).toContain(
      "contains(from/emailAddress/address, 'acme')"
    );
    const meta = result._meta.searchMetadata;
    expect(meta.finalStrategy).toBe('combined-search');
    expect(result._meta.returned).toBe(2);
    expect(meta.droppedFilters).toEqual([]);
    expect(meta.clientSideFilters).toEqual(['query']);
    expect(result.content[0].text).toContain('matched locally');
  });

  test('query with from follows nextLink until count matches are found', async () => {
    callGraphAPIPaginated.mockImplementation((tok, m, path) => {
      if (path === NEXT(50)) {
        return {
          value: [
            mockEmail({
              id: 'p2a',
              subject: 'Invoice B',
              from: sender('acme'),
            }),
            mockEmail({
              id: 'p2b',
              subject: 'Invoice C',
              from: sender('acme'),
            }),
          ],
        };
      }
      return {
        value: [
          mockEmail({ id: 'p1a', subject: 'Invoice A', from: sender('acme') }),
          mockEmail({ id: 'p1b', subject: 'Other', from: sender('acme') }),
        ],
        hasMore: true,
        '@odata.nextLink': NEXT(50),
      };
    });

    const result = await handleSearchEmails({
      query: 'invoice',
      from: 'acme',
      count: 3,
    });

    expect(result._meta.returned).toBe(3);
    expect(callGraphAPIPaginated.mock.calls[1][2]).toBe(NEXT(50));
    expect(result._meta.hasMore).toBe(false);
  });

  test('a receivedBefore window straddling the $search page reads the next page', async () => {
    const page1 = Array.from({ length: 5 }, (_, i) =>
      mockEmail({
        id: `n${i}`,
        subject: `invoice new ${i}`,
        receivedDateTime: day(20 - i),
      })
    );
    const page2 = Array.from({ length: 5 }, (_, i) =>
      mockEmail({
        id: `o${i}`,
        subject: `invoice old ${i}`,
        receivedDateTime: day(9 - i),
      })
    );
    callGraphAPIPaginated.mockImplementation((tok, m, path, params) => {
      if (path === NEXT(5)) return { value: page2 };
      if (params && params.$search) {
        return { value: page1, hasMore: true, '@odata.nextLink': NEXT(5) };
      }
      return { value: [] };
    });

    const result = await handleSearchEmails({
      query: 'invoice',
      receivedBefore: day(10),
      count: 3,
    });

    const meta = result._meta.searchMetadata;
    expect(meta.finalStrategy).toBe('combined-search');
    expect(result._meta.returned).toBe(3);
    expect(result.content[0].text).toContain('invoice old 0');
    expect(result.content[0].text).not.toContain('invoice new');
    // The first request asks for full pages, so the window costs few requests.
    expect(callGraphAPIPaginated.mock.calls[0][3].$top).toBe(50);
  });

  test('stops paging once $search rows are older than receivedAfter', async () => {
    callGraphAPIPaginated.mockResolvedValueOnce({
      value: [
        mockEmail({
          id: 'k1',
          subject: 'invoice in',
          receivedDateTime: day(20),
        }),
        mockEmail({
          id: 'k2',
          subject: 'invoice out',
          receivedDateTime: day(2),
        }),
      ],
      hasMore: true,
      '@odata.nextLink': NEXT(2),
    });

    const result = await handleSearchEmails({
      query: 'invoice',
      receivedAfter: day(10),
      count: 10,
    });

    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    expect(result._meta.returned).toBe(1);
    // Everything beyond is older than the window, so nothing more matches.
    expect(result._meta.hasMore).toBe(false);
    expect(result.content[0].text).not.toContain('Partial coverage');
  });

  test('stops at the scan cap, keeps hasMore and says coverage was partial', async () => {
    let n = 0;
    callGraphAPIPaginated.mockImplementation(() => {
      n += 1;
      const value = Array.from({ length: 50 }, (_, i) =>
        mockEmail({
          id: `c${n}-${i}`,
          subject: i === 0 ? 'invoice keep' : 'invoice',
          receivedDateTime: day(25),
          isRead: i !== 0,
        })
      );
      return { value, hasMore: true, '@odata.nextLink': NEXT(n * 50) };
    });

    const result = await handleSearchEmails({
      query: 'invoice',
      unreadOnly: true,
      count: 20,
    });

    expect(callGraphAPIPaginated.mock.calls.length).toBeLessThanOrEqual(5);
    expect(result._meta.returned).toBe(callGraphAPIPaginated.mock.calls.length);
    expect(result._meta.hasMore).toBe(true);
    const meta = result._meta.searchMetadata;
    expect(meta.partialCoverage).toBe(true);
    expect(meta.narrowedCandidates).toBe(
      callGraphAPIPaginated.mock.calls.length * 50
    );
    expect(result.content[0].text).toContain('Partial coverage');
    // Raising count can't read past the cap, so the note mustn't suggest it.
    expect(result.content[0].text).toContain('reads at most 250');
    expect(result.content[0].text).not.toContain('to read further');
  });

  test('a ladder step that narrows a page with more beyond it keeps hasMore', async () => {
    callGraphAPIPaginated
      // combined (structured, with `to`) rejected, as on personal accounts
      .mockRejectedValueOnce(new Error('400 ErrorInvalidProperty'))
      // single-term-to returns a page with more beyond it
      .mockResolvedValueOnce({
        value: [
          mockEmail({ id: 't1', subject: 'Invoice 1' }),
          mockEmail({ id: 't2', subject: 'Lunch' }),
        ],
        hasMore: true,
        '@odata.nextLink': NEXT(2),
      });

    const result = await handleSearchEmails({
      query: 'invoice',
      to: 'jane@example.com',
    });

    expect(result._meta.searchMetadata.finalStrategy).toBe('single-term-to');
    expect(result._meta.returned).toBe(1);
    expect(result._meta.hasMore).toBe(true);
    expect(result._meta.searchMetadata.partialCoverage).toBe(true);
    expect(result.content[0].text).toContain('Partial coverage');
  });

  test('the more-available footer for a $search result suggests count, not the date parameters', async () => {
    callGraphAPIPaginated.mockResolvedValueOnce({
      value: [mockEmail({ id: 'f1', subject: 'invoice' })],
      hasMore: true,
      '@odata.nextLink': NEXT(1),
    });

    const result = await handleSearchEmails({ query: 'invoice', count: 1 });

    const text = result.content[0].text;
    expect(result._meta.hasMore).toBe(true);
    expect(text).toContain('raise `count`');
    expect(text).not.toContain('receivedBefore');
  });
});

// ──────────────────────────────────────────────────
// #331: Graph allows `$orderby=receivedDateTime desc` next to a `$filter` only
// when `receivedDateTime` leads the filter. The combined step sent
// `contains(subject, …)` first, so every `subject` search without `from`/`to`
// cost one `400 InefficientFilter` on personal accounts before the ladder
// answered from `single-term-subject` (which sends no `$orderby`, so Graph
// returns the oldest matches first).
// ──────────────────────────────────────────────────
describe('handleSearchEmails — receivedDateTime leads a sorted $filter (#331)', () => {
  const EARLIEST = 'receivedDateTime ge 1900-01-01T00:00:00Z';

  /** Graph's rule, as measured on a personal mailbox. */
  function mockGraphEnforcingSortRule(rows) {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (
        params.$orderby &&
        params.$filter &&
        !params.$filter.startsWith('receivedDateTime ')
      ) {
        return Promise.reject(
          new Error(
            'API call failed with status 400: {"error":{"code":"InefficientFilter","message":"The restriction or sort order is too complex for this operation."}}'
          )
        );
      }
      if (params.$filter && params.$filter.includes('toRecipients/any(')) {
        return Promise.reject(
          new Error(
            'API call failed with status 400: {"error":{"code":"ErrorInvalidUrlQueryFilter"}}'
          )
        );
      }
      return Promise.resolve({ value: rows });
    });
  }

  const sentParams = () => callGraphAPIPaginated.mock.calls.map((c) => c[3]);
  const rows = [
    mockEmail({
      id: 's1',
      subject: 'Reset your password',
      bodyPreview: 'reset link inside',
    }),
  ];

  test.each([
    [{ subject: 'password' }],
    [{ subject: 'password', receivedAfter: '2026-01-01T00:00:00Z' }],
    [{ subject: 'password', receivedBefore: '2026-01-01T00:00:00Z' }],
    [
      {
        subject: 'password',
        receivedAfter: '2025-01-01T00:00:00Z',
        receivedBefore: '2026-01-01T00:00:00Z',
      },
    ],
    [{ subject: 'password', unreadOnly: true }],
    [{ subject: 'password', hasAttachments: true }],
    [{ subject: 'password', hasAttachments: true, unreadOnly: true }],
    [{ query: 'reset', subject: 'password' }],
    [{ query: 'reset', subject: 'password', unreadOnly: true }],
    [{ from: 'john', subject: 'password' }],
    [{ from: 'john@example.com' }],
    [{ from: 'example.com', receivedAfter: '2026-01-01T00:00:00Z' }],
    [{ to: 'jane', subject: 'password' }],
    [{ query: 'reset', from: 'john', subject: 'password' }],
    [{ receivedAfter: '2026-01-01T00:00:00Z' }],
    [{ hasAttachments: true, receivedAfter: '2026-01-01T00:00:00Z' }],
    [{ unreadOnly: true }],
    [{}],
  ])(
    'no request sorts a $filter that receivedDateTime does not lead: %j',
    async (args) => {
      mockGraphEnforcingSortRule(rows);

      await handleSearchEmails(args);

      for (const params of sentParams()) {
        if (params.$orderby && params.$filter) {
          expect(params.$filter).toMatch(/^receivedDateTime ge /);
        }
      }
    }
  );

  test.each([
    [{ subject: 'password' }],
    [{ query: 'reset', subject: 'password' }],
    [{ from: 'john', subject: 'password' }],
    [{ subject: 'password', unreadOnly: true }],
    [{ subject: 'password', receivedBefore: '2027-01-01T00:00:00Z' }],
  ])('the combined step answers in one request: %j', async (args) => {
    mockGraphEnforcingSortRule(rows);

    const result = await handleSearchEmails(args);

    expect(result._meta.searchMetadata.strategiesAttempted).toEqual([
      'combined-search',
    ]);
    expect(result._meta.searchMetadata.finalStrategy).toBe('combined-search');
    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    expect(result._meta.returned).toBe(1);
  });

  test('subject only: an always-true lower bound stands in for a missing receivedAfter', async () => {
    mockGraphEnforcingSortRule(rows);

    await handleSearchEmails({ subject: "it's here" });

    const [params] = sentParams();
    expect(params.$filter).toBe(
      `${EARLIEST} and contains(subject, 'it''s here')`
    );
    expect(params.$orderby).toBe('receivedDateTime desc');
    expect(params.$search).toBeUndefined();
  });

  test('the caller’s window replaces the stand-in and stays first, before the other clauses', async () => {
    mockGraphEnforcingSortRule(rows);

    await handleSearchEmails({
      subject: 'password',
      hasAttachments: true,
      unreadOnly: true,
      receivedAfter: '2025-01-01T00:00:00Z',
      receivedBefore: '2026-01-01T00:00:00Z',
    });

    const [params] = sentParams();
    expect(params.$filter).toBe(
      'receivedDateTime ge 2025-01-01T00:00:00.000Z and receivedDateTime le 2026-01-01T00:00:00.000Z' +
        " and contains(subject, 'password') and hasAttachments eq true and isRead eq false"
    );
    expect(params.$orderby).toBe('receivedDateTime desc');
  });

  test('receivedBefore alone still gets the leading lower bound', async () => {
    mockGraphEnforcingSortRule(rows);

    await handleSearchEmails({
      subject: 'password',
      receivedBefore: '2026-01-01T00:00:00Z',
    });

    expect(sentParams()[0].$filter).toBe(
      `${EARLIEST} and receivedDateTime le 2026-01-01T00:00:00.000Z and contains(subject, 'password')`
    );
  });

  test('query + subject sends the same date-first structured filter', async () => {
    mockGraphEnforcingSortRule(rows);

    await handleSearchEmails({ query: 'reset', subject: 'password' });

    const [params] = sentParams();
    expect(params.$search).toBeUndefined();
    expect(params.$filter).toBe(
      `${EARLIEST} and contains(subject, 'password')`
    );
    expect(params.$orderby).toBe('receivedDateTime desc');
  });

  // Follow-on: every other shape that went out unsorted came back oldest
  // first on a personal mailbox, so a search with more matches than `count`
  // returned the oldest ones.
  test.each([
    [
      { from: 'john@example.com' },
      `${EARLIEST} and from/emailAddress/address eq 'john@example.com'`,
    ],
    [
      { from: 'example.com' },
      `${EARLIEST} and contains(from/emailAddress/address, 'example.com')`,
    ],
    [
      { from: 'john' },
      `${EARLIEST} and (contains(from/emailAddress/name, 'john') or contains(from/emailAddress/address, 'john'))`,
    ],
    [
      { from: 'john@example.com', subject: 'password' },
      `${EARLIEST} and contains(subject, 'password') and from/emailAddress/address eq 'john@example.com'`,
    ],
    [
      {
        from: 'john@example.com',
        unreadOnly: true,
        receivedAfter: '2026-01-01T00:00:00Z',
      },
      "receivedDateTime ge 2026-01-01T00:00:00.000Z and from/emailAddress/address eq 'john@example.com' and isRead eq false",
    ],
  ])(
    'a from filter is sorted, receivedDateTime first: %j',
    async (args, filter) => {
      mockGraphEnforcingSortRule(rows);

      const result = await handleSearchEmails(args);

      const [params] = sentParams();
      expect(params.$filter).toBe(filter);
      expect(params.$orderby).toBe('receivedDateTime desc');
      expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
      expect(result._meta.searchMetadata.finalStrategy).toBe('combined-search');
    }
  );

  test('a to filter stays unsorted, with the clause order it had (control)', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: rows });

    await handleSearchEmails({
      to: 'jane@example.com',
      from: 'john@example.com',
      receivedAfter: '2026-01-01T00:00:00Z',
    });

    const [params] = sentParams();
    expect(params.$orderby).toBeUndefined();
    expect(params.$filter).toBe(
      "from/emailAddress/address eq 'john@example.com' and toRecipients/any(r: r/emailAddress/address eq 'jane@example.com') and receivedDateTime ge 2026-01-01T00:00:00.000Z"
    );
  });

  test.each([
    [{ unreadOnly: true }, `${EARLIEST} and isRead eq false`],
    [{ hasAttachments: true }, `${EARLIEST} and hasAttachments eq true`],
    [
      { hasAttachments: true, unreadOnly: true },
      `${EARLIEST} and hasAttachments eq true and isRead eq false`,
    ],
    [
      { hasAttachments: true, receivedAfter: '2026-09-01T00:00:00Z' },
      'receivedDateTime ge 2026-09-01T00:00:00.000Z and hasAttachments eq true',
    ],
    [
      { unreadOnly: true, receivedBefore: '2026-09-01T00:00:00Z' },
      `${EARLIEST} and receivedDateTime le 2026-09-01T00:00:00.000Z and isRead eq false`,
    ],
  ])(
    'a boolean-only search is sorted, receivedDateTime first: %j',
    async (args, filter) => {
      mockGraphEnforcingSortRule(rows);

      const result = await handleSearchEmails(args);

      expect(sentParams()).toHaveLength(1);
      const [params] = sentParams();
      expect(params.$filter).toBe(filter);
      expect(params.$orderby).toBe('receivedDateTime desc');
      expect(result._meta.searchMetadata.finalStrategy).toBe(
        'boolean-filters-only'
      );
      expect(result._meta.returned).toBe(1);
    }
  );

  test('the boolean step after an unmatched search term is sorted too', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      Promise.resolve({
        value: params.$filter.includes('contains(subject') ? [] : rows,
      })
    );

    await handleSearchEmails({ subject: 'password', unreadOnly: true });

    const last = sentParams().at(-1);
    expect(last.$filter).toBe(`${EARLIEST} and isRead eq false`);
    expect(last.$orderby).toBe('receivedDateTime desc');
  });

  test('if Graph refuses the sorted boolean filter, it is retried unsorted', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      params.$orderby
        ? Promise.reject(
            new Error(
              'API call failed with status 400: {"error":{"code":"InefficientFilter"}}'
            )
          )
        : Promise.resolve({ value: rows })
    );

    const result = await handleSearchEmails({ unreadOnly: true });

    const params = sentParams();
    expect(params).toHaveLength(2);
    expect(params[1].$orderby).toBeUndefined();
    expect(params[1].$filter).toBe('isRead eq false');
    expect(result._meta.returned).toBe(1);
  });

  test('a plain listing sends $orderby with no $filter at all (control)', async () => {
    mockGraphEnforcingSortRule(rows);

    await handleSearchEmails({});

    const [params] = sentParams();
    expect(params.$filter).toBeUndefined();
    expect(params.$orderby).toBe('receivedDateTime desc');
  });
});

// ──────────────────────────────────────────────────
// #332: the same defect as #328, for `to`. A value with no `@` and no dot
// (`examplecorp`) went out as a display-name match only, so where Graph accepts
// the `toRecipients/any()` lambda (Microsoft 365) mail to
// `someone@examplecorp.com.au` was not matched server-side. Personal accounts
// reject the lambda and use the local matcher, which already checks both.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — to with a dotless domain label (#332)', () => {
  const strip = (v) => v.replace(/''/g, "'").toLowerCase();

  /** One clause inside or outside the lambda, against `fields`. */
  function evaluateAtom(text, fields) {
    const t = text.trim();
    let match = /^contains\(([\w/]+), '((?:[^']|'')*)'\)$/.exec(t);
    if (match) {
      if (!(match[1] in fields)) throw new Error(`unsupported: ${match[1]}`);
      return fields[match[1]].toLowerCase().includes(strip(match[2]));
    }
    match = /^([\w/]+) eq '((?:[^']|'')*)'$/.exec(t);
    if (match) {
      if (!(match[1] in fields)) throw new Error(`unsupported: ${match[1]}`);
      return fields[match[1]].toLowerCase() === strip(match[2]);
    }
    throw new Error(`unsupported filter clause: ${t}`);
  }

  /** Evaluate the `to` filters search.js emits (AND of clauses), over a row. */
  function evaluateFilter(filter, m) {
    return filter.split(/ and (?![^(]*\))/).every((clause) => {
      const c = clause.trim();
      const date = /^receivedDateTime (ge|le) (\S+)$/.exec(c);
      if (date) {
        const rec = Date.parse(m.receivedDateTime);
        return date[1] === 'ge'
          ? rec >= Date.parse(date[2])
          : rec <= Date.parse(date[2]);
      }
      const lambda = /^toRecipients\/any\(r: (.*)\)$/.exec(c);
      if (lambda) {
        return (m.toRecipients || []).some((r) =>
          lambda[1].split(' or ').some((atom) =>
            evaluateAtom(atom, {
              'r/emailAddress/name': r.emailAddress?.name || '',
              'r/emailAddress/address': r.emailAddress?.address || '',
            })
          )
        );
      }
      return evaluateAtom(c, { subject: m.subject || '' });
    });
  }

  /** A mailbox where Graph accepts the lambda, as Microsoft 365 does. */
  function mockGraphEvaluatingFilters(rows) {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (params.$search) throw new Error('unexpected $search');
      const value = params.$filter
        ? rows.filter((m) => evaluateFilter(params.$filter, m))
        : rows;
      return Promise.resolve({ value });
    });
  }

  const toCorp = (id, subject, date) =>
    mockEmail({
      id,
      subject,
      receivedDateTime: date,
      toRecipients: [
        {
          emailAddress: { name: 'Sam Lee', address: 'other@elsewhere.example' },
        },
        {
          emailAddress: {
            name: 'Jane Citizen',
            address: 'someone@examplecorp.com.au',
          },
        },
      ],
    });
  const rows = [
    toCorp('c1', 'Quarterly statement', '2026-08-01T00:00:00Z'),
    toCorp('c2', 'Renewal notice', '2025-02-01T00:00:00Z'),
    mockEmail({ id: 'o1', subject: 'Unrelated newsletter' }),
  ];

  test('finds mail to a recipient from a dotless domain label, server-side', async () => {
    mockGraphEvaluatingFilters(rows);

    const result = await handleSearchEmails({
      to: 'examplecorp',
      searchAllFolders: true,
      count: 50,
    });

    expect(result._meta.returned).toBe(2);
    const text = result.content[0].text;
    expect(text).toContain('Quarterly statement');
    expect(text).toContain('Renewal notice');
    expect(text).not.toContain('Unrelated newsletter');
    expect(result._meta.searchMetadata.finalStrategy).toBe('combined-search');
    expect(result._meta.searchMetadata.filterApplied).toBe(true);
    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
  });

  test('still finds it with a date window and a subject', async () => {
    mockGraphEvaluatingFilters(rows);

    const result = await handleSearchEmails({
      to: 'examplecorp',
      subject: 'statement',
      searchAllFolders: true,
      receivedAfter: '2026-01-01T00:00:00Z',
    });

    expect(result._meta.returned).toBe(1);
    expect(result.content[0].text).toContain('Quarterly statement');
    expect(result._meta.searchMetadata.finalStrategy).toBe('combined-search');
  });

  test('still matches a display name', async () => {
    mockGraphEvaluatingFilters(rows);

    const result = await handleSearchEmails({
      to: 'Jane',
      searchAllFolders: true,
    });

    expect(result._meta.returned).toBe(3); // Jane Citizen ×2, Jane Smith ×1
  });

  test('the name-or-address test sits inside the lambda, so one recipient must satisfy it', () => {
    expect(buildToFilter('examplecorp')).toBe(
      "toRecipients/any(r: contains(r/emailAddress/name, 'examplecorp') or contains(r/emailAddress/address, 'examplecorp'))"
    );
  });

  test('the server-side filter and the local matcher agree on every row', () => {
    for (const value of ['examplecorp', 'Jane', 'citizen', 'elsewhere']) {
      const server = rows
        .filter((m) => evaluateFilter(buildToFilter(value), m))
        .map((m) => m.id);
      const local = filterToClientSide(rows, value).map((m) => m.id);
      expect(local).toEqual(server);
    }
  });

  test('personal accounts: the rejected lambda still falls to the local matcher, which finds it', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (params.$filter && params.$filter.includes('toRecipients/any(')) {
        return Promise.reject(
          new Error(
            'API call failed with status 400: {"error":{"code":"ErrorInvalidUrlQueryFilter"}}'
          )
        );
      }
      return Promise.resolve({ value: rows });
    });

    const result = await handleSearchEmails({
      to: 'examplecorp',
      searchAllFolders: true,
    });

    expect(result._meta.returned).toBe(2);
    expect(result._meta.searchMetadata.finalStrategy).toBe('client-side-to');
  });

  test('no match: definitive wording when the whole mailbox was checked', async () => {
    mockGraphEvaluatingFilters(rows);

    const result = await handleSearchEmails({
      to: 'zebracorp',
      searchAllFolders: true,
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).toContain(
      'All folders were already searched, so no message in this mailbox matches these filters'
    );
  });

  test('no match after a scan that hit its limit: says a match may still exist', async () => {
    const page = Array.from({ length: 500 }, (_, i) =>
      mockEmail({ id: `p${i}`, subject: `Mail ${i}` })
    );
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      Promise.resolve(
        params.$filter
          ? { value: [] }
          : {
              value: page,
              '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next',
            }
      )
    );

    const result = await handleSearchEmails({
      to: 'zebracorp',
      searchAllFolders: true,
    });

    const text = result.content[0].text;
    expect(result._meta.returned).toBe(0);
    expect(text).not.toContain('no message in this mailbox matches');
    expect(text).toContain('so a match may still exist');
  });
});

// ──────────────────────────────────────────────────
// #333: a `searchExpression` goes to Graph `$search` as one double-quoted
// string, unless it is made only of `from:`/`to:`/`subject:` terms: those
// keep the v3.14.1 sequence (as written, then OData filters). Quoted, that Measured on a personal mailbox, that is the only form Graph reads as
// KQL: unquoted `from:x` or `received>=…` is a 400 syntax error, and an
// unquoted multi-word expression (`invoice OR receipt`) is answered with the
// newest mail, unfiltered. The translation to OData filters (#217) stays as
// the fallback when the quoted expression is rejected or finds nothing.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — whole-quoted searchExpression (#333)', () => {
  const NEWEST = [
    mockEmail({ id: 'n1', subject: 'Newest unrelated' }),
    mockEmail({ id: 'n2', subject: 'Second newest unrelated' }),
  ];
  const HIT = mockEmail({ id: 'h1', subject: 'Invoice 42' });

  /**
   * Graph as measured: KQL only inside one pair of quotes. Unquoted with `:`,
   * `<`, `>` or `=` → 400; unquoted multi-word → the newest mail, unfiltered.
   */
  function mockGraphReadingOnlyQuotedKql(quotedResult = [HIT]) {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      const search = params.$search;
      if (search === undefined) return Promise.resolve({ value: [HIT] });
      if (params.$filter || params.$orderby) {
        return Promise.reject(
          new Error('API call failed with status 400: SearchWithFilter')
        );
      }
      const quoted =
        search.length >= 2 && search.startsWith('"') && search.endsWith('"');
      const inner = quoted ? search.slice(1, -1) : '';
      if (quoted && !/(^|[^\\])"/.test(inner)) {
        return Promise.resolve({ value: quotedResult });
      }
      if (/[:<>=]/.test(search) || quoted) {
        return Promise.reject(
          new Error(
            'API call failed with status 400: {"error":{"code":"BadRequest","message":"Syntax error: character \':\' is not valid"}}'
          )
        );
      }
      return Promise.resolve({ value: NEWEST });
    });
  }

  const searches = () =>
    callGraphAPIPaginated.mock.calls.map((c) => c[3].$search).filter(Boolean);

  test.each([
    [
      'from:example.com AND subject:invoice',
      '"from:example.com AND subject:invoice"',
    ],
    [
      'from:example.com received>=2026-01-01',
      '"from:example.com received>=2026-01-01"',
    ],
    ['from:exam*', '"from:exam*"'],
    ['received>=2026-01-01', '"received>=2026-01-01"'],
    ['invoice AND received<2023-01-01', '"invoice AND received<2023-01-01"'],
    ['invoice OR receipt', '"invoice OR receipt"'],
    ['hasattachment:true', '"hasattachment:true"'],
    ['budget approval', '"budget approval"'],
    ['invoice', '"invoice"'],
    ['body:"reset your password"', '"body:\\"reset your password\\""'],
    ['subject:"say \\"hi\\""', '"subject:\\"say \\\\\\"hi\\\\\\"\\""'],
    ['"invoice" OR "receipt"', '"\\"invoice\\" OR \\"receipt\\""'],
    [
      '"from:example.com AND subject:invoice"',
      '"from:example.com AND subject:invoice"',
    ],
    ['"subject:\\"a b\\""', '"subject:\\"a b\\""'],
  ])(
    '%s is sent as %s and answered by raw-kql in one request',
    async (expression, sent) => {
      mockGraphReadingOnlyQuotedKql();

      const result = await handleSearchEmails({ searchExpression: expression });

      expect(searches()).toEqual([sent]);
      expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
      expect(result._meta.returned).toBe(1);
      expect(result.content[0].text).toContain('Invoice 42');
      expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
      expect(result._meta.searchMetadata.strategiesAttempted).toEqual([
        'raw-kql',
      ]);
      expect(result._meta.searchMetadata.kqlTranslatedTo).toBeUndefined();
    }
  );

  // Pure field-scoped expressions keep v3.14.1's requests and results: a
  // patch release must not swap their substring, every-folder filter answer
  // for `$search` word matching. Revisit after the Microsoft 365 matrix.
  test.each([
    ['from:example.com', { from: 'example.com' }],
    ['to:jane@example.com', { to: 'jane@example.com' }],
    ['subject:invoice', { subject: 'invoice' }],
    ['subject:"reset your password"', { subject: 'reset your password' }],
    [
      'from:example.com subject:invoice',
      { from: 'example.com', subject: 'invoice' },
    ],
  ])(
    '%s is sent as written, then answered by the translated filters',
    async (expression, translated) => {
      mockGraphReadingOnlyQuotedKql();

      const result = await handleSearchEmails({ searchExpression: expression });

      expect(searches()).toEqual([expression]);
      const meta = result._meta.searchMetadata;
      expect(meta.strategiesAttempted.slice(0, 2)).toEqual([
        'raw-kql',
        'raw-kql-error',
      ]);
      expect(meta.finalStrategy).toBe('raw-kql-translated');
      expect(meta.kqlTranslatedTo).toEqual(translated);
      expect(result._meta.returned).toBe(1);
    }
  );

  test('a pure field-scoped expression has its date and boolean params applied by the filters', async () => {
    mockGraphReadingOnlyQuotedKql();

    const result = await handleSearchEmails({
      searchExpression: 'from:example.com',
      receivedAfter: '2026-01-01T00:00:00Z',
      unreadOnly: true,
    });

    const meta = result._meta.searchMetadata;
    expect(meta.finalStrategy).toBe('raw-kql-translated');
    expect(meta.droppedFilters).toEqual([]);
    expect(meta.filterApplied).toBe(true);
    const filters = callGraphAPIPaginated.mock.calls
      .map((c) => c[3].$filter)
      .filter(Boolean);
    expect(filters[0]).toContain(
      'receivedDateTime ge 2026-01-01T00:00:00.000Z'
    );
    expect(filters[0]).toContain('isRead eq false');
    expect(result.content[0].text).not.toContain('was not applied');
  });

  test('where Graph answers the unquoted field scope itself, the params are reported as not applied (#329)', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [HIT] });

    const result = await handleSearchEmails({
      searchExpression: 'from:example.com',
      receivedAfter: '2026-01-01T00:00:00Z',
    });

    expect(searches()).toEqual(['from:example.com']);
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
    expect(result._meta.searchMetadata.droppedFilters).toEqual([
      'receivedAfter',
    ]);
  });

  test('a multi-word expression no longer comes back as unfiltered recent mail', async () => {
    mockGraphReadingOnlyQuotedKql([]);

    const result = await handleSearchEmails({
      searchExpression: 'zzzqqq OR yyywww',
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).not.toContain('Newest unrelated');
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
  });

  test('the request carries $search alone: no $filter, no $orderby', async () => {
    mockGraphReadingOnlyQuotedKql();

    await handleSearchEmails({
      searchExpression: 'invoice OR receipt',
      receivedAfter: '2026-01-01T00:00:00Z',
      unreadOnly: true,
    });

    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    const [, , , params] = callGraphAPIPaginated.mock.calls[0];
    expect(params.$filter).toBeUndefined();
    expect(params.$orderby).toBeUndefined();
  });

  test('the date window is reported as not applied on the quoted path (#329)', async () => {
    mockGraphReadingOnlyQuotedKql();

    const result = await handleSearchEmails({
      searchExpression: 'from:example.com AND invoice',
      receivedBefore: '2023-01-01T00:00:00Z',
    });

    const meta = result._meta.searchMetadata;
    expect(meta.finalStrategy).toBe('raw-kql');
    expect(meta.droppedFilters).toEqual(['receivedBefore']);
    expect(meta.filterApplied).toBe(false);
    const text = result.content[0].text;
    expect(text).toContain('`receivedBefore` was not applied');
    // The advice no longer asks the caller to quote anything.
    expect(text).toContain('`invoice AND received>=2026-01-01`');
    expect(text).not.toContain('quoted as a whole');
  });

  test('a field-scoped expression Graph rejects is translated, and says so', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      params.$search
        ? Promise.reject(
            new Error('API call failed with status 400: BadRequest')
          )
        : Promise.resolve({ value: [HIT] })
    );

    const result = await handleSearchEmails({
      searchExpression: 'from:example.com',
      receivedAfter: '2026-01-01T00:00:00Z',
    });

    const meta = result._meta.searchMetadata;
    expect(searches()).toEqual(['from:example.com']);
    expect(meta.finalStrategy).toBe('raw-kql-translated');
    expect(meta.strategiesAttempted[0]).toBe('raw-kql');
    expect(meta.kqlTranslatedTo).toEqual({ from: 'example.com' });
    // The translated filters do take the window, so nothing is dropped.
    expect(meta.droppedFilters).toEqual([]);
    const filters = callGraphAPIPaginated.mock.calls
      .map((c) => c[3].$filter)
      .filter(Boolean);
    expect(filters[0]).toContain(
      'receivedDateTime ge 2026-01-01T00:00:00.000Z'
    );
  });

  test('a field-scoped expression that finds nothing is still translated', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      Promise.resolve({ value: params.$search ? [] : [HIT] })
    );

    const result = await handleSearchEmails({
      searchExpression: 'subject:"Invoice 42"',
      searchAllFolders: true,
    });

    expect(searches()).toEqual(['subject:"Invoice 42"']);
    expect(result._meta.returned).toBe(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe(
      'raw-kql-translated'
    );
  });

  test('an already-quoted field-scoped expression gets the same translated retry', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      Promise.resolve({ value: params.$search ? [] : [HIT] })
    );

    const result = await handleSearchEmails({
      searchExpression: '"subject:\\"Invoice 42\\" from:example.com"',
    });

    expect(searches()).toEqual(['"subject:\\"Invoice 42\\" from:example.com"']);
    expect(result._meta.searchMetadata.finalStrategy).toBe(
      'raw-kql-translated'
    );
    expect(result._meta.searchMetadata.kqlTranslatedTo).toEqual({
      subject: 'Invoice 42',
      from: 'example.com',
    });
  });

  test('a quoted plain phrase is not mistaken for a field-scoped expression', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      searchExpression: '"personal access token"',
    });

    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
  });

  // `$search` across all folders leaves out Deleted Items and Junk Email, so
  // an empty `$search` answer is not proof that nothing in the mailbox matches.
  test('no results from $search alone: does not claim the whole mailbox was checked', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      searchExpression: 'invoice AND received<2023-01-01',
      searchAllFolders: true,
    });

    const text = result.content[0].text;
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
    expect(text).not.toContain('no message in this mailbox matches');
    expect(text).toContain(
      'Graph `$search` across all folders leaves out Deleted Items and Junk Email, so a match may still exist there'
    );
  });

  test('no results after the translated filters ran: the definitive wording stays', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      params.$search
        ? Promise.reject(
            new Error('API call failed with status 400: BadRequest')
          )
        : Promise.resolve({ value: [] })
    );

    const result = await handleSearchEmails({
      searchExpression: 'from:example.com',
      searchAllFolders: true,
    });

    expect(result._meta.searchMetadata.finalStrategy).toBe(
      'raw-kql-translated'
    );
    expect(result.content[0].text).toContain(
      'All folders were already searched, so no message in this mailbox matches these filters'
    );
  });

  test('an expression that cannot be translated still ends with no results, not other mail', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      searchExpression: 'from:a@example.com OR from:b@example.com',
    });

    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    expect(result._meta.returned).toBe(0);
    expect(result._meta.searchMetadata.finalStrategy).toBe('raw-kql');
  });
});

// ──────────────────────────────────────────────────
// A translated `to:` expression is matched locally wherever Graph rejects the
// recipient filter, and so is any `to`/`query` term the ladder narrows by. The
// request must therefore ask for the fields those matchers read. The
// `searchExpression` path asked for the lean `list` preset, so with a date
// window `to:x` matched nothing at minimal and standard verbosity (#333).
// ──────────────────────────────────────────────────
describe('handleSearchEmails — locally matched fields are always requested', () => {
  const toJane = (id, date, extra = {}) =>
    mockEmail({
      id,
      subject: `Mail ${id}`,
      receivedDateTime: date,
      toRecipients: [
        { emailAddress: { name: 'Jane Smith', address: 'jane@example.com' } },
      ],
      ...extra,
    });
  const mailbox = [
    toJane('j1', '2026-09-10T00:00:00Z'),
    { ...toJane('j2', '2026-09-20T00:00:00Z'), hasAttachments: true },
    mockEmail({
      id: 'o1',
      subject: 'Someone else',
      receivedDateTime: '2026-09-15T00:00:00Z',
      toRecipients: [
        { emailAddress: { name: 'Sam Lee', address: 'sam@example.com' } },
      ],
    }),
  ];

  const recent = [
    mockEmail({
      id: 'r1',
      subject: 'Newer mail',
      receivedDateTime: '2026-10-09T00:00:00Z',
      toRecipients: [
        { emailAddress: { name: 'Sam Lee', address: 'sam@example.com' } },
      ],
    }),
  ];

  /**
   * A personal mailbox: no unquoted field scope in `$search`, no recipient
   * lambda, and (the point of this block) only the selected fields come back.
   */
  function mockPersonalGraphHonouringSelect() {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (params.$search && /:/.test(params.$search)) {
        return Promise.reject(
          new Error('API call failed with status 400: BadRequest')
        );
      }
      if ((params.$filter || '').includes('toRecipients/any(')) {
        return Promise.reject(
          new Error(
            'API call failed with status 400: ErrorInvalidUrlQueryFilter'
          )
        );
      }
      const fields = params.$select.split(',');
      // The unfiltered recent scan sees only newer mail, as on a mailbox with
      // more than 500 messages since the window.
      const rows = params.$filter || params.$search ? mailbox : recent;
      const value = rows.map((m) =>
        Object.fromEntries(fields.filter((f) => f in m).map((f) => [f, m[f]]))
      );
      return Promise.resolve({ value });
    });
  }

  test.each([['minimal'], ['standard'], ['full'], [undefined]])(
    'searchExpression to: with a date window finds the mail at %s verbosity',
    async (outputVerbosity) => {
      mockPersonalGraphHonouringSelect();

      const result = await handleSearchEmails({
        searchExpression: 'to:jane',
        receivedAfter: '2026-09-01T00:00:00Z',
        receivedBefore: '2026-09-30T00:00:00Z',
        searchAllFolders: true,
        ...(outputVerbosity && { outputVerbosity }),
      });

      expect(result._meta.returned).toBe(2);
      expect(result._meta.searchMetadata.finalStrategy).toBe(
        'raw-kql-translated'
      );
    }
  );

  test('the same search through the to parameter agrees', async () => {
    mockPersonalGraphHonouringSelect();

    const result = await handleSearchEmails({
      to: 'jane',
      receivedAfter: '2026-09-01T00:00:00Z',
      receivedBefore: '2026-09-30T00:00:00Z',
      searchAllFolders: true,
      outputVerbosity: 'minimal',
    });

    expect(result._meta.returned).toBe(2);
  });

  test.each([
    [{ searchExpression: 'to:jane' }],
    [{ searchExpression: 'from:john to:jane' }],
    [{ searchExpression: 'invoice OR receipt' }],
    [{ searchExpression: 'hasattachment:true' }],
    [{ to: 'jane' }],
    [{ query: 'mail' }],
    [{ from: 'john', subject: 'mail' }],
    [{ to: 'jane', unreadOnly: true }],
  ])(
    'every request asks for the fields the local matchers and the list read: %j',
    async (args) => {
      mockPersonalGraphHonouringSelect();

      await handleSearchEmails({ ...args, outputVerbosity: 'minimal' });

      for (const [, , , params] of callGraphAPIPaginated.mock.calls) {
        const fields = params.$select.split(',');
        expect(fields).toEqual(
          expect.arrayContaining([
            'toRecipients',
            'bodyPreview',
            'from',
            'subject',
            'hasAttachments',
          ])
        );
      }
    }
  );

  test('a searchExpression result shows the attachment marker', async () => {
    mockPersonalGraphHonouringSelect();

    const result = await handleSearchEmails({
      searchExpression: 'invoice OR receipt',
    });

    expect(result.content[0].text).toContain('📎');
  });
});

// ──────────────────────────────────────────────────
// #261 follow-up from the live test: a `query` with a window older than what
// Graph `$search` paging returns (it stops near 275 rows; we read 250) was
// answered by the subject-only fallback, 50 matches in no date order, with
// nothing saying the `$search` results never reached the window.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — a window beyond $search paging (#261)', () => {
  const NEXT = (n) => `https://graph.microsoft.com/v1.0/me/messages?$skip=${n}`;
  const recentPage = (n) => ({
    value: Array.from({ length: 50 }, (_, i) =>
      mockEmail({
        id: `s${n}-${i}`,
        subject: 'Invoice (recent)',
        receivedDateTime: '2026-06-01T00:00:00Z',
      })
    ),
    '@odata.nextLink': NEXT(n + 50),
  });
  const old = (id, date) =>
    mockEmail({ id, subject: `Invoice ${id}`, receivedDateTime: date });
  // Deliberately not in date order.
  const subjectMatches = [
    old('a', '2021-03-01T00:00:00Z'),
    old('b', '2025-09-01T00:00:00Z'),
    old('c', '2018-05-01T00:00:00Z'),
  ];
  const args = {
    query: 'invoice',
    searchAllFolders: true,
    receivedBefore: '2025-10-01T00:00:00Z',
    count: 50,
  };

  function mockSearchStreamNewerThanWindow({ refuseSort = false } = {}) {
    let page = 0;
    callGraphAPIPaginated.mockImplementation((_t, _m, endpoint, params) => {
      if (params.$search || String(endpoint).startsWith('https://')) {
        page += 50;
        return Promise.resolve(recentPage(page));
      }
      if (refuseSort && params.$orderby) {
        return Promise.reject(
          new Error(
            'API call failed with status 400: {"error":{"code":"InefficientFilter"}}'
          )
        );
      }
      return Promise.resolve({ value: subjectMatches });
    });
  }
  const order = (result) =>
    [...result.content[0].text.matchAll(/Invoice ([abc])\*\*/g)].map(
      (m) => m[1]
    );

  test('says the window was not reached, and marks the result as partial', async () => {
    mockSearchStreamNewerThanWindow();

    const result = await handleSearchEmails(args);

    const meta = result._meta.searchMetadata;
    expect(meta.finalStrategy).toBe('single-term-query');
    expect(meta.partialCoverage).toBe(true);
    expect(meta.searchWindowUnreached).toBe(true);
    expect(meta.searchResultsRead).toBe(250);
    const text = result.content[0].text;
    expect(text).toContain('**Partial coverage**');
    expect(text).toContain(
      'Graph `$search` returned its 250 newest results and none fell inside the date window'
    );
    expect(text).toContain('against the subject, newest first');
    expect(text).toContain('`<words> AND received<=2025-10-01`');
    expect(text).not.toContain('Raise `count`');
  });

  test('the fallback request is sorted, and its results are newest first', async () => {
    mockSearchStreamNewerThanWindow();

    const result = await handleSearchEmails(args);

    const fallback = callGraphAPIPaginated.mock.calls
      .map((c) => c[3])
      .find((params) => params.$filter);
    expect(fallback.$filter).toBe(
      "receivedDateTime ge 1900-01-01T00:00:00Z and receivedDateTime le 2025-10-01T00:00:00.000Z and contains(subject, 'invoice')"
    );
    expect(fallback.$orderby).toBe('receivedDateTime desc');
    expect(result._meta.returned).toBe(3);
  });

  test('if Graph refuses the sorted fallback, the unsorted page is ordered locally', async () => {
    mockSearchStreamNewerThanWindow({ refuseSort: true });

    const result = await handleSearchEmails(args);

    const filters = callGraphAPIPaginated.mock.calls
      .map((c) => c[3])
      .filter((params) => params.$filter);
    expect(filters.at(-1).$orderby).toBeUndefined();
    expect(filters.at(-1).$filter).toBe(
      "contains(subject, 'invoice') and receivedDateTime le 2025-10-01T00:00:00.000Z"
    );
    expect(order(result)).toEqual(['b', 'a', 'c']);
    expect(result._meta.searchMetadata.searchWindowUnreached).toBe(true);
  });

  test('no flag when $search ran out of results before any cap (control)', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      Promise.resolve(
        params.$search
          ? { value: recentPage(0).value.slice(0, 19) }
          : { value: subjectMatches }
      )
    );

    const result = await handleSearchEmails(args);

    const meta = result._meta.searchMetadata;
    expect(meta.finalStrategy).toBe('single-term-query');
    expect(meta.searchWindowUnreached).toBeUndefined();
    expect(result.content[0].text).not.toContain(
      'none fell inside the date window'
    );
  });

  test('no flag when $search stopped because it passed receivedAfter (control)', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      Promise.resolve(
        params.$search
          ? {
              value: [old('x', '2020-01-01T00:00:00Z')],
              '@odata.nextLink': NEXT(50),
            }
          : { value: subjectMatches }
      )
    );

    const result = await handleSearchEmails({
      query: 'invoice',
      receivedAfter: '2026-01-01T00:00:00Z',
    });

    expect(result._meta.searchMetadata.searchWindowUnreached).toBeUndefined();
  });

  test('the no-results text also says the window was not reached', async () => {
    let page = 0;
    callGraphAPIPaginated.mockImplementation((_t, _m, endpoint, params) => {
      if (params.$search || String(endpoint).startsWith('https://')) {
        page += 50;
        return Promise.resolve(recentPage(page));
      }
      return Promise.resolve({ value: [] });
    });

    const result = await handleSearchEmails(args);

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).toContain(
      'none fell inside the date window'
    );
  });
});

// ──────────────────────────────────────────────────
// Advice in the result text must match the real state (live-test follow-up):
// don't say "raise `count`" at the maximum, and don't say a match "beyond that
// page" could exist when Graph had no further page.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — advice matches the real state', () => {
  const NEXT = 'https://graph.microsoft.com/v1.0/me/messages?$skip=50';
  const page = (n, extra = {}) => ({
    value: Array.from({ length: n }, (_, i) =>
      mockEmail({
        id: `m${i}`,
        subject: i % 2 ? 'Invoice' : 'Lunch',
        isRead: true,
      })
    ),
    ...extra,
  });

  test.each([
    [50, false],
    [25, true],
  ])(
    'partial-coverage note at count %i: suggests raising count is %s',
    async (count, suggestsRaise) => {
      // single-term-to page with more beyond it, narrowed locally by query
      callGraphAPIPaginated
        .mockRejectedValueOnce(new Error('400 ErrorInvalidProperty'))
        .mockResolvedValueOnce(
          page(10, { hasMore: true, '@odata.nextLink': NEXT })
        );

      const result = await handleSearchEmails({
        query: 'invoice',
        to: 'jane@example.com',
        count,
      });

      const text = result.content[0].text;
      expect(result._meta.searchMetadata.partialCoverage).toBe(true);
      expect(text).toContain('**Partial coverage**');
      expect(/[Rr]aise `count`/.test(text)).toBe(suggestsRaise);
      if (!suggestsRaise) {
        expect(text).toContain('`count` is already at its maximum of 50');
      }
    }
  );

  test.each([
    [{ subject: 'invoice', count: 50 }, false],
    [{ subject: 'invoice', count: 10 }, true],
    [{ query: 'invoice', count: 50 }, false],
    [{ searchExpression: 'invoice OR receipt', count: 50 }, false],
    [{ searchExpression: 'invoice OR receipt', count: 5 }, true],
  ])(
    'more-available footer for %j: suggests raising count is %s',
    async (args, suggestsRaise) => {
      callGraphAPIPaginated.mockResolvedValue(
        page(args.count, { hasMore: true, '@odata.nextLink': NEXT })
      );

      const result = await handleSearchEmails(args);

      const text = result.content[0].text;
      expect(result._meta.hasMore).toBe(true);
      expect(text).toMatch(/More emails (available|may match)/);
      expect(/raise `count`/.test(text)).toBe(suggestsRaise);
    }
  );

  test('no "beyond that page" line when the narrowed page was the whole answer', async () => {
    callGraphAPIPaginated
      // combined-search → empty
      .mockResolvedValueOnce({ value: [] })
      // single-term-from → everything from that sender, and no further page
      .mockResolvedValueOnce(page(21))
      // single-term-subject → empty
      .mockResolvedValueOnce({ value: [] });

    const result = await handleSearchEmails({
      from: 'john',
      subject: 'zzzqqq',
      searchAllFolders: true,
    });

    const text = result.content[0].text;
    expect(result._meta.returned).toBe(0);
    expect(text).not.toContain('beyond that page');
    expect(text).toContain(
      'All folders were already searched, so no message in this mailbox matches these filters'
    );
    expect(result._meta.searchMetadata.narrowedCandidates).toBeUndefined();
  });

  test('the unread-part line stays when Graph had more to read', async () => {
    callGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] })
      // single-term-from: the newest page, with more beyond it
      .mockResolvedValueOnce(
        page(21, { hasMore: true, '@odata.nextLink': NEXT })
      )
      // …then the oldest page, also with no subject match
      .mockResolvedValueOnce(page(21, { hasMore: true }))
      .mockResolvedValueOnce({ value: [] });

    const result = await handleSearchEmails({
      from: 'john',
      subject: 'zzzqqq',
      searchAllFolders: true,
    });

    const text = result.content[0].text;
    expect(text).toContain('a match between them would not have been seen');
    expect(text).toContain('applied locally to 42 messages');
    expect(text).not.toContain('no message in this mailbox matches');
  });

  test('a $search that returned every hit, none passing the filter, is not called partial', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      Promise.resolve(params.$search ? page(19) : { value: [] })
    );

    const result = await handleSearchEmails({
      query: 'invoice',
      unreadOnly: true,
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).not.toContain('beyond that page');
  });

  test('a search inside Archive does not suggest searchAllFolders "including Archive"', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      subject: 'zzzqqq',
      folder: 'Archive',
    });

    const text = result.content[0].text;
    expect(text).toContain('`searchAllFolders: true`');
    expect(text).not.toContain('including Archive');
  });
});

// ──────────────────────────────────────────────────
// Re-test N1: sorting the fallback steps (#331) made the page that is narrowed
// locally the newest N in place of the oldest N, so `subject` + `to` (and
// `query` + `to`) lost matches that sit in old mail. The candidates must come
// from inside the caller's date window, the old unsorted page must still be
// consulted before giving up, and the advice must point the right way.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — local narrowing keeps old-mail matches (N1)', () => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();
  const to = (address) => [{ emailAddress: { name: 'X', address } }];

  /** 600 recent non-matching messages, then invoices through 2021. */
  function buildMailbox({ oldestAreTheMatches }) {
    const rows = [];
    for (let i = 0; i < 600; i++) {
      rows.push(
        mockEmail({
          id: `recent-${i}`,
          subject: 'Newsletter',
          bodyPreview: 'news',
          receivedDateTime: iso(2026, 1, 1 + (i % 28)),
          toRecipients: to('me@example.com'),
        })
      );
    }
    for (let i = 0; i < 60; i++) {
      rows.push(
        mockEmail({
          id: `inv-${i}`,
          subject: 'Invoice',
          bodyPreview: 'invoice attached',
          receivedDateTime: iso(2021, 7 + Math.floor(i / 12), 1 + (i % 12)),
          toRecipients: to('me@example.com'),
        })
      );
    }
    const matchDates = oldestAreTheMatches
      ? [iso(2021, 6, 10), iso(2021, 6, 11)]
      : [iso(2021, 6, 10), iso(2021, 6, 11)];
    matchDates.forEach((date, i) =>
      rows.push(
        mockEmail({
          id: `match-${i}`,
          subject: 'Invoice',
          bodyPreview: 'invoice attached',
          receivedDateTime: date,
          toRecipients: to('billing@empresio.example'),
        })
      )
    );
    return rows;
  }

  /**
   * A personal mailbox that honours the window in `$filter`, sorts only when
   * asked (oldest first otherwise, as measured), pages with `$top`, and
   * rejects the recipient lambda and `$search` beside other parameters.
   */
  function mockPersonalMailbox(rows) {
    const byDate = (a, b) =>
      Date.parse(a.receivedDateTime) - Date.parse(b.receivedDateTime);
    callGraphAPIPaginated.mockImplementation(
      (_t, _m, _endpoint, params, maxCount) => {
        const filter = params.$filter || '';
        if (filter.includes('toRecipients/any(')) {
          return Promise.reject(
            new Error(
              'API call failed with status 400: {"error":{"code":"ErrorInvalidUrlQueryFilter"}}'
            )
          );
        }
        if (params.$search) {
          if (params.$filter || params.$orderby) {
            return Promise.reject(
              new Error('API call failed with status 400: SearchWithFilter')
            );
          }
          const word = params.$search.replace(/"/g, '').toLowerCase();
          const hits = rows
            .filter((m) =>
              `${m.subject} ${m.bodyPreview}`.toLowerCase().includes(word)
            )
            .sort((a, b) => byDate(b, a));
          return Promise.resolve({ value: hits.slice(0, maxCount) });
        }
        let value = rows.filter((m) =>
          filter
            .split(' and ')
            .filter(Boolean)
            .every((clause) => {
              const c = clause.trim();
              let match = /^receivedDateTime (ge|le) (\S+)$/.exec(c);
              if (match) {
                const at = Date.parse(m.receivedDateTime);
                return match[1] === 'ge'
                  ? at >= Date.parse(match[2])
                  : at <= Date.parse(match[2]);
              }
              match = /^contains\(subject, '([^']*)'\)$/.exec(c);
              if (match) {
                return m.subject.toLowerCase().includes(match[1].toLowerCase());
              }
              throw new Error(`unsupported clause: ${c}`);
            })
        );
        value = [...value].sort(
          params.$orderby ? (a, b) => byDate(b, a) : byDate
        );
        const limit = maxCount || params.$top;
        return Promise.resolve({
          value: value.slice(0, limit),
          hasMore: value.length > limit,
        });
      }
    );
  }

  const ids = (result) =>
    [...result.content[0].text.matchAll(/ID: `?(match-\d|inv-\d+|recent-\d+)/g)]
      .map((m) => m[1])
      .sort();

  test('subject + to + receivedBefore: finds the old mail (v3.14.1 found 2)', async () => {
    mockPersonalMailbox(buildMailbox({ oldestAreTheMatches: true }));

    const result = await handleSearchEmails({
      subject: 'invoice',
      to: 'empresio',
      receivedBefore: '2022-01-01',
      searchAllFolders: true,
      count: 50,
    });

    expect(result._meta.returned).toBe(2);
    expect(ids(result)).toEqual(['match-0', 'match-1']);
  });

  test('subject + to, no window: finds the old mail (v3.14.1 found 2)', async () => {
    mockPersonalMailbox(buildMailbox({ oldestAreTheMatches: true }));

    const result = await handleSearchEmails({
      subject: 'invoice',
      to: 'empresio',
      searchAllFolders: true,
      count: 25,
    });

    expect(result._meta.returned).toBe(2);
    expect(ids(result)).toEqual(['match-0', 'match-1']);
    // Found on the old unsorted page, so more may sit between the two ends.
    expect(result._meta.searchMetadata.finalStrategy).toBe(
      'single-term-subject'
    );
  });

  test('query + to + receivedBefore: finds the old mail without a second scan', async () => {
    mockPersonalMailbox(buildMailbox({ oldestAreTheMatches: true }));

    const result = await handleSearchEmails({
      query: 'invoice',
      to: 'empresio',
      receivedBefore: '2022-01-01',
      searchAllFolders: true,
      count: 25,
    });

    expect(result._meta.returned).toBe(2);
    expect(ids(result)).toEqual(['match-0', 'match-1']);
    expect(
      result._meta.searchMetadata.strategiesAttempted.filter((s) =>
        s.startsWith('client-side-')
      )
    ).toEqual(['client-side-to']);
  });

  test('the local scan asks Graph for the window, receivedDateTime first', async () => {
    mockPersonalMailbox(buildMailbox({ oldestAreTheMatches: true }));

    await handleSearchEmails({
      to: 'empresio',
      receivedAfter: '2021-01-01',
      receivedBefore: '2022-01-01',
      searchAllFolders: true,
    });

    const scan = callGraphAPIPaginated.mock.calls
      .map((c) => c[3])
      .find((p) => p.$orderby && !/toRecipients/.test(p.$filter || ''));
    expect(scan.$filter).toBe(
      'receivedDateTime ge 2021-01-01T00:00:00.000Z and receivedDateTime le 2022-01-01T00:00:00.000Z'
    );
  });

  test('the local scan without a window is unchanged: no $filter (control)', async () => {
    mockPersonalMailbox(buildMailbox({ oldestAreTheMatches: true }));

    await handleSearchEmails({ to: 'empresio', searchAllFolders: true });

    const scan = callGraphAPIPaginated.mock.calls
      .map((c) => c[3])
      .find((p) => p.$orderby && !p.$filter);
    expect(scan).toBeDefined();
  });

  // Nothing matches `to`, the invoices fill more than a page: the advice has
  // to say where the unread part of the window is.
  const BETWEEN =
    'set `receivedAfter` and `receivedBefore` around the dates you expect';
  test.each([
    [{}, BETWEEN],
    [{ receivedAfter: '2021-01-01' }, BETWEEN],
    [{ receivedBefore: '2022-01-01' }, BETWEEN],
    [{ receivedAfter: '2021-01-01', receivedBefore: '2022-01-01' }, BETWEEN],
  ])(
    'no match with window %j: both ends were read, so it says %s',
    async (window, advice) => {
      mockPersonalMailbox(buildMailbox({ oldestAreTheMatches: true }));

      const result = await handleSearchEmails({
        subject: 'invoice',
        to: 'nobody-at-all',
        searchAllFolders: true,
        count: 25,
        ...window,
      });

      const text = result.content[0].text;
      expect(result._meta.returned).toBe(0);
      expect(text).toContain('the newest and the oldest');
      expect(text).toContain(advice);
      expect(text).not.toContain('narrow with `receivedAfter`');
    }
  );

  test.each([
    [{}, 'set `receivedBefore`'],
    [{ receivedAfter: '2026-01-01' }, 'set `receivedBefore`'],
    [{ receivedBefore: '2026-06-01' }, 'set an earlier `receivedBefore`'],
    [
      { receivedAfter: '2026-01-01', receivedBefore: '2026-06-01' },
      'set an earlier `receivedBefore`',
    ],
  ])(
    'a scan that hit its limit with window %j says to %s',
    async (window, advice) => {
      mockPersonalMailbox(buildMailbox({ oldestAreTheMatches: true }));

      const result = await handleSearchEmails({
        to: 'nobody-at-all',
        searchAllFolders: true,
        ...window,
      });

      const text = result.content[0].text;
      expect(result._meta.returned).toBe(0);
      expect(text).toContain('hitting the 500 scan limit');
      expect(text).toContain(advice);
      expect(text).not.toContain('narrow with `receivedAfter`');
    }
  );
});

// ──────────────────────────────────────────────────
// Re-test N2: a scan or step that fails part-way (a Graph 502, a timeout) has
// not checked the mailbox, so the result must not say nothing in it matches.
// ──────────────────────────────────────────────────
describe('handleSearchEmails — a failed request is not proof of absence (N2)', () => {
  const transient = () =>
    Promise.reject(
      new Error(
        'API call failed with status 502: {"error":{"code":"UnknownError"}}'
      )
    );
  const rejected = () =>
    Promise.reject(
      new Error(
        'API call failed with status 400: {"error":{"code":"ErrorInvalidUrlQueryFilter"}}'
      )
    );
  const DEFINITIVE = 'no message in this mailbox matches';

  test('the client-side to scan fails: softened wording, and it says a request failed', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      const filter = params.$filter || '';
      if (filter.includes('toRecipients/any(')) return rejected();
      if (!filter && params.$orderby) return transient(); // the scan
      // single-term-from: the sender's mail, no further page
      return Promise.resolve({
        value: [mockEmail({ id: 'f1' }), mockEmail({ id: 'f2' })],
      });
    });

    const result = await handleSearchEmails({
      from: 'john',
      to: 'zzzqq',
      searchAllFolders: true,
      count: 50,
    });

    const text = result.content[0].text;
    expect(result._meta.returned).toBe(0);
    expect(text).not.toContain(DEFINITIVE);
    expect(text).toContain('so a match may still exist');
    expect(text).toContain('A request to Microsoft Graph failed part-way');
    expect(result._meta.searchMetadata.incomplete).toBe(true);
  });

  test.each([
    ['status 502', 'API call failed with status 502: Bad Gateway'],
    ['status 503', 'API call failed with status 503: Service Unavailable'],
    ['status 429', 'API call failed with status 429: Too Many Requests'],
    ['a timeout', 'Request timed out after 60000 ms with no data'],
    ['a dropped connection', 'socket hang up (ECONNRESET)'],
    // What utils/graph-api.js throws once its own retries are used up.
    ['a network error', 'Network error during API call: injected failure'],
    [
      'an unreadable response',
      'Error parsing API response: Unexpected end of JSON input',
    ],
  ])('%s on a server-side step softens the wording', async (_name, message) => {
    callGraphAPIPaginated.mockRejectedValue(new Error(message));

    const result = await handleSearchEmails({
      subject: 'zzzqqq',
      searchAllFolders: true,
    });

    expect(result._meta.returned).toBe(0);
    expect(result.content[0].text).not.toContain(DEFINITIVE);
    expect(result.content[0].text).toContain('so a match may still exist');
  });

  test('results from a fallback after a failed step are marked incomplete', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      params.$search
        ? transient()
        : Promise.resolve({
            value: [mockEmail({ id: 's1', subject: 'Invoice' })],
          })
    );

    const result = await handleSearchEmails({
      query: 'invoice',
      searchAllFolders: true,
    });

    expect(result._meta.returned).toBe(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe('single-term-query');
    expect(result._meta.searchMetadata.incomplete).toBe(true);
    expect(result._meta.searchMetadata.partialCoverage).toBe(true);
    expect(result.content[0].text).toContain(
      'A request to Microsoft Graph failed part-way'
    );
  });

  test('results with no failed step carry no incomplete flag (control)', async () => {
    callGraphAPIPaginated.mockResolvedValue({
      value: [mockEmail({ id: 's1', subject: 'Invoice' })],
    });

    const result = await handleSearchEmails({ subject: 'invoice' });

    expect(result._meta.searchMetadata.incomplete).toBeUndefined();
    expect(result.content[0].text).not.toContain('failed part-way');
  });

  test('a filter Graph rejects outright (400) is not a failed search (control)', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      (params.$filter || '').includes('toRecipients/any(')
        ? rejected()
        : Promise.resolve({ value: [] })
    );

    const result = await handleSearchEmails({
      to: 'zzzqq',
      searchAllFolders: true,
    });

    expect(result.content[0].text).toContain(DEFINITIVE);
    expect(result._meta.searchMetadata.incomplete).toBeUndefined();
  });

  test('a scan that completes with nothing keeps the definitive wording (control)', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });

    const result = await handleSearchEmails({
      from: 'john',
      subject: 'zzzqqq',
      searchAllFolders: true,
    });

    expect(result.content[0].text).toContain(DEFINITIVE);
  });
});

// More of N1: what the both-ends read, the held-back scan and the skipped
// second scan each do.
describe('handleSearchEmails — narrowing reads both ends and merges (N1)', () => {
  const at = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();
  const row = (id, date, toAddress, subject = 'Invoice') =>
    mockEmail({
      id,
      subject,
      bodyPreview: 'invoice attached',
      receivedDateTime: date,
      toRecipients: [{ emailAddress: { name: 'X', address: toAddress } }],
    });
  const lambdaRejected = () =>
    Promise.reject(
      new Error(
        'API call failed with status 400: {"error":{"code":"ErrorInvalidUrlQueryFilter"}}'
      )
    );
  const isLambda = (p) => (p.$filter || '').includes('toRecipients/any(');
  const isScan = (p) =>
    p.$orderby && !/contains\(|from\//.test(p.$filter || '');

  test('a match on the newest page and one on the oldest page both come back, flagged partial', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (isLambda(params)) return lambdaRejected();
      if (isScan(params)) return Promise.resolve({ value: [] });
      return Promise.resolve(
        params.$orderby
          ? {
              value: [
                row('new-hit', at(2026, 5, 1), 'a@empresio.example'),
                row('new-miss', at(2026, 4, 1), 'me@example.com'),
              ],
              hasMore: true,
            }
          : {
              value: [
                row('old-hit', at(2019, 5, 1), 'b@empresio.example'),
                row('old-miss', at(2019, 6, 1), 'me@example.com'),
              ],
              hasMore: true,
            }
      );
    });

    const result = await handleSearchEmails({
      subject: 'invoice',
      to: 'empresio',
      searchAllFolders: true,
      count: 2,
    });

    const text = result.content[0].text;
    expect(result._meta.returned).toBe(2);
    expect(text.indexOf('new-hit')).toBeGreaterThan(-1);
    expect(text.indexOf('old-hit')).toBeGreaterThan(text.indexOf('new-hit'));
    expect(result._meta.hasMore).toBe(true);
    expect(result._meta.searchMetadata.partialCoverage).toBe(true);
    expect(text).toContain('the newest and the oldest');
  });

  test('a page that was the whole answer is not read twice', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (isLambda(params)) return lambdaRejected();
      if (isScan(params)) return Promise.resolve({ value: [] });
      return Promise.resolve({
        value: [row('only', at(2026, 5, 1), 'a@empresio.example')],
      });
    });

    await handleSearchEmails({
      subject: 'invoice',
      to: 'empresio',
      searchAllFolders: true,
    });

    const subjectRequests = callGraphAPIPaginated.mock.calls.filter(
      (c) => /contains\(subject/.test(c[3].$filter || '') && !isLambda(c[3])
    );
    expect(subjectRequests).toHaveLength(1);
  });

  test('a scan that hit its limit is merged with the subject step, which reaches further back', async () => {
    const scanned = Array.from({ length: 500 }, (_, i) =>
      i === 0
        ? row('scan-hit', at(2026, 6, 1), 'a@empresio.example')
        : row(`other-${i}`, at(2026, 5, 1), 'me@example.com', 'Newsletter')
    );
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (isLambda(params)) return lambdaRejected();
      if (isScan(params)) return Promise.resolve({ value: scanned });
      return Promise.resolve({
        value: [
          row('scan-hit', at(2026, 6, 1), 'a@empresio.example'),
          row('deep-hit', at(2020, 6, 1), 'b@empresio.example'),
        ],
      });
    });

    const result = await handleSearchEmails({
      subject: 'invoice',
      to: 'empresio',
      searchAllFolders: true,
      count: 50,
    });

    const text = result.content[0].text;
    expect(result._meta.returned).toBe(2);
    expect(text).toContain('scan-hit');
    expect(text).toContain('deep-hit');
    expect(result._meta.searchMetadata.truncated).toBe(true);
  });

  test('a scan that hit its limit still answers when the later step finds nothing', async () => {
    const scanned = Array.from({ length: 500 }, (_, i) =>
      i === 0
        ? row('scan-hit', at(2026, 6, 1), 'a@empresio.example')
        : row(`other-${i}`, at(2026, 5, 1), 'me@example.com', 'Newsletter')
    );
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (isLambda(params)) return lambdaRejected();
      if (isScan(params)) return Promise.resolve({ value: scanned });
      return Promise.resolve({ value: [] });
    });

    const result = await handleSearchEmails({
      subject: 'invoice',
      to: 'empresio',
      searchAllFolders: true,
    });

    expect(result._meta.returned).toBe(1);
    expect(result._meta.searchMetadata.finalStrategy).toBe('client-side-to');
    expect(result._meta.searchMetadata.truncated).toBe(true);
  });

  test('query + to scans the recent messages once, not twice', async () => {
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) => {
      if (isLambda(params)) return lambdaRejected();
      if (params.$search) return Promise.resolve({ value: [] });
      return Promise.resolve({ value: [] });
    });

    const result = await handleSearchEmails({
      query: 'invoice',
      to: 'zzzqq',
      searchAllFolders: true,
    });

    const scans = callGraphAPIPaginated.mock.calls.filter(
      (c) => c[3].$orderby && !c[3].$filter && !c[3].$search
    );
    expect(scans).toHaveLength(1);
    expect(result._meta.searchMetadata.strategiesAttempted).not.toContain(
      'client-side-query'
    );
  });

  test('a local scan with more matches than count says more are available', async () => {
    const scanned = Array.from({ length: 30 }, (_, i) =>
      row(`hit-${i}`, at(2026, 6, 1 + (i % 28)), 'a@empresio.example')
    );
    callGraphAPIPaginated.mockImplementation((_t, _m, _e, params) =>
      isLambda(params) ? lambdaRejected() : Promise.resolve({ value: scanned })
    );

    const result = await handleSearchEmails({ to: 'empresio', count: 10 });

    expect(result._meta.returned).toBe(10);
    expect(result._meta.hasMore).toBe(true);
  });
});
