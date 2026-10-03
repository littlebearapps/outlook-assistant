/**
 * With OUTLOOK_ALLOWED_RECIPIENTS set, every tool that checks recipients
 * refuses a recipient string that isn't a single plain address, even when it
 * ends with an allowed domain: send-email, draft and create-event.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const handleSendEmail = require('../../email/send');
const handleDraft = require('../../email/draft');
const handleCreateEvent = require('../../calendar/create');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

const MIXED = 'x@elsewhere.test;bob@example.com';
const saved = process.env.OUTLOOK_ALLOWED_RECIPIENTS;

beforeEach(() => {
  process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
  callGraphAPI.mockReset();
  callGraphAPI.mockResolvedValue({ id: 'new-id' });
  ensureAuthenticated.mockResolvedValue('test_token');
});

afterAll(() => {
  if (saved === undefined) delete process.env.OUTLOOK_ALLOWED_RECIPIENTS;
  else process.env.OUTLOOK_ALLOWED_RECIPIENTS = saved;
});

const expectRefused = (result) => {
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain(JSON.stringify(MIXED));
  expect(callGraphAPI).not.toHaveBeenCalled();
};

describe.each(['to', 'cc', 'bcc'])('send-email %s', (field) => {
  test('refuses a string holding more than one address', async () => {
    expectRefused(
      await handleSendEmail({
        to: 'alice@example.com',
        [field]: MIXED,
        subject: 'Hi',
        body: 'Hello',
      })
    );
  });
});

test('send-email refuses a display-name address', async () => {
  const result = await handleSendEmail({
    to: 'Bob <bob@example.com>',
    subject: 'Hi',
    body: 'Hello',
  });
  expect(result.isError).toBe(true);
  expect(callGraphAPI).not.toHaveBeenCalled();
});

test('draft create refuses a string holding more than one address', async () => {
  expectRefused(
    await handleDraft({
      action: 'create',
      to: MIXED,
      subject: 'Hi',
      body: 'Hello',
    })
  );
});

test('draft forward refuses a string holding more than one address', async () => {
  expectRefused(
    await handleDraft({ action: 'forward', id: 'msg-1', to: MIXED })
  );
});

test('create-event refuses an attendee string holding more than one address', async () => {
  expectRefused(
    await handleCreateEvent({
      subject: 'Plans',
      start: '2026-10-10T10:00:00',
      end: '2026-10-10T11:00:00',
      attendees: [MIXED],
    })
  );
});

test('create-event still invites plain allowed addresses', async () => {
  const result = await handleCreateEvent({
    subject: 'Plans',
    start: '2026-10-10T10:00:00',
    end: '2026-10-10T11:00:00',
    attendees: ['bob@example.com'],
  });
  expect(result.isError).toBeUndefined();
  expect(callGraphAPI).toHaveBeenCalledTimes(1);
});
