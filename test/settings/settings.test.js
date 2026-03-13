const {
  handleGetMailboxSettings,
  handleGetAutomaticReplies,
  handleSetAutomaticReplies,
  handleGetWorkingHours,
  handleSetWorkingHours,
} = require('../../settings');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const mockAccessToken = 'test_token';

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
});

afterEach(() => {
  console.error.mockRestore();
});

describe('handleGetMailboxSettings', () => {
  const mockSettings = {
    language: { locale: 'en-AU', displayName: 'English (Australia)' },
    timeZone: 'AUS Eastern Standard Time',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: 'h:mm tt',
    workingHours: {
      startTime: '09:00:00.0000000',
      endTime: '17:00:00.0000000',
      daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      timeZone: { name: 'AUS Eastern Standard Time' },
    },
    automaticRepliesSetting: {
      status: 'disabled',
    },
    delegateMeetingMessageDeliveryOptions:
      'sendToDelegateAndInformationToPrincipal',
  };

  it('should return all settings by default', async () => {
    callGraphAPI.mockResolvedValue(mockSettings);

    const result = await handleGetMailboxSettings({});

    expect(result.content[0].text).toContain('Mailbox Settings');
    expect(result.content[0].text).toContain('en-AU');
    expect(result.content[0].text).toContain('AUS Eastern Standard Time');
    expect(result.content[0].text).toContain('dd/MM/yyyy');
    expect(result._meta.settings).toEqual(mockSettings);
  });

  it('should return specific section when requested', async () => {
    callGraphAPI.mockResolvedValue({
      locale: 'en-AU',
      displayName: 'English (Australia)',
    });

    const result = await handleGetMailboxSettings({ section: 'language' });

    expect(result.content[0].text).toContain('Language');
    expect(result.content[0].text).toContain('en-AU');
    // Should be formatted, not raw JSON
    expect(result.content[0].text).not.toContain('```json');
  });

  it('should format workingHours section', async () => {
    callGraphAPI.mockResolvedValue({
      startTime: '09:00:00.0000000',
      endTime: '17:00:00.0000000',
      daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      timeZone: { name: 'AUS Eastern Standard Time' },
    });

    const result = await handleGetMailboxSettings({
      section: 'workingHours',
    });

    expect(result.content[0].text).toContain('09:00');
    expect(result.content[0].text).toContain('17:00');
    expect(result.content[0].text).not.toContain('```json');
  });

  it('should format automaticRepliesSetting section', async () => {
    callGraphAPI.mockResolvedValue({
      status: 'disabled',
    });

    const result = await handleGetMailboxSettings({
      section: 'automaticRepliesSetting',
    });

    expect(result.content[0].text).toContain('Disabled');
    expect(result.content[0].text).not.toContain('```json');
  });

  it('should format timeZone section from Graph API object response', async () => {
    // Graph API returns { value: "timezone string" } for scalar properties
    callGraphAPI.mockResolvedValue({
      '@odata.context':
        "https://graph.microsoft.com/v1.0/$metadata#users('user-id')/mailboxSettings/timeZone",
      value: 'AUS Eastern Standard Time',
    });

    const result = await handleGetMailboxSettings({ section: 'timeZone' });

    expect(result.content[0].text).toContain('AUS Eastern Standard Time');
    expect(result.content[0].text).not.toContain('[object Object]');
    expect(result.content[0].text).not.toContain('```json');
  });

  it('should format timeZone section from plain string response', async () => {
    // Backwards compatibility: handle plain string response
    callGraphAPI.mockResolvedValue('AUS Eastern Standard Time');

    const result = await handleGetMailboxSettings({ section: 'timeZone' });

    expect(result.content[0].text).toContain('AUS Eastern Standard Time');
    expect(result.content[0].text).not.toContain('```json');
  });

  it('should treat section "all" same as no section', async () => {
    callGraphAPI.mockResolvedValue(mockSettings);

    const result = await handleGetMailboxSettings({ section: 'all' });

    expect(result.content[0].text).toContain('Mailbox Settings');
    expect(result.content[0].text).toContain('Language');
  });

  it('should format working hours in all settings', async () => {
    callGraphAPI.mockResolvedValue(mockSettings);

    const result = await handleGetMailboxSettings({});

    expect(result.content[0].text).toContain('Working Hours');
    expect(result.content[0].text).toContain('09:00');
    expect(result.content[0].text).toContain('17:00');
  });

  it('should format automatic replies in all settings', async () => {
    callGraphAPI.mockResolvedValue({
      ...mockSettings,
      automaticRepliesSetting: {
        status: 'alwaysEnabled',
        internalReplyMessage: 'I am out of office',
        externalReplyMessage: 'External reply',
        externalAudience: 'all',
      },
    });

    const result = await handleGetMailboxSettings({});

    expect(result.content[0].text).toContain('Automatic Replies');
    expect(result.content[0].text).toContain('Always Enabled');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleGetMailboxSettings({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Settings fetch failed'));

    const result = await handleGetMailboxSettings({});

    expect(result.content[0].text).toBe(
      'Error getting mailbox settings: Settings fetch failed'
    );
  });
});

describe('handleGetAutomaticReplies', () => {
  it('should return auto-reply settings when disabled', async () => {
    callGraphAPI.mockResolvedValue({ status: 'disabled' });

    const result = await handleGetAutomaticReplies({});

    expect(result.content[0].text).toContain('Automatic Replies');
    expect(result.content[0].text).toContain('Disabled');
    expect(result._meta.settings.status).toBe('disabled');
  });

  it('should return auto-reply settings when always enabled', async () => {
    callGraphAPI.mockResolvedValue({
      status: 'alwaysEnabled',
      internalReplyMessage: 'Out of office',
      externalReplyMessage: 'Away from desk',
      externalAudience: 'all',
    });

    const result = await handleGetAutomaticReplies({});

    expect(result.content[0].text).toContain('Always Enabled');
    expect(result.content[0].text).toContain('Out of office');
    expect(result.content[0].text).toContain('Away from desk');
  });

  it('should return scheduled auto-reply settings', async () => {
    callGraphAPI.mockResolvedValue({
      status: 'scheduled',
      scheduledStartDateTime: {
        dateTime: '2024-12-20T00:00:00Z',
      },
      scheduledEndDateTime: {
        dateTime: '2024-12-31T23:59:59Z',
      },
      internalReplyMessage: 'On holiday',
      externalAudience: 'contactsOnly',
    });

    const result = await handleGetAutomaticReplies({});

    expect(result.content[0].text).toContain('Scheduled');
    expect(result.content[0].text).toContain('On holiday');
    expect(result.content[0].text).toContain('contactsOnly');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleGetAutomaticReplies({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('API Error'));

    const result = await handleGetAutomaticReplies({});

    expect(result.content[0].text).toBe(
      'Error getting automatic replies: API Error'
    );
  });
});

describe('handleSetAutomaticReplies', () => {
  it('should disable auto-replies', async () => {
    callGraphAPI
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({ status: 'disabled' }); // GET updated

    const result = await handleSetAutomaticReplies({ enabled: false });

    expect(result.content[0].text).toContain('updated');
    expect(result.content[0].text).toContain('Disabled');
  });

  it('should enable auto-replies always', async () => {
    callGraphAPI
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        status: 'alwaysEnabled',
        internalReplyMessage: 'I am away',
      }); // GET updated

    const result = await handleSetAutomaticReplies({
      enabled: true,
      internalReplyMessage: 'I am away',
    });

    expect(result.content[0].text).toContain('updated');
    expect(result.content[0].text).toContain('Always Enabled');
  });

  it('should set scheduled auto-replies', async () => {
    callGraphAPI
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        status: 'scheduled',
        scheduledStartDateTime: {
          dateTime: '2024-12-20T00:00:00.000Z',
        },
        scheduledEndDateTime: {
          dateTime: '2024-12-31T23:59:59.000Z',
        },
      }); // GET updated

    const result = await handleSetAutomaticReplies({
      startDateTime: '2024-12-20T00:00:00Z',
      endDateTime: '2024-12-31T23:59:59Z',
    });

    expect(result.content[0].text).toContain('updated');
    expect(result.content[0].text).toContain('Scheduled');
  });

  it('should warn when enabling without messages and no existing messages', async () => {
    callGraphAPI
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        status: 'alwaysEnabled',
      }); // GET updated — no messages

    const result = await handleSetAutomaticReplies({ enabled: true });

    expect(result.content[0].text).toContain('Warning');
    expect(result.content[0].text).toContain('no message configured');
  });

  it('should note when reusing previously configured message', async () => {
    callGraphAPI
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        status: 'alwaysEnabled',
        internalReplyMessage: 'I am out of office until Monday',
      }); // GET updated — has existing message

    const result = await handleSetAutomaticReplies({ enabled: true });

    expect(result.content[0].text).toContain('Note');
    expect(result.content[0].text).toContain('previously configured');
    expect(result.content[0].text).toContain('I am out of office');
  });

  it('should not warn when messages are provided', async () => {
    callGraphAPI
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        status: 'alwaysEnabled',
        internalReplyMessage: 'New message',
      }); // GET updated

    const result = await handleSetAutomaticReplies({
      enabled: true,
      internalReplyMessage: 'New message',
    });

    expect(result.content[0].text).not.toContain('Warning');
    expect(result.content[0].text).not.toContain('Note');
  });

  it('should reject invalid externalAudience', async () => {
    const result = await handleSetAutomaticReplies({
      externalAudience: 'invalid',
    });

    expect(result.content[0].text).toContain(
      "externalAudience must be 'none', 'contactsOnly', or 'all'"
    );
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleSetAutomaticReplies({ enabled: false });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('PATCH failed'));

    const result = await handleSetAutomaticReplies({ enabled: true });

    expect(result.content[0].text).toBe(
      'Error setting automatic replies: PATCH failed'
    );
  });
});

describe('handleGetWorkingHours', () => {
  it('should return working hours', async () => {
    callGraphAPI.mockResolvedValue({
      startTime: '09:00:00.0000000',
      endTime: '17:00:00.0000000',
      daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      timeZone: { name: 'AUS Eastern Standard Time' },
    });

    const result = await handleGetWorkingHours({});

    expect(result.content[0].text).toContain('Working Hours');
    expect(result.content[0].text).toContain('09:00');
    expect(result.content[0].text).toContain('17:00');
    expect(result.content[0].text).toContain('Monday');
    expect(result._meta.settings).toBeDefined();
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleGetWorkingHours({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('API Error'));

    const result = await handleGetWorkingHours({});

    expect(result.content[0].text).toBe(
      'Error getting working hours: API Error'
    );
  });
});

describe('handleSetWorkingHours', () => {
  const currentHours = {
    startTime: '09:00:00.0000000',
    endTime: '17:00:00.0000000',
    daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    timeZone: { name: 'AUS Eastern Standard Time' },
  };

  it('should update start and end time', async () => {
    callGraphAPI
      .mockResolvedValueOnce(currentHours) // GET current
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        ...currentHours,
        startTime: '08:00:00.0000000',
        endTime: '16:00:00.0000000',
      }); // GET updated

    const result = await handleSetWorkingHours({
      startTime: '08:00',
      endTime: '16:00',
    });

    expect(result.content[0].text).toContain('updated');
    expect(result.content[0].text).toContain('08:00');
  });

  it('should update days of week', async () => {
    callGraphAPI
      .mockResolvedValueOnce(currentHours) // GET current
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        ...currentHours,
        daysOfWeek: ['monday', 'wednesday', 'friday'],
      }); // GET updated

    const result = await handleSetWorkingHours({
      daysOfWeek: ['Monday', 'Wednesday', 'Friday'],
    });

    expect(result.content[0].text).toContain('updated');
    expect(result.content[0].text).toContain('Monday');
  });

  it('should update timezone', async () => {
    callGraphAPI
      .mockResolvedValueOnce(currentHours) // GET current
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        ...currentHours,
        timeZone: { name: 'Pacific Standard Time' },
      }); // GET updated

    const result = await handleSetWorkingHours({
      timeZone: 'Pacific Standard Time',
    });

    expect(result.content[0].text).toContain('updated');
    expect(result.content[0].text).toContain('Pacific Standard Time');
  });

  it('should require at least one parameter', async () => {
    const result = await handleSetWorkingHours({});

    expect(result.content[0].text).toContain(
      'At least one of startTime, endTime, daysOfWeek, or timeZone is required'
    );
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  it('should validate startTime format', async () => {
    const result = await handleSetWorkingHours({ startTime: 'invalid' });

    expect(result.content[0].text).toContain('HH:MM or HH:MM:SS format');
  });

  it('should validate endTime format', async () => {
    const result = await handleSetWorkingHours({ endTime: '25:00' });

    expect(result.content[0].text).toContain('HH:MM or HH:MM:SS format');
  });

  it('should validate days of week', async () => {
    const result = await handleSetWorkingHours({
      daysOfWeek: ['monday', 'funday'],
    });

    expect(result.content[0].text).toContain('Invalid days');
    expect(result.content[0].text).toContain('funday');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleSetWorkingHours({ startTime: '09:00' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Update failed'));

    const result = await handleSetWorkingHours({ startTime: '09:00' });

    expect(result.content[0].text).toBe(
      'Error setting working hours: Update failed'
    );
  });
});
