// Safety refusals must be visible tool errors (#275): a rate-limit or
// allowlist refusal without isError reads as a successful send to clients.
const {
  checkRateLimit,
  checkRecipientAllowlist,
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
