// manage-rules safety (#273): a rule whose forwarding is blocked by
// OUTLOOK_ALLOWED_RECIPIENTS is refused whole (never saved minus the
// forward).
//
// The rate-limit counters live in utils/safety.js module state, so each test
// loads fresh copies of the handlers and their mocks.

jest.mock('../../utils/graph-api');
jest.mock('../../auth', () => ({ ensureAuthenticated: jest.fn() }));
jest.mock('../../folder/resolve', () => ({
  ...jest.requireActual('../../folder/resolve'),
  resolveFolder: jest.fn(),
}));

const LIMIT_ENV = 'OUTLOOK_MAX_MANAGE_RULES_PER_SESSION';
const ALLOWLIST_ENV = 'OUTLOOK_ALLOWED_RECIPIENTS';

const mockRules = [
  {
    id: 'rule-1',
    displayName: 'Move newsletters',
    isEnabled: true,
    sequence: 1,
    conditions: {
      fromAddresses: [{ emailAddress: { address: 'news@example.com' } }],
    },
    actions: { markAsRead: true },
  },
];

let callGraphAPI;
let ensureAuthenticated;
let handleCreateRule;
let handleUpdateRule;
const savedEnv = {};

beforeEach(() => {
  jest.resetModules();
  for (const key of [LIMIT_ENV, ALLOWLIST_ENV]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  ({ callGraphAPI } = require('../../utils/graph-api'));
  ({ ensureAuthenticated } = require('../../auth'));
  ensureAuthenticated.mockResolvedValue('test_token');
  handleCreateRule = require('../../rules/create');
  handleUpdateRule = require('../../rules/update');
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const writeCalls = () =>
  callGraphAPI.mock.calls.filter(([, method]) => method !== 'GET');

describe('allowlist-blocked forwarding refuses the whole rule', () => {
  beforeEach(() => {
    process.env[ALLOWLIST_ENV] = 'example.com';
  });

  it('refuses create when forwardTo has a blocked address', async () => {
    const result = await handleCreateRule({
      name: 'Forward invoices',
      containsSubject: 'invoice',
      markAsRead: true,
      forwardTo: 'ok@example.com, leak@evil.test',
    });

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('leak@evil.test');
    expect(text).not.toContain('ok@example.com');
    expect(text).toContain('forwardTo');
    expect(text).toContain('OUTLOOK_ALLOWED_RECIPIENTS');
    expect(text).toContain('Next step:');
    expect(writeCalls()).toHaveLength(0);
  });

  it('refuses create when only redirectTo is blocked, even with a valid forward', async () => {
    const result = await handleCreateRule({
      name: 'Redirect',
      containsSubject: 'invoice',
      forwardTo: 'ok@example.com',
      redirectTo: 'other@evil.test',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('redirectTo');
    expect(result.content[0].text).toContain('other@evil.test');
    expect(writeCalls()).toHaveLength(0);
  });

  it('a create dry run reports that the rule would be refused', async () => {
    const result = await handleCreateRule({
      name: 'Forward invoices',
      containsSubject: 'invoice',
      forwardTo: 'leak@evil.test',
      dryRun: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/DRY RUN/);
    expect(result.content[0].text).toMatch(/would be refused/);
    expect(result.content[0].text).toContain('leak@evil.test');
    expect(writeCalls()).toHaveLength(0);
  });

  it('refuses update when forwardTo has a blocked address', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRules });

    const result = await handleUpdateRule({
      ruleName: 'Move newsletters',
      forwardTo: 'leak@evil.test',
      markAsRead: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('leak@evil.test');
    expect(result.content[0].text).toContain('Next step:');
    expect(writeCalls()).toHaveLength(0);
  });

  it('an update dry run reports that the update would be refused', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRules });

    const result = await handleUpdateRule({
      ruleName: 'Move newsletters',
      redirectTo: 'leak@evil.test',
      dryRun: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/DRY RUN/);
    expect(result.content[0].text).toMatch(/would be refused/);
    expect(result.content[0].text).toContain('leak@evil.test');
    expect(writeCalls()).toHaveLength(0);
  });

  it('still creates a rule whose recipients are all allowed', async () => {
    callGraphAPI
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ id: 'new-rule-id' });

    const result = await handleCreateRule({
      name: 'Forward invoices',
      containsSubject: 'invoice',
      forwardTo: 'ok@example.com',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Successfully created rule');
    expect(writeCalls()[0][3].actions.forwardTo).toEqual([
      { emailAddress: { address: 'ok@example.com' } },
    ]);
  });
});
