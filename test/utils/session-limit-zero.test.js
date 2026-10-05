/**
 * A session limit of 0 blocks the tool (#302).
 *
 * OUTLOOK_MAX_EMAILS_PER_SESSION=0 used to mean "no limit", so a user who set
 * it to stop all sending got unlimited sending. Every rate-limited write must
 * now be refused before any Graph write, while dry runs still preview.
 *
 * Modules are reloaded per test so each one starts with fresh counters.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const ENV_KEYS = [
  'OUTLOOK_MAX_EMAILS_PER_SESSION',
  'OUTLOOK_MAX_SEND_EMAIL_PER_SESSION',
  'OUTLOOK_MAX_DRAFT_PER_SESSION',
  'OUTLOOK_MAX_CREATE_EVENT_PER_SESSION',
  'OUTLOOK_MAX_MANAGE_RULES_PER_SESSION',
  'OUTLOOK_ALLOWED_RECIPIENTS',
];

let callGraphAPI;
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.OUTLOOK_MAX_EMAILS_PER_SESSION = '0';
  jest.resetModules();
  ({ callGraphAPI } = require('../../utils/graph-api'));
  require('../../auth').ensureAuthenticated.mockResolvedValue('test_token');
  callGraphAPI.mockImplementation((_token, method, path) => {
    if (method === 'GET' && /^me\/messages\//.test(path)) {
      // draft send looks the draft up first
      return Promise.resolve({
        id: 'd1',
        isDraft: true,
        toRecipients: [{ emailAddress: { address: 'a@example.com' } }],
        ccRecipients: [],
        bccRecipients: [],
      });
    }
    if (method === 'GET') return Promise.resolve({ value: [] });
    return Promise.resolve({ id: 'x' });
  });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** Graph calls that would send or change something. */
const writes = () =>
  callGraphAPI.mock.calls.filter(([, method]) => method !== 'GET');

const expectBlocked = (result, tool) => {
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(new RegExp(`${tool} is blocked`));
  expect(result.content[0].text).toMatch(/OUTLOOK_MAX_EMAILS_PER_SESSION=0/);
  expect(writes()).toHaveLength(0);
};

test('send-email is refused with nothing sent', async () => {
  const handleSendEmail = require('../../email/send');
  const result = await handleSendEmail({
    to: 'a@example.com',
    subject: 'S',
    body: 'B',
  });
  expectBlocked(result, 'send-email');
});

test('draft action=send is refused (it counts as send-email)', async () => {
  // Drafting allowed, sending blocked: the documented draft-only setup.
  process.env.OUTLOOK_MAX_DRAFT_PER_SESSION = '5';
  const handleDraft = require('../../email/draft');
  const result = await handleDraft({ action: 'send', id: 'd1' });
  expectBlocked(result, 'send-email');
});

test('draft action=create is refused unless drafts have their own limit', async () => {
  const handleDraft = require('../../email/draft');
  const result = await handleDraft({
    action: 'create',
    to: 'a@example.com',
    subject: 'S',
    body: 'B',
  });
  expectBlocked(result, 'draft');
});

test('create-event is refused with no invitation sent', async () => {
  const handleCreateEvent = require('../../calendar/create');
  const result = await handleCreateEvent({
    subject: 'S',
    start: '2026-10-06T10:00:00',
    end: '2026-10-06T10:30:00',
    attendees: ['a@example.com'],
  });
  expectBlocked(result, 'create-event');
});

test('manage-rules create is refused with no rule written', async () => {
  const handleCreateRule = require('../../rules/create');
  const result = await handleCreateRule({
    name: 'R',
    containsSubject: 'x',
    markAsRead: true,
  });
  expectBlocked(result, 'manage-rules');
});

test('a dry run still previews: nothing is sent either way', async () => {
  const handleSendEmail = require('../../email/send');
  const result = await handleSendEmail({
    to: 'a@example.com',
    subject: 'S',
    body: 'B',
    dryRun: true,
  });
  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toMatch(/Email NOT sent/);
  expect(writes()).toHaveLength(0);
});
