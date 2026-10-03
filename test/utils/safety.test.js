// Safety refusals must be visible tool errors (#275): a rate-limit or
// allowlist refusal without isError reads as a successful send to clients.
const {
  checkRateLimit,
  checkRecipientAllowlist,
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
