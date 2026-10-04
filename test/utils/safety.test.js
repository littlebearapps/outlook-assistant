// Safety refusals must be visible tool errors (#275): a rate-limit or
// allowlist refusal without isError reads as a successful send to clients.
const {
  checkRateLimit,
  checkRecipientAllowlist,
  findBlockedRecipients,
  DRY_RUN_LABEL,
  dryRunResult,
} = require('../../utils/safety');

const recipient = (address) => ({ emailAddress: { address } });

describe('checkRateLimit', () => {
  test('allows calls up to the limit, then refuses with isError', () => {
    expect(checkRateLimit('rate-test-tool', 1)).toBeNull();
    const refusal = checkRateLimit('rate-test-tool', 1);
    expect(refusal.isError).toBe(true);
    expect(refusal.content[0].text).toMatch(/Rate limit reached/);
  });
});

describe('checkRecipientAllowlist', () => {
  const saved = process.env.OUTLOOK_ALLOWED_RECIPIENTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.OUTLOOK_ALLOWED_RECIPIENTS;
    else process.env.OUTLOOK_ALLOWED_RECIPIENTS = saved;
  });

  test('allows recipients on the list', () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    expect(checkRecipientAllowlist([recipient('a@example.com')])).toBeNull();
  });

  test('refuses others with isError, naming the blocked address', () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    const refusal = checkRecipientAllowlist([recipient('x@evil.test')]);
    expect(refusal.isError).toBe(true);
    expect(refusal.content[0].text).toMatch(
      /Recipient not allowed: x@evil\.test/
    );
  });
});

// #274: every dry-run preview carries the same label, so it can't be read as
// a result.
describe('dryRunResult', () => {
  test('labels the preview and flags _meta.dryRun', () => {
    const result = dryRunResult(['Deletes contact X.', 'Second line.'], {
      contactId: 'c1',
    });
    expect(DRY_RUN_LABEL).toBe('DRY RUN — nothing was changed.');
    expect(result.content[0].text).toBe(
      'DRY RUN — nothing was changed.\n\nDeletes contact X.\nSecond line.'
    );
    expect(result._meta).toEqual({ dryRun: true, contactId: 'c1' });
    expect(result.isError).toBeUndefined();
  });

  test('accepts a single string', () => {
    expect(dryRunResult('One line.').content[0].text).toBe(
      'DRY RUN — nothing was changed.\n\nOne line.'
    );
  });
});

// With an allowlist set, only a single plain address can be allowed: a
// string holding several addresses, a display name or stray characters is
// blocked, even when it ends with an allowed domain.
describe('findBlockedRecipients address validation', () => {
  const saved = process.env.OUTLOOK_ALLOWED_RECIPIENTS;
  beforeEach(() => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com,boss@partner.test';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.OUTLOOK_ALLOWED_RECIPIENTS;
    else process.env.OUTLOOK_ALLOWED_RECIPIENTS = saved;
  });

  test.each([
    'x@elsewhere.test;bob@example.com',
    'x@elsewhere.test,bob@example.com',
    'Bob <bob@example.com>',
    '<bob@example.com>',
    '"x@elsewhere.test"@example.com',
    'x@elsewhere.test@example.com',
    'bob @example.com',
    'bob@example.com ',
    'bob\t@example.com',
    'bob\n@example.com',
    'bob\u0000@example.com',
    'bob​@example.com',
    '@example.com',
    'bob@',
    'bob',
    '',
    'boss@partner.test;x@elsewhere.test',
  ])('blocks %j', (address) => {
    const result = findBlockedRecipients([recipient(address)]);
    expect(result).not.toBeNull();
    expect(result.blocked).toHaveLength(1);
  });

  test.each([
    'bob@example.com',
    'Bob.Smith+tag@Example.com',
    "o'brien@example.com",
    'boss@partner.test',
  ])('allows %j', (address) => {
    expect(findBlockedRecipients([recipient(address)])).toBeNull();
  });

  test('names the refused string and why', () => {
    const refusal = checkRecipientAllowlist([
      recipient('x@elsewhere.test;bob@example.com'),
    ]);
    expect(refusal.isError).toBe(true);
    expect(refusal.content[0].text).toMatch(
      /"x@elsewhere\.test;bob@example\.com" \(not a single plain email address\)/
    );
  });

  test('without an allowlist nothing is blocked', () => {
    delete process.env.OUTLOOK_ALLOWED_RECIPIENTS;
    expect(
      findBlockedRecipients([recipient('x@elsewhere.test;bob@example.com')])
    ).toBeNull();
  });
});
