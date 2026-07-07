const handleListEvents = require('../../calendar/list');
const handleDeclineEvent = require('../../calendar/decline');
const handleCancelEvent = require('../../calendar/cancel');
const handleDeleteEvent = require('../../calendar/delete');
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

  it('should include timezone information for listed event times', async () => {
    callGraphAPI.mockResolvedValue({ value: mockEvents });

    const result = await handleListEvents({});

    expect(result.content[0].text).toContain(
      'Start: 15 Jan 2024, 8:00 pm (Australia/Melbourne)'
    );
    expect(result.content[0].text).toContain(
      'End: 15 Jan 2024, 8:30 pm (Australia/Melbourne)'
    );
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
