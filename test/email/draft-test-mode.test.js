/**
 * In USE_TEST_MODE the draft guard (#246) looks the ID up in the simulated
 * Graph responses, so the simulated message must be a draft or every
 * update/send/delete would be refused in mock mode.
 */
jest.mock('../../auth');

const config = require('../../config');
const handleDraft = require('../../email/draft');
const { ensureAuthenticated } = require('../../auth');

const originalTestMode = config.USE_TEST_MODE;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  config.USE_TEST_MODE = true;
  ensureAuthenticated.mockResolvedValue('test_access_token_mock');
});

afterEach(() => {
  config.USE_TEST_MODE = originalTestMode;
  console.error.mockRestore();
});

describe('draft actions in USE_TEST_MODE', () => {
  test.each([
    ['update', { subject: 'Updated in mock mode' }],
    ['delete', {}],
  ])('%s is not refused by the draft guard', async (action, extra) => {
    const result = await handleDraft({
      action,
      id: 'simulated-email-id',
      ...extra,
    });
    const text = result.content[0].text;

    expect(result.isError).not.toBe(true);
    expect(text).not.toContain('is not a draft');
    expect(text).not.toContain('Draft not found');
  });
});
