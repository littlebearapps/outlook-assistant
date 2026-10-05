// Safety refusals must be visible tool errors (#275): a rate-limit or
// allowlist refusal without isError reads as a successful send to clients.
const {
  checkRateLimit,
  resolveSessionLimit,
  describeSessionLimits,
  blockedTools,
  RATE_LIMITED_TOOLS,
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
    expect(refusal.content[0].text).toMatch(/Do not retry/);
  });
});

// #302: 0 used to mean "no limit". A safety setting must fail closed, so
// 0 (or anything unreadable) now blocks the tool; only unset means no cap.
describe('session limits (#302)', () => {
  const KEYS = [
    'OUTLOOK_MAX_EMAILS_PER_SESSION',
    'OUTLOOK_MAX_LIMIT_TEST_PER_SESSION',
    'OUTLOOK_MAX_SEND_EMAIL_PER_SESSION',
    'OUTLOOK_MAX_DRAFT_PER_SESSION',
    'OUTLOOK_MAX_CREATE_EVENT_PER_SESSION',
    'OUTLOOK_MAX_MANAGE_RULES_PER_SESSION',
  ];
  const saved = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('unset or empty means no limit', () => {
    expect(resolveSessionLimit('limit-test').limit).toBeNull();
    process.env.OUTLOOK_MAX_EMAILS_PER_SESSION = '  ';
    expect(resolveSessionLimit('limit-test').limit).toBeNull();
    expect(checkRateLimit('limit-test')).toBeNull();
  });

  test('0 blocks the tool, saying which setting did it', () => {
    process.env.OUTLOOK_MAX_EMAILS_PER_SESSION = '0';
    const refusal = checkRateLimit('send-email');
    expect(refusal.isError).toBe(true);
    const text = refusal.content[0].text;
    expect(text).toMatch(/send-email is blocked/);
    expect(text).toMatch(/OUTLOOK_MAX_EMAILS_PER_SESSION=0/);
    expect(text).toMatch(/Nothing was sent or changed/);
    expect(text).toMatch(/do not use another tool/i);
    // Still blocked on every later call.
    expect(checkRateLimit('send-email').isError).toBe(true);
  });

  test.each(['-1', '1.5', 'abc', 'unlimited', '10 emails'])(
    'an unreadable value (%s) fails closed',
    (value) => {
      process.env.OUTLOOK_MAX_EMAILS_PER_SESSION = value;
      const resolved = resolveSessionLimit('limit-test');
      expect(resolved).toMatchObject({ limit: 0, invalid: true });
      const text = checkRateLimit('limit-test').content[0].text;
      expect(text).toMatch(/not a whole number/);
      expect(text).toMatch(/fails closed/);
    }
  );

  test("a tool's own setting wins over the default, either way", () => {
    // Drafts allowed while every send is blocked.
    process.env.OUTLOOK_MAX_EMAILS_PER_SESSION = '0';
    process.env.OUTLOOK_MAX_DRAFT_PER_SESSION = '5';
    expect(resolveSessionLimit('draft')).toMatchObject({
      limit: 5,
      envKey: 'OUTLOOK_MAX_DRAFT_PER_SESSION',
    });
    expect(resolveSessionLimit('send-email').limit).toBe(0);
    // One tool blocked, the rest unlimited.
    delete process.env.OUTLOOK_MAX_EMAILS_PER_SESSION;
    process.env.OUTLOOK_MAX_SEND_EMAIL_PER_SESSION = '0';
    expect(resolveSessionLimit('send-email').limit).toBe(0);
    expect(resolveSessionLimit('create-event').limit).toBeNull();
  });

  test('blockedTools and describeSessionLimits report the blocked tools', () => {
    process.env.OUTLOOK_MAX_EMAILS_PER_SESSION = '0';
    process.env.OUTLOOK_MAX_DRAFT_PER_SESSION = '3';
    expect(blockedTools()).toEqual([
      'send-email',
      'create-event',
      'manage-rules',
    ]);
    const lines = describeSessionLimits().join('\n');
    expect(lines).toMatch(
      /send-email: BLOCKED \(OUTLOOK_MAX_EMAILS_PER_SESSION=0/
    );
    expect(lines).toMatch(/draft: 3 per session/);
    delete process.env.OUTLOOK_MAX_EMAILS_PER_SESSION;
    delete process.env.OUTLOOK_MAX_DRAFT_PER_SESSION;
    expect(blockedTools()).toEqual([]);
    expect(describeSessionLimits()[0]).toMatch(/no limit \(not set\)/);
  });

  test('every rate-limited tool is listed', () => {
    expect(Object.keys(RATE_LIMITED_TOOLS).sort()).toEqual(
      ['create-event', 'draft', 'manage-rules', 'send-email'].sort()
    );
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
