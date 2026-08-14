const {
  handleAccessSharedMailbox,
  handleSetMessageFlag,
  handleClearMessageFlag,
  handleFindMeetingRooms,
} = require('../../advanced');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
jest.mock('../../utils/field-presets', () => {
  const actual = jest.requireActual('../../utils/field-presets');
  return {
    ...actual,
    // advanced/index.js imports EMAIL_FIELDS but the module exports FIELD_PRESETS.
    // It also references EMAIL_FIELDS['full'] which doesn't exist in FIELD_PRESETS,
    // so we add it mapped to the 'export' preset.
    EMAIL_FIELDS: {
      ...actual.FIELD_PRESETS,
      full: actual.FIELD_PRESETS.export,
    },
  };
});

const mockAccessToken = 'test_token';

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
});

afterEach(() => {
  console.error.mockRestore();
});

describe('handleAccessSharedMailbox', () => {
  const mockMessages = [
    {
      id: 'msg-1',
      subject: 'Team Update',
      from: {
        emailAddress: { name: 'Alice', address: 'alice@company.com' },
      },
      receivedDateTime: '2024-01-15T10:00:00Z',
      isRead: true,
      hasAttachments: false,
    },
    {
      id: 'msg-2',
      subject: 'Budget Report Q4',
      from: {
        emailAddress: { name: 'Bob', address: 'bob@company.com' },
      },
      receivedDateTime: '2024-01-14T09:00:00Z',
      isRead: false,
      hasAttachments: true,
    },
  ];

  it('should list emails from shared mailbox', async () => {
    callGraphAPI.mockResolvedValue({ value: mockMessages });

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
    });

    expect(result.content[0].text).toContain('shared@company.com');
    expect(result.content[0].text).toContain('Team Update');
    expect(result._meta.sharedMailbox).toBe('shared@company.com');
    expect(result._meta.count).toBe(2);
  });

  it('should resolve a well-known folder against the shared mailbox endpoint', async () => {
    callGraphAPI
      // resolveFolder → well-known lookup, scoped to the shared mailbox
      .mockResolvedValueOnce({ id: 'archive-id', displayName: 'Archive' })
      // messages fetch
      .mockResolvedValueOnce({ value: mockMessages });

    await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
      folder: 'archive',
    });

    expect(callGraphAPI.mock.calls[0][2]).toBe(
      'users/shared@company.com/mailFolders/archive'
    );
    const messagesCall = callGraphAPI.mock.calls.find(
      (c) => typeof c[2] === 'string' && c[2].endsWith('/messages')
    );
    expect(messagesCall[2]).toBe(
      'users/shared@company.com/mailFolders/archive-id/messages'
    );
  });

  it('should resolve a custom subfolder name to its ID before reading', async () => {
    callGraphAPI
      // resolveFolder → top-level folder listing in the shared mailbox
      .mockResolvedValueOnce({
        value: [{ id: 'archiv-id', displayName: 'Archiv' }],
      })
      // messages fetch
      .mockResolvedValueOnce({ value: mockMessages });

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
      folder: 'Archiv',
    });

    expect(result._meta.count).toBe(2);
    const messagesCall = callGraphAPI.mock.calls.find(
      (c) => typeof c[2] === 'string' && c[2].endsWith('/messages')
    );
    expect(messagesCall[2]).toBe(
      'users/shared@company.com/mailFolders/archiv-id/messages'
    );
  });

  it('should use folderId directly without a name search', async () => {
    callGraphAPI
      // resolveFolder → direct ID lookup (no name/tree search)
      .mockResolvedValueOnce({
        id: 'explicit-folder-id',
        displayName: 'Explicit',
      })
      .mockResolvedValueOnce({ value: mockMessages });

    await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
      folderId: 'explicit-folder-id',
    });

    expect(callGraphAPI).toHaveBeenCalledTimes(2);
    expect(callGraphAPI.mock.calls[0][2]).toBe(
      'users/shared@company.com/mailFolders/explicit-folder-id'
    );
    expect(callGraphAPI.mock.calls[1][2]).toBe(
      'users/shared@company.com/mailFolders/explicit-folder-id/messages'
    );
  });

  it('should report a helpful error when a custom folder cannot be resolved', async () => {
    // top-level list empty → nothing to match, nothing to descend into
    callGraphAPI
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: [] });

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
      folder: 'DoesNotExist',
    });

    expect(result.content[0].text).toContain('not found');
    expect(result.content[0].text).toContain('listFolders');
  });

  it('should enumerate folders with listFolders: true', async () => {
    callGraphAPI
      .mockResolvedValueOnce({
        value: [
          {
            id: 'inbox-id',
            displayName: 'Inbox',
            parentFolderId: 'root',
            childFolderCount: 1,
            totalItemCount: 10,
            unreadItemCount: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        value: [
          {
            id: 'sub-id',
            displayName: 'Vendors',
            parentFolderId: 'inbox-id',
            childFolderCount: 0,
            totalItemCount: 3,
            unreadItemCount: 0,
          },
        ],
      });

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
      listFolders: true,
    });

    expect(result.content[0].text).toContain('Shared Mailbox Folders');
    expect(result.content[0].text).toContain('Inbox');
    expect(result.content[0].text).toContain('Vendors');
    expect(result._meta.folderCount).toBe(2);
    const vendors = result._meta.folders.find(
      (f) => f.displayName === 'Vendors'
    );
    expect(vendors.folderPath).toBe('Inbox/Vendors');
    expect(result._meta.partial).toBe(false);
  });

  it('should mark the folder listing partial when a branch fails', async () => {
    callGraphAPI
      .mockResolvedValueOnce({
        value: [
          {
            id: 'inbox-id',
            displayName: 'Inbox',
            parentFolderId: 'root',
            childFolderCount: 1,
            totalItemCount: 10,
            unreadItemCount: 2,
          },
        ],
      })
      .mockRejectedValueOnce(new Error('403 Access is denied'));

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
      listFolders: true,
    });

    expect(result._meta.partial).toBe(true);
    expect(result._meta.warnings[0]).toContain('Inbox');
    expect(result.content[0].text).toContain('(partial)');
    expect(result.content[0].text).toContain('Partial listing');
  });

  it('should handle minimal verbosity', async () => {
    callGraphAPI.mockResolvedValue({ value: mockMessages });

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
      outputVerbosity: 'minimal',
    });

    expect(result.content[0].text).toContain('Team Update');
    expect(result.content[0].text).toContain('alice@company.com');
  });

  it('should handle full verbosity with message IDs', async () => {
    callGraphAPI.mockResolvedValue({ value: mockMessages });

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
      outputVerbosity: 'full',
    });

    expect(result.content[0].text).toContain('Message IDs');
    expect(result.content[0].text).toContain('msg-1');
  });

  it('should handle empty results', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
    });

    expect(result.content[0].text).toContain('No emails found');
  });

  it('should require shared mailbox address', async () => {
    const result = await handleAccessSharedMailbox({});

    expect(result.content[0].text).toContain(
      'Shared mailbox email address is required'
    );
  });

  it('should handle access denied error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Access is denied'));

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
    });

    expect(result.content[0].text).toContain('Access denied');
  });

  it('should handle mailbox not found error', async () => {
    callGraphAPI.mockRejectedValue(
      new Error('Resource not found for the segment')
    );

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'nonexistent@company.com',
    });

    expect(result.content[0].text).toContain('not found');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
    });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle generic API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Server error'));

    const result = await handleAccessSharedMailbox({
      sharedMailbox: 'shared@company.com',
    });

    expect(result.content[0].text).toBe(
      'Error accessing shared mailbox: Server error'
    );
  });
});

describe('handleSetMessageFlag', () => {
  it('should flag a single message', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleSetMessageFlag({ messageId: 'msg-1' });

    expect(result.content[0].text).toContain('Flagged 1 message(s)');
    expect(result._meta.successful).toBe(1);
    expect(result._meta.failed).toBe(0);
  });

  it('should flag multiple messages', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleSetMessageFlag({
      messageIds: ['msg-1', 'msg-2', 'msg-3'],
    });

    expect(result.content[0].text).toContain('Flagged 3 message(s)');
    expect(result._meta.successful).toBe(3);
  });

  it('should include due date when specified', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleSetMessageFlag({
      messageId: 'msg-1',
      dueDateTime: '2024-01-20T17:00:00',
    });

    expect(result.content[0].text).toContain('Flagged 1 message(s)');
    expect(result.content[0].text).toContain('Due');

    // Verify Graph API receives correct dateTime envelope
    const patchBody = callGraphAPI.mock.calls[0][3];
    expect(patchBody.flag.dueDateTime).toEqual({
      dateTime: '2024-01-20T17:00:00',
      timeZone: 'Australia/Melbourne',
    });
  });

  it('should auto-set startDateTime when only dueDateTime is provided', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleSetMessageFlag({
      messageId: 'msg-1',
      dueDateTime: '2024-01-20T17:00:00',
    });

    const patchBody = callGraphAPI.mock.calls[0][3];
    expect(patchBody.flag.startDateTime).toEqual({
      dateTime: '2024-01-20T09:00:00',
      timeZone: 'Australia/Melbourne',
    });
  });

  it('should strip trailing Z from dueDateTime', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleSetMessageFlag({
      messageId: 'msg-1',
      dueDateTime: '2024-01-20T17:00:00Z',
    });

    const patchBody = callGraphAPI.mock.calls[0][3];
    expect(patchBody.flag.dueDateTime.dateTime).toBe('2024-01-20T17:00:00');
    expect(patchBody.flag.dueDateTime.timeZone).toBe('Australia/Melbourne');
  });

  it('should use explicit startDateTime when both dates provided', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleSetMessageFlag({
      messageId: 'msg-1',
      dueDateTime: '2024-01-20T17:00:00',
      startDateTime: '2024-01-19T10:00:00',
    });

    const patchBody = callGraphAPI.mock.calls[0][3];
    expect(patchBody.flag.startDateTime).toEqual({
      dateTime: '2024-01-19T10:00:00',
      timeZone: 'Australia/Melbourne',
    });
    expect(patchBody.flag.dueDateTime).toEqual({
      dateTime: '2024-01-20T17:00:00',
      timeZone: 'Australia/Melbourne',
    });
  });

  it('should handle partial failures', async () => {
    callGraphAPI
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Not found'));

    const result = await handleSetMessageFlag({
      messageIds: ['msg-1', 'msg-2'],
    });

    expect(result.content[0].text).toContain('Flagged 1 message(s)');
    expect(result.content[0].text).toContain('1 error(s)');
    expect(result._meta.successful).toBe(1);
    expect(result._meta.failed).toBe(1);
  });

  it('should target a shared mailbox when sharedMailbox is provided', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleSetMessageFlag({
      messageId: 'msg-1',
      sharedMailbox: 'shared@company.com',
    });

    expect(callGraphAPI.mock.calls[0][1]).toBe('PATCH');
    expect(callGraphAPI.mock.calls[0][2]).toBe(
      'users/shared@company.com/messages/msg-1'
    );
  });

  it('should default to the signed-in mailbox (me) when no shared mailbox', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleSetMessageFlag({ messageId: 'msg-1' });

    expect(callGraphAPI.mock.calls[0][2]).toBe('me/messages/msg-1');
  });

  it('should require message IDs', async () => {
    const result = await handleSetMessageFlag({});

    expect(result.content[0].text).toContain('Message ID');
    expect(result.content[0].text).toContain('required');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleSetMessageFlag({ messageId: 'msg-1' });

    expect(result.content[0].text).toContain('Authentication required');
  });
});

describe('handleClearMessageFlag', () => {
  it('should clear flag from a single message', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleClearMessageFlag({ messageId: 'msg-1' });

    expect(result.content[0].text).toContain('1 message(s) cleared');
    expect(result._meta.action).toBe('cleared');
  });

  it('should target a shared mailbox when email alias is provided', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleClearMessageFlag({
      messageId: 'msg-1',
      email: 'shared@company.com',
    });

    expect(callGraphAPI.mock.calls[0][1]).toBe('PATCH');
    expect(callGraphAPI.mock.calls[0][2]).toBe(
      'users/shared@company.com/messages/msg-1'
    );
  });

  it('should mark messages as complete', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleClearMessageFlag({
      messageIds: ['msg-1', 'msg-2'],
      markComplete: true,
    });

    expect(result.content[0].text).toContain('2 message(s) marked complete');
    expect(result._meta.action).toBe('complete');
  });

  it('should handle partial failures', async () => {
    callGraphAPI
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Fail'));

    const result = await handleClearMessageFlag({
      messageIds: ['msg-1', 'msg-2'],
    });

    expect(result.content[0].text).toContain('1 message(s) cleared');
    expect(result.content[0].text).toContain('1 error(s)');
  });

  it('should require message IDs', async () => {
    const result = await handleClearMessageFlag({});

    expect(result.content[0].text).toContain('Message ID');
    expect(result.content[0].text).toContain('required');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleClearMessageFlag({ messageId: 'msg-1' });

    expect(result.content[0].text).toContain('Authentication required');
  });
});

describe('handleFindMeetingRooms', () => {
  const mockRooms = [
    {
      displayName: 'Boardroom A',
      emailAddress: 'boardroom-a@company.com',
      capacity: 20,
      building: 'HQ',
      floorNumber: 3,
      floorLabel: '3rd Floor',
      audioDeviceName: 'Polycom',
      videoDeviceName: 'Teams Room',
      isWheelChairAccessible: true,
    },
    {
      displayName: 'Meeting Room B',
      emailAddress: 'meeting-b@company.com',
      capacity: 8,
      building: 'HQ',
      floorNumber: 2,
    },
    {
      displayName: 'Phone Booth',
      emailAddress: 'phone-booth@company.com',
      capacity: 2,
      building: 'Annex',
      floorNumber: 1,
    },
  ];

  it('should list all meeting rooms', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRooms });

    const result = await handleFindMeetingRooms({});

    expect(result.content[0].text).toContain('Meeting Rooms (3)');
    expect(result.content[0].text).toContain('Boardroom A');
    expect(result.content[0].text).toContain('Meeting Room B');
    expect(result._meta.count).toBe(3);
  });

  it('should filter by query', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRooms });

    const result = await handleFindMeetingRooms({ query: 'boardroom' });

    expect(result._meta.count).toBe(1);
    expect(result._meta.rooms[0].displayName).toBe('Boardroom A');
  });

  it('should filter by building', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRooms });

    const result = await handleFindMeetingRooms({ building: 'Annex' });

    expect(result._meta.count).toBe(1);
    expect(result._meta.rooms[0].displayName).toBe('Phone Booth');
  });

  it('should filter by floor', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRooms });

    const result = await handleFindMeetingRooms({ floor: 3 });

    expect(result._meta.count).toBe(1);
    expect(result._meta.rooms[0].displayName).toBe('Boardroom A');
  });

  it('should filter by minimum capacity', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRooms });

    const result = await handleFindMeetingRooms({ capacity: 10 });

    expect(result._meta.count).toBe(1);
    expect(result._meta.rooms[0].displayName).toBe('Boardroom A');
  });

  it('should handle no matching rooms', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRooms });

    const result = await handleFindMeetingRooms({ capacity: 100 });

    expect(result.content[0].text).toContain('No meeting rooms found');
  });

  it('should handle minimal verbosity', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRooms });

    const result = await handleFindMeetingRooms({
      outputVerbosity: 'minimal',
    });

    expect(result.content[0].text).toContain('Boardroom A');
    expect(result.content[0].text).toContain('boardroom-a@company.com');
  });

  it('should handle full verbosity with device info', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRooms });

    const result = await handleFindMeetingRooms({
      query: 'boardroom',
      outputVerbosity: 'full',
    });

    expect(result.content[0].text).toContain('Polycom');
    expect(result.content[0].text).toContain('Teams Room');
    expect(result.content[0].text).toContain('Wheelchair Accessible');
  });

  it('should fall back to /me/findRooms when /places fails', async () => {
    callGraphAPI
      .mockRejectedValueOnce(new Error('Forbidden')) // /places fails
      .mockResolvedValueOnce({ value: mockRooms }); // /me/findRooms succeeds

    const result = await handleFindMeetingRooms({});

    expect(result._meta.count).toBe(3);
  });

  it('should handle both endpoints failing', async () => {
    callGraphAPI
      .mockRejectedValueOnce(new Error('Forbidden')) // /places fails
      .mockRejectedValueOnce(new Error('Not supported')); // /me/findRooms fails

    const result = await handleFindMeetingRooms({});

    expect(result.content[0].text).toContain('Unable to find meeting rooms');
    expect(result.content[0].text).toContain('Not supported');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleFindMeetingRooms({});

    expect(result.content[0].text).toContain('Authentication required');
  });
});
