const handleCreateEvent = require('../../calendar/create');
const { DEFAULT_TIMEZONE } = require('../../config');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

describe('handleCreateEvent', () => {
  beforeEach(() => {
    // Reset mocks before each test
    callGraphAPI.mockClear();
    ensureAuthenticated.mockClear();
  });

  test('should use default timezone when no timezone is provided', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'test_event_id' });

    const args = {
      subject: 'Test Event',
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00',
    };

    await handleCreateEvent(args);

    expect(ensureAuthenticated).toHaveBeenCalledTimes(1);
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    const callGraphAPIArgs = callGraphAPI.mock.calls[0][3]; // bodyContent is the 4th argument
    expect(callGraphAPIArgs.start.timeZone).toBe(DEFAULT_TIMEZONE);
    expect(callGraphAPIArgs.end.timeZone).toBe(DEFAULT_TIMEZONE);
  });

  test('should use specified timezone when provided', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'test_event_id' });

    const specifiedTimeZone = 'Pacific Standard Time';
    const args = {
      subject: 'Test Event with Specific Timezone',
      start: { dateTime: '2024-03-10T10:00:00', timeZone: specifiedTimeZone },
      end: { dateTime: '2024-03-10T11:00:00', timeZone: specifiedTimeZone },
    };

    await handleCreateEvent(args);

    expect(ensureAuthenticated).toHaveBeenCalledTimes(1);
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    const callGraphAPIArgs = callGraphAPI.mock.calls[0][3]; // bodyContent is the 4th argument
    expect(callGraphAPIArgs.start.timeZone).toBe(specifiedTimeZone);
    expect(callGraphAPIArgs.end.timeZone).toBe(specifiedTimeZone);
  });

  test('should use default timezone if only start timezone is provided', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'test_event_id' });

    const specifiedTimeZone = 'Pacific Standard Time';
    const args = {
      subject: 'Test Event with Specific Start Timezone',
      start: { dateTime: '2024-03-10T10:00:00', timeZone: specifiedTimeZone },
      end: { dateTime: '2024-03-10T11:00:00' }, // No timezone for end
    };

    await handleCreateEvent(args);

    expect(ensureAuthenticated).toHaveBeenCalledTimes(1);
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    const callGraphAPIArgs = callGraphAPI.mock.calls[0][3];
    expect(callGraphAPIArgs.start.timeZone).toBe(specifiedTimeZone);
    expect(callGraphAPIArgs.end.timeZone).toBe(DEFAULT_TIMEZONE);
  });

  test('should use default timezone if only end timezone is provided', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'test_event_id' });

    const specifiedTimeZone = 'Pacific Standard Time';
    const args = {
      subject: 'Test Event with Specific End Timezone',
      start: { dateTime: '2024-03-10T10:00:00' }, // No timezone for start
      end: { dateTime: '2024-03-10T11:00:00', timeZone: specifiedTimeZone },
    };

    await handleCreateEvent(args);

    expect(ensureAuthenticated).toHaveBeenCalledTimes(1);
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    const callGraphAPIArgs = callGraphAPI.mock.calls[0][3];
    expect(callGraphAPIArgs.start.timeZone).toBe(DEFAULT_TIMEZONE);
    expect(callGraphAPIArgs.end.timeZone).toBe(specifiedTimeZone);
  });

  test('should return error if subject is missing', async () => {
    const args = {
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00',
    };

    const result = await handleCreateEvent(args);
    expect(result.content[0].text).toBe(
      'Subject, start, and end times are required to create an event.'
    );
    expect(ensureAuthenticated).not.toHaveBeenCalled();
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('should return error if start is missing', async () => {
    const args = {
      subject: 'Test Event',
      end: '2024-03-10T11:00:00',
    };

    const result = await handleCreateEvent(args);
    expect(result.content[0].text).toBe(
      'Subject, start, and end times are required to create an event.'
    );
    expect(ensureAuthenticated).not.toHaveBeenCalled();
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('should return error if end is missing', async () => {
    const args = {
      subject: 'Test Event',
      start: '2024-03-10T10:00:00',
    };

    const result = await handleCreateEvent(args);
    expect(result.content[0].text).toBe(
      'Subject, start, and end times are required to create an event.'
    );
    expect(ensureAuthenticated).not.toHaveBeenCalled();
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('should handle authentication error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));
    const args = {
      subject: 'Test Event',
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00',
    };

    const result = await handleCreateEvent(args);
    expect(result.content[0].text).toBe(
      "Authentication required. Please use the 'authenticate' tool first."
    );
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('should handle Graph API call error', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockRejectedValue(new Error('Graph API Error'));
    const args = {
      subject: 'Test Event',
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00',
    };

    const result = await handleCreateEvent(args);
    expect(result.content[0].text).toBe(
      'Error creating event: Graph API Error'
    );
  });

  describe('recurrence', () => {
    test('should add weekly recurrence with an end date to the Graph payload', async () => {
      ensureAuthenticated.mockResolvedValue('dummy_access_token');
      callGraphAPI.mockResolvedValue({
        id: 'test_event_id',
        recurrence: {
          pattern: {
            type: 'weekly',
            interval: 1,
            daysOfWeek: ['monday', 'wednesday', 'friday'],
            firstDayOfWeek: 'sunday',
          },
          range: {
            type: 'endDate',
            startDate: '2026-04-14',
            endDate: '2026-12-31',
            recurrenceTimeZone: DEFAULT_TIMEZONE,
          },
        },
      });

      const result = await handleCreateEvent({
        subject: 'Recurring Team Sync',
        start: '2026-04-14T09:00:00',
        end: '2026-04-14T09:30:00',
        recurrenceType: 'weekly',
        recurrenceDaysOfWeek: ['monday', 'wednesday', 'friday'],
        recurrenceEndDate: '2026-12-31',
      });

      const payload = callGraphAPI.mock.calls[0][3];
      expect(payload.recurrence).toEqual({
        pattern: {
          type: 'weekly',
          interval: 1,
          daysOfWeek: ['monday', 'wednesday', 'friday'],
          firstDayOfWeek: 'sunday',
        },
        range: {
          type: 'endDate',
          startDate: '2026-04-14',
          endDate: '2026-12-31',
          recurrenceTimeZone: DEFAULT_TIMEZONE,
        },
      });
      expect(result.content[0].text).toContain('**Recurrence**: weekly');
    });

    test('should add daily numbered recurrence to the Graph payload', async () => {
      ensureAuthenticated.mockResolvedValue('dummy_access_token');
      callGraphAPI.mockResolvedValue({ id: 'test_event_id' });

      await handleCreateEvent({
        subject: 'Daily Check-in',
        start: { dateTime: '2026-04-14T09:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-04-14T09:15:00', timeZone: 'UTC' },
        recurrenceType: 'daily',
        recurrenceInterval: 2,
        recurrenceCount: 5,
      });

      const payload = callGraphAPI.mock.calls[0][3];
      expect(payload.recurrence).toEqual({
        pattern: {
          type: 'daily',
          interval: 2,
        },
        range: {
          type: 'numbered',
          startDate: '2026-04-14',
          numberOfOccurrences: 5,
          recurrenceTimeZone: 'UTC',
        },
      });
    });

    test('should pass recurrenceRaw through with default recurrence timezone', async () => {
      ensureAuthenticated.mockResolvedValue('dummy_access_token');
      callGraphAPI.mockResolvedValue({ id: 'test_event_id' });

      await handleCreateEvent({
        subject: 'Quarterly Planning',
        start: '2026-04-15T10:00:00',
        end: '2026-04-15T11:00:00',
        recurrenceRaw: {
          pattern: {
            type: 'absoluteMonthly',
            interval: 3,
            dayOfMonth: 15,
          },
          range: {
            type: 'numbered',
            startDate: '2026-04-15',
            numberOfOccurrences: 4,
          },
        },
      });

      const payload = callGraphAPI.mock.calls[0][3];
      expect(payload.recurrence.range.recurrenceTimeZone).toBe(
        DEFAULT_TIMEZONE
      );
      expect(payload.recurrence.pattern.type).toBe('absoluteMonthly');
    });

    test('should omit recurrence when recurrence parameters are absent', async () => {
      ensureAuthenticated.mockResolvedValue('dummy_access_token');
      callGraphAPI.mockResolvedValue({ id: 'test_event_id' });

      await handleCreateEvent({
        subject: 'One-off Event',
        start: '2026-04-14T09:00:00',
        end: '2026-04-14T10:00:00',
      });

      const payload = callGraphAPI.mock.calls[0][3];
      expect(payload).not.toHaveProperty('recurrence');
    });

    test('should reject invalid recurrence combinations before Graph call', async () => {
      const result = await handleCreateEvent({
        subject: 'Invalid Event',
        start: '2026-04-14T09:00:00',
        end: '2026-04-14T10:00:00',
        recurrenceType: 'daily',
        recurrenceDaysOfWeek: ['monday'],
      });

      expect(result.content[0].text).toContain(
        'recurrenceDaysOfWeek can only be used with recurrenceType=weekly'
      );
      expect(ensureAuthenticated).not.toHaveBeenCalled();
      expect(callGraphAPI).not.toHaveBeenCalled();
    });

    test('should map simplified monthly recurrence from the start date', () => {
      expect(
        handleCreateEvent.buildRecurrence(
          {
            recurrenceType: 'monthly',
            recurrenceInterval: 3,
            recurrenceCount: 4,
          },
          '2026-04-15T10:00:00',
          DEFAULT_TIMEZONE
        )
      ).toEqual({
        pattern: {
          type: 'absoluteMonthly',
          interval: 3,
          dayOfMonth: 15,
        },
        range: {
          type: 'numbered',
          startDate: '2026-04-15',
          numberOfOccurrences: 4,
          recurrenceTimeZone: DEFAULT_TIMEZONE,
        },
      });
    });

    test('should map simplified yearly recurrence from the start date', () => {
      expect(
        handleCreateEvent.buildRecurrence(
          {
            recurrenceType: 'yearly',
            recurrenceEndDate: '2028-04-15',
          },
          '2026-04-15T10:00:00',
          DEFAULT_TIMEZONE
        ).pattern
      ).toEqual({
        type: 'absoluteYearly',
        interval: 1,
        dayOfMonth: 15,
        month: 4,
      });
    });
  });
});
