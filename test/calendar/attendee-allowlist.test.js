/**
 * OUTLOOK_ALLOWED_RECIPIENTS covers calendar invitations: create-event
 * attendees and the attendee list set by manage-event update. A call with a
 * blocked attendee is refused whole (dry runs report the refusal too), and
 * create-event counts against the session rate limit.
 *
 * Modules are reloaded per test so each one starts with fresh rate-limit
 * counters.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const ENV_KEYS = [
  'OUTLOOK_ALLOWED_RECIPIENTS',
  'OUTLOOK_MAX_CREATE_EVENT_PER_SESSION',
  'OUTLOOK_MAX_EMAILS_PER_SESSION',
];

let handleCreateEvent;
let handleUpdateEvent;
let callGraphAPI;
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  jest.resetModules();
  handleCreateEvent = require('../../calendar/create');
  handleUpdateEvent = require('../../calendar/update');
  ({ callGraphAPI } = require('../../utils/graph-api'));
  require('../../auth').ensureAuthenticated.mockResolvedValue('test_token');
  callGraphAPI.mockResolvedValue({ id: 'evt-1', subject: 'Plans' });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const eventArgs = (extra = {}) => ({
  subject: 'Plans',
  start: '2026-10-10T10:00:00',
  end: '2026-10-10T11:00:00',
  ...extra,
});

const writes = () =>
  callGraphAPI.mock.calls.filter(([, method]) => method !== 'GET');

describe('create-event attendees and OUTLOOK_ALLOWED_RECIPIENTS', () => {
  test('refuses the whole event when an attendee is not allowed', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    const result = await handleCreateEvent(
      eventArgs({
        attendees: [
          'alice@example.com',
          { email: 'x@elsewhere.test', type: 'optional' },
        ],
      })
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/x@elsewhere\.test/);
    expect(result.content[0].text).not.toMatch(/alice@example\.com/);
    expect(result.content[0].text).toMatch(/OUTLOOK_ALLOWED_RECIPIENTS/);
    expect(result.content[0].text).toMatch(/nothing was created/i);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('a dry run reports the refusal', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    const result = await handleCreateEvent(
      eventArgs({ attendees: ['x@elsewhere.test'], dryRun: true })
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^DRY RUN — event would be refused/);
    expect(result.content[0].text).toMatch(/x@elsewhere\.test/);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('creates the event when every attendee is allowed', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com,bob@partner.test';
    const result = await handleCreateEvent(
      eventArgs({ attendees: ['alice@example.com', 'Bob@Partner.test'] })
    );

    expect(result.isError).toBeUndefined();
    expect(writes()).toHaveLength(1);
  });

  test('without an allowlist any attendee is invited', async () => {
    const result = await handleCreateEvent(
      eventArgs({ attendees: ['x@elsewhere.test'] })
    );
    expect(result.isError).toBeUndefined();
    expect(writes()).toHaveLength(1);
  });

  test('an event without attendees is not affected by the allowlist', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    const result = await handleCreateEvent(eventArgs());
    expect(result.isError).toBeUndefined();
    expect(writes()).toHaveLength(1);
  });
});

describe('create-event session rate limit', () => {
  test('is unlimited when no limit is configured', async () => {
    for (let i = 0; i < 15; i++) {
      const result = await handleCreateEvent(eventArgs());
      expect(result.isError).toBeUndefined();
    }
    expect(writes()).toHaveLength(15);
  });

  test('refuses once OUTLOOK_MAX_CREATE_EVENT_PER_SESSION is reached', async () => {
    process.env.OUTLOOK_MAX_CREATE_EVENT_PER_SESSION = '1';
    expect((await handleCreateEvent(eventArgs())).isError).toBeUndefined();

    const refusal = await handleCreateEvent(eventArgs());
    expect(refusal.isError).toBe(true);
    expect(refusal.content[0].text).toMatch(/Rate limit reached/);
    expect(refusal.content[0].text).toMatch(
      /OUTLOOK_MAX_CREATE_EVENT_PER_SESSION/
    );
    expect(writes()).toHaveLength(1);
  });

  test('dry runs do not count against the limit', async () => {
    process.env.OUTLOOK_MAX_CREATE_EVENT_PER_SESSION = '1';
    await handleCreateEvent(eventArgs({ dryRun: true }));
    await handleCreateEvent(eventArgs({ dryRun: true }));
    expect((await handleCreateEvent(eventArgs())).isError).toBeUndefined();
  });
});

describe('manage-event update attendees and OUTLOOK_ALLOWED_RECIPIENTS', () => {
  test('refuses the update when the new attendee list has a blocked address', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    const result = await handleUpdateEvent({
      eventId: 'evt-1',
      subject: 'New plans',
      attendees: [
        { email: 'alice@example.com', type: 'required' },
        { email: 'x@elsewhere.test', type: 'required' },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/x@elsewhere\.test/);
    expect(result.content[0].text).toMatch(/nothing was changed/i);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('refuses before reading the event, even for untyped attendees', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    const result = await handleUpdateEvent({
      eventId: 'evt-1',
      attendees: ['x@elsewhere.test'],
    });

    expect(result.isError).toBe(true);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('a dry run reports the refusal', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    const result = await handleUpdateEvent({
      eventId: 'evt-1',
      attendees: [{ email: 'x@elsewhere.test', type: 'optional' }],
      dryRun: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(
      /^DRY RUN — event update would be refused/
    );
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('updates when every attendee is allowed', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    const result = await handleUpdateEvent({
      eventId: 'evt-1',
      attendees: [{ email: 'alice@example.com', type: 'required' }],
    });

    expect(result.isError).toBeUndefined();
    expect(writes()).toHaveLength(1);
  });

  test('an update that leaves attendees alone is not checked', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    const result = await handleUpdateEvent({
      eventId: 'evt-1',
      subject: 'Renamed',
    });

    expect(result.isError).toBeUndefined();
    expect(writes()).toHaveLength(1);
  });
});
