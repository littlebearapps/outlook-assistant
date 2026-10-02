const handleListEvents = require('../../calendar/list');
const handleDeclineEvent = require('../../calendar/decline');
const handleCancelEvent = require('../../calendar/cancel');
const handleDeleteEvent = require('../../calendar/delete');
const { calendarTools } = require('../../calendar');
const { coerceArgsAgainstSchema } = require('../../utils/schema-coerce');
const fs = require('fs');
const path = require('path');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const mockAccessToken = 'test_token';

const mockEvents = [
  {
    id: 'event-1',
    subject: 'Team Standup',
    bodyPreview: 'Daily standup meeting',
    start: { dateTime: '2024-01-15T09:00:00', timeZone: 'UTC' },
    end: { dateTime: '2024-01-15T09:30:00', timeZone: 'UTC' },
    location: { displayName: 'Room A' },
    organizer: {
      emailAddress: { name: 'Alice', address: 'alice@company.com' },
    },
  },
  {
    id: 'event-2',
    subject: 'Sprint Planning',
    bodyPreview: 'Plan next sprint',
    start: { dateTime: '2024-01-15T14:00:00', timeZone: 'UTC' },
    end: { dateTime: '2024-01-15T15:00:00', timeZone: 'UTC' },
    location: { displayName: '' },
    organizer: {
      emailAddress: { name: 'Bob', address: 'bob@company.com' },
    },
  },
];

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
});

afterEach(() => {
  console.error.mockRestore();
});

describe('handleListEvents', () => {
  it('should list upcoming events', async () => {
    callGraphAPI.mockResolvedValue({ value: mockEvents });

    const result = await handleListEvents({});

    expect(result.content[0].text).toContain('Found 2 events');
    expect(result.content[0].text).toContain('Team Standup');
    expect(result.content[0].text).toContain('Sprint Planning');
  });

  it('should handle empty events', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleListEvents({});

    expect(result.content[0].text).toContain('No calendar events found');
  });

  it('should handle missing value in response', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleListEvents({});

    expect(result.content[0].text).toContain('No calendar events found');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleListEvents({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Calendar API failed'));

    const result = await handleListEvents({});

    expect(result.content[0].text).toBe(
      'Error listing events: Calendar API failed'
    );
  });
});

describe('handleDeclineEvent', () => {
  it('should decline an event', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleDeclineEvent({ eventId: 'event-1' });

    expect(result.content[0].text).toContain('successfully declined');
    expect(result.content[0].text).toContain('event-1');
  });

  it('should decline with a custom comment', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleDeclineEvent({
      eventId: 'event-1',
      comment: 'Cannot attend',
    });

    expect(result.content[0].text).toContain('successfully declined');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/events/event-1/decline',
      { comment: 'Cannot attend' }
    );
  });

  it('should require event ID', async () => {
    const result = await handleDeclineEvent({});

    expect(result.content[0].text).toContain('Event ID is required');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleDeclineEvent({ eventId: 'event-1' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Decline failed'));

    const result = await handleDeclineEvent({ eventId: 'event-1' });

    expect(result.content[0].text).toBe(
      'Error declining event: Decline failed'
    );
  });
});

describe('handleCancelEvent', () => {
  it('should cancel an event', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleCancelEvent({ eventId: 'event-1' });

    expect(result.content[0].text).toContain('successfully cancelled');
    expect(result.content[0].text).toContain('event-1');
  });

  it('should cancel with a custom comment', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleCancelEvent({
      eventId: 'event-1',
      comment: 'Meeting postponed',
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/events/event-1/cancel',
      { comment: 'Meeting postponed' }
    );
  });

  it('should require event ID', async () => {
    const result = await handleCancelEvent({});

    expect(result.content[0].text).toContain('Event ID is required');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleCancelEvent({ eventId: 'event-1' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Cancel failed'));

    const result = await handleCancelEvent({ eventId: 'event-1' });

    expect(result.content[0].text).toBe(
      'Error cancelling event: Cancel failed'
    );
  });
});

describe('handleDeleteEvent', () => {
  it('should delete an event', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleDeleteEvent({ eventId: 'event-1' });

    expect(result.content[0].text).toContain('successfully deleted');
    expect(result.content[0].text).toContain('event-1');
  });

  it('should require event ID', async () => {
    const result = await handleDeleteEvent({});

    expect(result.content[0].text).toContain('Event ID is required');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleDeleteEvent({ eventId: 'event-1' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Delete failed'));

    const result = await handleDeleteEvent({ eventId: 'event-1' });

    expect(result.content[0].text).toBe('Error deleting event: Delete failed');
  });
});

// #242: decline/cancel must not send boilerplate, and decline exposes sendResponse
describe('manage-event decline/cancel request bodies (#242)', () => {
  const manageEvent = calendarTools.find((t) => t.name === 'manage-event');

  function callManageEvent(rawArgs) {
    const coerced = coerceArgsAgainstSchema(rawArgs, manageEvent.inputSchema);
    expect(coerced.error).toBeUndefined();
    return manageEvent.handler(coerced.args);
  }

  it('decline without a comment sends an empty body', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleDeclineEvent({ eventId: 'event-1' });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/events/event-1/decline',
      {}
    );
  });

  it('cancel without a comment sends an empty body', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleCancelEvent({ eventId: 'event-1' });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/events/event-1/cancel',
      {}
    );
  });

  it('omits an empty comment on decline and cancel', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleDeclineEvent({ eventId: 'event-1', comment: '' });
    await handleCancelEvent({ eventId: 'event-1', comment: '   ' });

    expect(callGraphAPI.mock.calls[0][3]).toEqual({});
    expect(callGraphAPI.mock.calls[1][3]).toEqual({});
  });

  it('decline passes sendResponse: false through', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleDeclineEvent({ eventId: 'event-1', sendResponse: false });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/events/event-1/decline',
      { sendResponse: false }
    );
  });

  it('decline sends comment and sendResponse: true together', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleDeclineEvent({
      eventId: 'event-1',
      comment: 'Cannot attend',
      sendResponse: true,
    });

    expect(callGraphAPI.mock.calls[0][3]).toEqual({
      comment: 'Cannot attend',
      sendResponse: true,
    });
  });

  it('manage-event coerces sendResponse "false" to a boolean on decline', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await callManageEvent({
      action: 'decline',
      eventId: 'event-1',
      sendResponse: 'false',
    });

    expect(result.content[0].text).toContain('successfully declined');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/events/event-1/decline',
      { sendResponse: false }
    );
  });

  it('manage-event cancel does not forward sendResponse (decline only)', async () => {
    callGraphAPI.mockResolvedValue({});

    await callManageEvent({
      action: 'cancel',
      eventId: 'event-1',
      sendResponse: false,
    });

    expect(callGraphAPI.mock.calls[0][3]).toEqual({});
  });

  it('manage-event schema exposes a boolean sendResponse for decline', () => {
    const { sendResponse, comment } = manageEvent.inputSchema.properties;
    expect(sendResponse.type).toBe('boolean');
    expect(sendResponse.description).toMatch(/decline only/);
    expect(comment.description).toMatch(/omitted if not given/);
  });

  it('no calendar source file contains "via API" boilerplate', () => {
    const dir = path.join(__dirname, '../../calendar');
    const offenders = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) =>
        fs.readFileSync(path.join(dir, f), 'utf8').includes('via API')
      );
    expect(offenders).toEqual([]);
  });
});
