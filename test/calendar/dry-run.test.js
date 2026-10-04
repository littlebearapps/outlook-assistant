/**
 * dryRun previews for create-event and manage-event cancel/decline/delete
 * (#274). A dry run may read (the event, the signed-in address) but must
 * never write, and the preview must say exactly who would be emailed.
 */
const handleCreateEvent = require('../../calendar/create');
const handleCancelEvent = require('../../calendar/cancel');
const handleDeclineEvent = require('../../calendar/decline');
const handleDeleteEvent = require('../../calendar/delete');
const { calendarTools } = require('../../calendar');
const { coerceArgsAgainstSchema } = require('../../utils/schema-coerce');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const ME = { mail: 'me@company.com', userPrincipalName: 'me@company.com' };

const attendee = (address, type = 'required') => ({
  emailAddress: { address },
  type,
});

// 6 people (2 external) plus a room; the organiser is the signed-in user.
const EVENT = {
  id: 'evt-1',
  subject: 'Team sync',
  start: { dateTime: '2026-04-02T22:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-04-02T23:00:00.0000000', timeZone: 'UTC' },
  isOrganizer: true,
  isCancelled: false,
  organizer: { emailAddress: { name: 'Me', address: 'me@company.com' } },
  attendees: [
    attendee('a@company.com'),
    attendee('B@Company.com'),
    attendee('c@company.com', 'optional'),
    attendee('d@company.com'),
    attendee('x@partner.org'),
    attendee('y@gmail.com', 'optional'),
    attendee('room@company.com', 'resource'),
  ],
};

// An invitation the signed-in user received from an external organiser.
const INVITE = {
  ...EVENT,
  isOrganizer: false,
  organizer: {
    emailAddress: { name: 'Alice Partner', address: 'alice@partner.org' },
  },
  attendees: [attendee('me@company.com'), attendee('alice@partner.org')],
};

/** Route GETs: `me` → the signed-in user, `me/events/…` → the event. */
function mockReads(event, me = ME) {
  const route = (method, path) => {
    if (method !== 'GET') return {};
    if (path === 'me') {
      if (me instanceof Error) throw me;
      return me;
    }
    if (path.startsWith('me/events/')) return event;
    throw new Error(`unexpected GET ${path}`);
  };
  callGraphAPI.mockImplementation((_token, method, path) =>
    Promise.resolve().then(() => route(method, path))
  );
}

/** Every Graph call that isn't a read. */
const writeCalls = () =>
  callGraphAPI.mock.calls.filter(([, method]) => method !== 'GET');

const textOf = (result) => result.content[0].text;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue('token');
});

afterEach(() => {
  console.error.mockRestore();
});

describe('create-event dryRun', () => {
  const args = {
    subject: 'Team sync',
    start: '2026-04-03T09:00:00',
    end: '2026-04-03T10:00:00',
    attendees: [
      'a@company.com',
      'x@partner.org',
      { email: 'room@company.com', type: 'resource' },
      { email: 'c@company.com', type: 'optional' },
    ],
    dryRun: true,
  };

  test('previews the invitations without creating the event', async () => {
    mockReads(null);

    const result = await handleCreateEvent(args);

    expect(writeCalls()).toEqual([]);
    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toMatch(/^DRY RUN — nothing was changed\./);
    expect(text).toContain(
      "Creates 'Team sync' on 2026-04-03T09:00:00 to 2026-04-03T10:00:00"
    );
    expect(text).toContain('emails invitations to 3 attendees (1 external)');
    expect(text).toContain('x@partner.org (external)');
    expect(text).toContain('room@company.com');
    expect(result._meta.dryRun).toBe(true);
  });

  test('says nobody is invited when there are no attendees', async () => {
    const result = await handleCreateEvent({ ...args, attendees: undefined });

    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(textOf(result)).toContain('No attendees, so no invitations');
  });

  test('says the external count is unknown when the signed-in address cannot be read', async () => {
    mockReads(null, new Error('API call failed with status 403'));

    const result = await handleCreateEvent(args);

    expect(writeCalls()).toEqual([]);
    expect(textOf(result)).toContain(
      'emails invitations to 3 attendees (external count unknown)'
    );
  });

  test('still rejects an invalid attendee on a dry run', async () => {
    const result = await handleCreateEvent({
      ...args,
      attendees: [{ email: 'room@company.com', type: 'room' }],
    });

    expect(result.isError).toBe(true);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('schema exposes a boolean dryRun', () => {
    const tool = calendarTools.find((t) => t.name === 'create-event');
    const { dryRun } = tool.inputSchema.properties;
    expect(dryRun.type).toBe('boolean');
    expect(dryRun.description).toMatch(/^Preview only/);
  });
});

describe('manage-event cancel dryRun', () => {
  test('counts attendees and external attendees, and sends nothing', async () => {
    mockReads(EVENT);

    const result = await handleCancelEvent({
      eventId: 'evt-1',
      comment: 'Moving to next week',
      dryRun: true,
    });

    expect(writeCalls()).toEqual([]);
    const text = textOf(result);
    expect(text).toMatch(/^DRY RUN — nothing was changed\./);
    expect(text).toMatch(
      /Cancels 'Team sync' on 3 Apr 2026, 9:00 am .* and emails a cancellation to 6 attendees \(2 external\)/
    );
    expect(text).toContain('room@company.com');
    expect(text).toContain('Message: "Moving to next week"');
    expect(result._meta).toMatchObject({
      dryRun: true,
      eventId: 'evt-1',
      notified: 6,
      external: 2,
    });
  });

  test('falls back to the organiser address when the signed-in address cannot be read', async () => {
    mockReads(EVENT, new Error('API call failed with status 403'));

    const result = await handleCancelEvent({ eventId: 'evt-1', dryRun: true });

    expect(textOf(result)).toContain('6 attendees (2 external)');
    expect(textOf(result)).toContain('No message');
  });

  test('warns that Graph refuses to cancel an event you did not organise', async () => {
    mockReads(INVITE);

    const result = await handleCancelEvent({ eventId: 'evt-1', dryRun: true });

    expect(writeCalls()).toEqual([]);
    expect(textOf(result)).toMatch(/aren't the organiser/);
    expect(textOf(result)).toMatch(/action=decline/);
  });

  test('says nobody is emailed when the event has no attendees', async () => {
    mockReads({ ...EVENT, attendees: [] });

    const result = await handleCancelEvent({ eventId: 'evt-1', dryRun: true });

    expect(textOf(result)).toContain('nobody is emailed');
  });
});

describe('manage-event decline dryRun', () => {
  test('names the organiser who would be emailed, marked external', async () => {
    mockReads(INVITE);

    const result = await handleDeclineEvent({
      eventId: 'evt-1',
      comment: "Can't make it",
      dryRun: true,
    });

    expect(writeCalls()).toEqual([]);
    const text = textOf(result);
    expect(text).toMatch(/^DRY RUN — nothing was changed\./);
    expect(text).toMatch(
      /Declines 'Team sync' on 3 Apr 2026.* and emails your response to the organiser, Alice Partner <alice@partner\.org> \(external\)/
    );
    expect(text).toContain('Message: "Can\'t make it"');
    expect(result._meta).toMatchObject({ dryRun: true, notified: 1 });
  });

  test('sendResponse: false notifies nobody', async () => {
    mockReads(INVITE);

    const result = await handleDeclineEvent({
      eventId: 'evt-1',
      sendResponse: false,
      dryRun: true,
    });

    expect(textOf(result)).toContain('without notifying the organiser');
    expect(result._meta.notified).toBe(0);
  });

  test('says the external status is unknown without the signed-in address', async () => {
    mockReads(INVITE, new Error('API call failed with status 403'));

    const result = await handleDeclineEvent({ eventId: 'evt-1', dryRun: true });

    expect(textOf(result)).toContain(
      'Alice Partner <alice@partner.org> (external status unknown)'
    );
  });

  test('warns that you cannot decline a meeting you organised', async () => {
    mockReads(EVENT);

    const result = await handleDeclineEvent({ eventId: 'evt-1', dryRun: true });

    expect(textOf(result)).toMatch(/You organised this event/);
    expect(textOf(result)).toMatch(/action=cancel/);
  });
});

describe('manage-event delete dryRun', () => {
  test('organiser with attendees: says a cancellation goes to them', async () => {
    mockReads(EVENT);

    const result = await handleDeleteEvent({ eventId: 'evt-1', dryRun: true });

    expect(writeCalls()).toEqual([]);
    const text = textOf(result);
    expect(text).toMatch(
      /Deletes 'Team sync' on 3 Apr 2026.* from your calendar and emails a cancellation to 6 attendees \(2 external\)/
    );
    expect(text).toMatch(/doesn't document a guaranteed way to restore/);
    expect(result._meta).toMatchObject({ notified: 6, external: 2 });
  });

  test('attendee: nobody is emailed and the organiser is not told', async () => {
    mockReads(INVITE);

    const result = await handleDeleteEvent({ eventId: 'evt-1', dryRun: true });

    const text = textOf(result);
    expect(text).toContain('Nobody is emailed');
    expect(text).toContain('Alice Partner <alice@partner.org>');
    expect(text).toMatch(/action=decline/);
    expect(result._meta.notified).toBe(0);
  });

  test('a cancelled meeting emails nobody', async () => {
    mockReads({ ...EVENT, isCancelled: true });

    const result = await handleDeleteEvent({ eventId: 'evt-1', dryRun: true });

    expect(textOf(result)).toContain('Nobody is emailed');
    expect(result._meta.notified).toBe(0);
  });
});

describe('manage-event dryRun through the tool', () => {
  const manageEvent = calendarTools.find((t) => t.name === 'manage-event');

  function callManageEvent(rawArgs) {
    const coerced = coerceArgsAgainstSchema(rawArgs, manageEvent.inputSchema);
    expect(coerced.error).toBeUndefined();
    return manageEvent.handler(coerced.args);
  }

  test.each(['cancel', 'decline', 'delete'])(
    '%s with dryRun "true" makes no write call',
    async (action) => {
      mockReads(action === 'decline' ? INVITE : EVENT);

      const result = await callManageEvent({
        action,
        id: 'evt-1',
        dryRun: 'true',
      });

      expect(writeCalls()).toEqual([]);
      expect(textOf(result)).toMatch(/^DRY RUN — nothing was changed\./);
    }
  );

  test.each(['cancel', 'decline', 'delete'])(
    '%s without dryRun still writes',
    async (action) => {
      callGraphAPI.mockResolvedValue({});

      await callManageEvent({ action, id: 'evt-1' });

      expect(writeCalls()).toHaveLength(1);
      expect(callGraphAPI).toHaveBeenCalledTimes(1);
    }
  );

  test('a failed event read is a visible error', async () => {
    callGraphAPI.mockRejectedValue(
      new Error('API call failed with status 404: not found')
    );

    const result = await handleCancelEvent({ eventId: 'evt-1', dryRun: true });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/404/);
    expect(writeCalls()).toEqual([]);
  });

  test('dryRun description covers every action', () => {
    const { dryRun } = manageEvent.inputSchema.properties;
    expect(dryRun.type).toBe('boolean');
    expect(dryRun.description).toMatch(/^Preview only/);
    expect(dryRun.description).not.toMatch(/action=update only/);
  });
});

describe('previews of events with missing fields', () => {
  // An invitation with no subject and no organiser details.
  const BARE = { ...INVITE, subject: undefined, organizer: undefined };

  test.each([
    ['cancel', handleCancelEvent],
    ['decline', handleDeclineEvent],
    ['delete', handleDeleteEvent],
  ])('%s says "(no subject)", never "undefined"', async (_action, handler) => {
    mockReads({ ...BARE, isOrganizer: _action === 'cancel' });

    const result = await handler({ eventId: 'evt-1', dryRun: true });

    expect(textOf(result)).not.toContain('undefined');
    expect(textOf(result)).toContain('(no subject)');
  });

  test('decline without organiser details names "the organiser" once', async () => {
    mockReads(BARE);

    const result = await handleDeclineEvent({ eventId: 'evt-1', dryRun: true });

    const text = textOf(result);
    expect(text).not.toContain('the organiser, the organiser');
    expect(text).toMatch(/emails your response to the organiser \(/);
  });

  test('decline with sendResponse=false without organiser details', async () => {
    mockReads(BARE);

    const result = await handleDeclineEvent({
      eventId: 'evt-1',
      sendResponse: false,
      dryRun: true,
    });

    const text = textOf(result);
    expect(text).not.toContain('the organiser, the organiser');
    expect(text).toContain(
      'without notifying the organiser (sendResponse=false)'
    );
  });

  test('delete as an attendee without organiser details', async () => {
    mockReads(BARE);

    const result = await handleDeleteEvent({ eventId: 'evt-1', dryRun: true });

    const text = textOf(result);
    expect(text).not.toContain('the organiser, the organiser');
    expect(text).toContain("Nobody is emailed: the organiser isn't told");
  });
});
