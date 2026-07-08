/**
 * Advanced module for Outlook Assistant server
 *
 * Provides:
 * - Shared mailbox access
 * - Meeting room search
 *
 * Note: Message flag handlers are still exported from here but their tool
 * definitions have moved to the email module's `update-email` tool.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { FIELD_PRESETS } = require('../utils/field-presets');
const { DEFAULT_TIMEZONE } = require('../config');

/**
 * Format an email for display (simplified)
 */
function formatEmail(email, verbosity = 'standard') {
  if (verbosity === 'minimal') {
    return {
      id: email.id,
      subject: email.subject,
      from: email.from?.emailAddress?.address,
    };
  }

  return {
    id: email.id,
    subject: email.subject,
    from: email.from?.emailAddress
      ? {
          name: email.from.emailAddress.name,
          address: email.from.emailAddress.address,
        }
      : null,
    receivedDateTime: email.receivedDateTime,
    isRead: email.isRead,
    hasAttachments: email.hasAttachments,
    flag: email.flag,
  };
}

/**
 * Access shared mailbox handler
 * Requires Mail.Read.Shared permission
 */
async function handleAccessSharedMailbox(args) {
  // F-46: accept `email` as alias for `sharedMailbox`. The original
  // param name is awkward; most callers reach for `email` first.
  const { folder, count, outputVerbosity } = args;
  const sharedMailbox = args.sharedMailbox || args.email;

  if (!sharedMailbox) {
    return {
      content: [
        {
          type: 'text',
          text: "Shared mailbox email address is required (e.g., 'shared@company.com').",
        },
      ],
    };
  }

  const mailFolder = folder || 'inbox';
  const pageSize = Math.min(count || 25, 50);
  const verbosity = outputVerbosity || 'standard';

  try {
    const accessToken = await ensureAuthenticated();

    // Build endpoint for shared mailbox
    const endpoint = `users/${sharedMailbox}/mailFolders/${mailFolder}/messages`;
    const fieldSet = verbosity === 'full' ? 'read' : 'list';
    const queryParams = {
      $top: pageSize.toString(),
      $orderby: 'receivedDateTime desc',
      $select: FIELD_PRESETS[fieldSet].join(','),
    };

    const response = await callGraphAPI(
      accessToken,
      'GET',
      endpoint,
      null,
      queryParams
    );

    const messages = response.value || [];

    if (messages.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No emails found in ${sharedMailbox}/${mailFolder}.\n\nNote: Make sure you have access to this shared mailbox and the Mail.Read.Shared permission is granted.`,
          },
        ],
      };
    }

    const output = [];
    output.push(`# Shared Mailbox: ${sharedMailbox}`);
    output.push(`**Folder**: ${mailFolder} | **Count**: ${messages.length}\n`);

    if (verbosity === 'minimal') {
      messages.forEach((msg, i) => {
        output.push(`${i + 1}. ${msg.subject}`);
        output.push(`   From: ${msg.from?.emailAddress?.address || 'Unknown'}`);
      });
    } else {
      output.push('| # | Subject | From | Date | Read |');
      output.push('|---|---------|------|------|------|');
      messages.forEach((msg, i) => {
        const date = new Date(msg.receivedDateTime).toLocaleDateString();
        const from =
          msg.from?.emailAddress?.name ||
          msg.from?.emailAddress?.address ||
          'Unknown';
        const read = msg.isRead ? 'Y' : 'N';
        output.push(
          `| ${i + 1} | ${msg.subject?.substring(0, 40)}${msg.subject?.length > 40 ? '...' : ''} | ${from.substring(0, 20)} | ${date} | ${read} |`
        );
      });
    }

    if (verbosity === 'full') {
      output.push('\n## Message IDs');
      messages.forEach((msg, i) => {
        output.push(`${i + 1}. \`${msg.id}\``);
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        sharedMailbox,
        folder: mailFolder,
        count: messages.length,
        messages: messages.map((m) => formatEmail(m, verbosity)),
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }

    if (
      error.message.includes('Access is denied') ||
      error.message.includes('403')
    ) {
      return {
        content: [
          {
            type: 'text',
            text: `Access denied to shared mailbox "${sharedMailbox}".\n\n**Possible causes:**\n- You don't have access to this shared mailbox\n- The Mail.Read.Shared permission is not granted\n- The shared mailbox address is incorrect`,
          },
        ],
      };
    }

    if (error.message.includes('not found') || error.message.includes('404')) {
      return {
        content: [
          {
            type: 'text',
            text: `Shared mailbox "${sharedMailbox}" not found. Please verify the email address.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error accessing shared mailbox: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Set message flag handler
 */
async function handleSetMessageFlag(args) {
  const {
    messageId,
    messageIds,
    dueDateTime,
    startDateTime,
    reminderDateTime: _reminderDateTime,
  } = args;

  // Support single ID or array
  const ids = messageIds || (messageId ? [messageId] : []);

  if (ids.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Message ID (messageId) or IDs (messageIds) required.',
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Build flag object
    const flag = {
      flagStatus: 'flagged',
    };

    if (dueDateTime) {
      // Graph API expects { dateTime, timeZone } envelope without trailing Z
      // When timeZone is specified, the dateTime value is interpreted in that zone
      const dueDt = dueDateTime.replace(/Z$/i, '');
      flag.dueDateTime = {
        dateTime: dueDt,
        timeZone: DEFAULT_TIMEZONE,
      };

      // Graph API requires startDateTime when dueDateTime is set
      // Default to start of the same day if not explicitly provided
      if (startDateTime) {
        flag.startDateTime = {
          dateTime: startDateTime.replace(/Z$/i, ''),
          timeZone: DEFAULT_TIMEZONE,
        };
      } else {
        const startOfDay = `${dueDt.split('T')[0]}T09:00:00`;
        flag.startDateTime = {
          dateTime: startOfDay,
          timeZone: DEFAULT_TIMEZONE,
        };
      }
    } else if (startDateTime) {
      flag.startDateTime = {
        dateTime: startDateTime.replace(/Z$/i, ''),
        timeZone: DEFAULT_TIMEZONE,
      };
    }

    // Process all messages
    const results = [];
    const errors = [];

    for (const id of ids) {
      try {
        await callGraphAPI(accessToken, 'PATCH', `me/messages/${id}`, {
          flag,
        });
        results.push({ id, success: true });
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }

    const output = [];

    if (results.length > 0) {
      output.push(`Flagged ${results.length} message(s) for follow-up`);

      if (dueDateTime) {
        output.push(`**Due**: ${new Date(dueDateTime).toLocaleString()}`);
      }
      if (startDateTime) {
        output.push(`**Start**: ${new Date(startDateTime).toLocaleString()}`);
      }
    }

    if (errors.length > 0) {
      output.push(`\n${errors.length} error(s):`);
      errors.forEach((e) => {
        output.push(`- ${e.id.substring(0, 20)}...: ${e.error}`);
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        successful: results.length,
        failed: errors.length,
        results,
        errors,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error setting message flag: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Clear message flag handler
 */
async function handleClearMessageFlag(args) {
  const { messageId, messageIds, markComplete } = args;

  // Support single ID or array
  const ids = messageIds || (messageId ? [messageId] : []);

  if (ids.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Message ID (messageId) or IDs (messageIds) required.',
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Determine flag status
    const flag = {
      flagStatus: markComplete ? 'complete' : 'notFlagged',
    };

    // Clear completion date if marking complete
    if (markComplete) {
      flag.completedDateTime = {
        dateTime: new Date().toISOString(),
        timeZone: 'UTC',
      };
    }

    // Process all messages
    const results = [];
    const errors = [];

    for (const id of ids) {
      try {
        await callGraphAPI(accessToken, 'PATCH', `me/messages/${id}`, {
          flag,
        });
        results.push({ id, success: true });
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }

    const action = markComplete ? 'marked complete' : 'cleared';
    const output = [];

    if (results.length > 0) {
      output.push(`${results.length} message(s) ${action}`);
    }

    if (errors.length > 0) {
      output.push(`\n${errors.length} error(s):`);
      errors.forEach((e) => {
        output.push(`- ${e.id.substring(0, 20)}...: ${e.error}`);
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        action: markComplete ? 'complete' : 'cleared',
        successful: results.length,
        failed: errors.length,
        results,
        errors,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error clearing message flag: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Find meeting rooms handler
 */
async function handleFindMeetingRooms(args) {
  const { query, building, floor, capacity, outputVerbosity } = args;
  const verbosity = outputVerbosity || 'standard';

  try {
    const accessToken = await ensureAuthenticated();

    // Try the findRooms endpoint first (may not be available in all tenants)
    let rooms = [];

    try {
      // Try /places endpoint for room lists
      const placesResponse = await callGraphAPI(
        accessToken,
        'GET',
        'places/microsoft.graph.room'
      );
      rooms = placesResponse.value || [];
    } catch (_placesError) {
      // Fall back to findRooms
      try {
        const roomsResponse = await callGraphAPI(
          accessToken,
          'GET',
          'me/findRooms'
        );
        rooms = roomsResponse.value || [];
      } catch (findRoomsError) {
        // F-47: distinguish "feature not available on personal account"
        // from generic permission errors. Personal Outlook.com accounts
        // surface a 404 here; organizational accounts surface
        // permission errors. Both look similar in Graph but mean very
        // different things to the caller.
        const errMsg = findRoomsError.message || '';
        const isLikelyPersonal =
          errMsg.includes('404') ||
          errMsg.includes('Not Found') ||
          errMsg.includes('NotFound');
        const explanation = isLikelyPersonal
          ? 'Meeting room search is M365-only. Personal Outlook.com accounts cannot use this feature — there are no rooms to find. Connect a Microsoft 365 work/school account to enable.'
          : 'This feature requires:\n- Places.Read.All permission\n- Meeting rooms configured in your organization';
        return {
          content: [
            {
              type: 'text',
              text: `Unable to find meeting rooms.\n\n**Note**: ${explanation}\n\nError: ${errMsg}`,
            },
          ],
        };
      }
    }

    // Apply filters
    if (query) {
      const q = query.toLowerCase();
      rooms = rooms.filter(
        (r) =>
          r.displayName?.toLowerCase().includes(q) ||
          r.emailAddress?.toLowerCase().includes(q) ||
          r.nickname?.toLowerCase().includes(q)
      );
    }

    if (building) {
      const b = building.toLowerCase();
      rooms = rooms.filter((r) => r.building?.toLowerCase().includes(b));
    }

    if (floor !== undefined) {
      rooms = rooms.filter((r) => r.floorNumber === floor);
    }

    if (capacity) {
      rooms = rooms.filter((r) => r.capacity >= capacity);
    }

    if (rooms.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No meeting rooms found matching your criteria.\n\nTry broadening your search or check if rooms are configured in your organization.',
          },
        ],
      };
    }

    const output = [];
    output.push(`# Meeting Rooms (${rooms.length})\n`);

    if (verbosity === 'minimal') {
      rooms.forEach((room) => {
        output.push(
          `- ${room.displayName || room.name} (${room.emailAddress})`
        );
      });
    } else {
      rooms.forEach((room) => {
        output.push(`## ${room.displayName || room.name}`);
        output.push(`**Email**: ${room.emailAddress || 'N/A'}`);

        if (room.capacity) {
          output.push(`**Capacity**: ${room.capacity}`);
        }
        if (room.building) {
          output.push(`**Building**: ${room.building}`);
        }
        if (room.floorNumber !== undefined) {
          output.push(`**Floor**: ${room.floorNumber}`);
        }
        if (room.floorLabel) {
          output.push(`**Floor Label**: ${room.floorLabel}`);
        }

        if (verbosity === 'full') {
          if (room.audioDeviceName) {
            output.push(`**Audio**: ${room.audioDeviceName}`);
          }
          if (room.videoDeviceName) {
            output.push(`**Video**: ${room.videoDeviceName}`);
          }
          if (room.displayDeviceName) {
            output.push(`**Display**: ${room.displayDeviceName}`);
          }
          if (room.isWheelChairAccessible !== undefined) {
            output.push(
              `**Wheelchair Accessible**: ${room.isWheelChairAccessible ? 'Yes' : 'No'}`
            );
          }
        }

        output.push('');
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        count: rooms.length,
        rooms: rooms,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error finding meeting rooms: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Find meeting times handler
 */
async function handleFindMeetingTimes(args) {
  const { attendees } = args;

  if (!Array.isArray(attendees) || attendees.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'At least one attendee email address is required.',
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();
    const payload = buildFindMeetingTimesPayload(args);
    const response = await callGraphAPI(
      accessToken,
      'POST',
      'me/findMeetingTimes',
      payload,
      {},
      { Prefer: `outlook.timezone="${args.timeZone || DEFAULT_TIMEZONE}"` }
    );

    return formatMeetingTimeSuggestions(response);
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }

    if (isFindMeetingTimesAccountOrPermissionError(error)) {
      return {
        content: [
          {
            type: 'text',
            text: `Unable to find meeting times.\n\n**Note**: find-meeting-times requires a work/school Microsoft 365 account and the delegated Microsoft Graph permission \`Calendars.Read.Shared\` (or \`Calendars.ReadWrite.Shared\`). Personal Microsoft accounts are not supported by Graph for this endpoint.\n\nError: ${error.message}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error finding meeting times: ${error.message}`,
        },
      ],
    };
  }
}

function buildFindMeetingTimesPayload(args) {
  const meetingDuration = args.meetingDuration || minutesToDuration(args);
  const payload = {
    attendees: args.attendees.map((email) => ({
      type: 'required',
      emailAddress: { address: email },
    })),
    meetingDuration,
    maxCandidates: Math.min(args.maxCandidates || 5, 20),
    isOrganizerOptional: args.isOrganizerOptional === true,
    returnSuggestionReasons: true,
  };

  const timeConstraint = buildTimeConstraint(args);
  if (timeConstraint) {
    payload.timeConstraint = timeConstraint;
  }

  if (args.minimumAttendeePercentage !== undefined) {
    payload.minimumAttendeePercentage = args.minimumAttendeePercentage;
  }

  if (args.locationConstraint) {
    payload.locationConstraint = args.locationConstraint;
  }

  return payload;
}

function minutesToDuration(args) {
  const minutes = args.duration || 30;
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error('duration must be a positive integer number of minutes.');
  }
  return `PT${minutes}M`;
}

function buildTimeConstraint(args) {
  if (args.timeConstraint) {
    return args.timeConstraint;
  }

  const activityDomain =
    args.meetingHours === false
      ? 'unrestricted'
      : args.activityDomain || 'work';

  if (!args.startDateTime && !args.endDateTime) {
    return { activityDomain };
  }

  if (!args.startDateTime || !args.endDateTime) {
    throw new Error('startDateTime and endDateTime must be supplied together.');
  }

  return {
    activityDomain,
    timeSlots: [
      {
        start: {
          dateTime: args.startDateTime,
          timeZone: args.timeZone || DEFAULT_TIMEZONE,
        },
        end: {
          dateTime: args.endDateTime,
          timeZone: args.timeZone || DEFAULT_TIMEZONE,
        },
      },
    ],
  };
}

function formatMeetingTimeSuggestions(response) {
  const suggestions = response.meetingTimeSuggestions || [];

  if (suggestions.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No meeting times found.${response.emptySuggestionsReason ? `\n\nReason: ${response.emptySuggestionsReason}` : ''}`,
        },
      ],
      _meta: {
        count: 0,
        emptySuggestionsReason: response.emptySuggestionsReason,
      },
    };
  }

  const output = [`# Meeting Time Suggestions (${suggestions.length})\n`];
  suggestions.forEach((suggestion, index) => {
    const slot = suggestion.meetingTimeSlot || {};
    output.push(`## ${index + 1}. Candidate`);
    output.push(`**Start**: ${formatDateTimeTimeZone(slot.start)}`);
    output.push(`**End**: ${formatDateTimeTimeZone(slot.end)}`);
    output.push(`**Confidence**: ${suggestion.confidence}%`);

    if (suggestion.suggestionReason) {
      output.push(`**Reason**: ${suggestion.suggestionReason}`);
    }

    const availability = suggestion.attendeeAvailability || [];
    if (availability.length > 0) {
      output.push('**Attendee availability**:');
      availability.forEach((item) => {
        const email = item.attendee?.emailAddress || {};
        const label = email.name
          ? `${email.name} <${email.address || 'unknown'}>`
          : email.address || 'unknown attendee';
        output.push(`- ${label}: ${item.availability || 'unknown'}`);
      });
    }

    output.push('');
  });

  return {
    content: [
      {
        type: 'text',
        text: output.join('\n'),
      },
    ],
    _meta: {
      count: suggestions.length,
      suggestions,
    },
  };
}

function formatDateTimeTimeZone(value) {
  if (!value) return 'Unknown';
  return `${value.dateTime || 'Unknown'} (${value.timeZone || DEFAULT_TIMEZONE})`;
}

function isFindMeetingTimesAccountOrPermissionError(error) {
  const message = error.message || '';
  return (
    message.includes('403') ||
    message.includes('404') ||
    message.includes('Not supported') ||
    message.includes('not supported') ||
    message.includes('ErrorAccessDenied') ||
    message.includes('Access is denied') ||
    message.includes('Insufficient privileges') ||
    message.includes('Calendars.Read.Shared')
  );
}

// Consolidated tool definitions (4 → 3, flag tools moved to email/update-email)
const advancedTools = [
  {
    name: 'access-shared-mailbox',
    description:
      'List emails from a shared mailbox the signed-in user has been granted access to (read-only). Returns paged messages from the named `sharedMailbox` (or alias `email`) and `folder` (default `inbox`) with id/subject/from/receivedDateTime/preview — same shape as `search-emails` list mode. Requires that the shared mailbox has been delegated to the signed-in user in Exchange (admin-configured). Use `outputVerbosity` to control field count and `count` (default 25, max 50) for page size. For full search/filter capability over a shared mailbox, prefer `search-emails` with a folder path scoped to the shared mailbox.',
    annotations: {
      title: 'Shared Mailbox',
      readOnlyHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        sharedMailbox: {
          type: 'string',
          description: 'Email address of the shared mailbox (required)',
        },
        email: {
          type: 'string',
          description:
            'Alias for `sharedMailbox` (more intuitive name for the same value).',
        },
        folder: {
          type: 'string',
          description: 'Folder to read from (default: inbox)',
        },
        count: {
          type: 'number',
          description: 'Number of emails to retrieve (default: 25, max: 50)',
        },
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description: 'Output detail level (default: standard)',
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: handleAccessSharedMailbox,
  },
  {
    name: 'find-meeting-rooms',
    description:
      "Discover bookable meeting rooms in the user's organisation via the Graph rooms endpoint (read-only). Returns room resources with displayName, emailAddress, building, floor, capacity, and bookingType — suitable for piping into `create-event` as attendees. Filter by `query` (matches name/email), `building`, `floor`, or minimum `capacity`. Returns empty list on personal accounts (the rooms endpoint is M365-only). Use `outputVerbosity` to control field count.",
    annotations: {
      title: 'Meeting Rooms',
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (room name, email)',
        },
        building: {
          type: 'string',
          description: 'Filter by building name',
        },
        floor: {
          type: 'number',
          description: 'Filter by floor number',
        },
        capacity: {
          type: 'number',
          description: 'Minimum capacity required',
        },
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description: 'Output detail level (default: standard)',
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: handleFindMeetingRooms,
  },
  {
    name: 'find-meeting-times',
    description:
      'Find candidate meeting times across required attendees using Microsoft Graph findMeetingTimes (read-only, work/school Microsoft 365 only). Returns ranked time slots with start/end, confidence, suggestion reason, and attendee availability. Requires `attendees`; accepts `duration` in minutes (default 30) or `meetingDuration` ISO8601, optional `startDateTime`/`endDateTime` search window, `meetingHours`, `maxCandidates`, `isOrganizerOptional`, `minimumAttendeePercentage`, `timeConstraint`, and `locationConstraint`. Requires delegated `Calendars.Read.Shared` or `Calendars.ReadWrite.Shared`; personal Microsoft accounts are not supported by Graph for this endpoint.',
    annotations: {
      title: 'Find Meeting Times',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required attendee email addresses.',
        },
        duration: {
          type: 'integer',
          description:
            'Meeting duration in minutes. Ignored when meetingDuration is supplied. Default: 30.',
        },
        meetingDuration: {
          type: 'string',
          description: 'Graph ISO8601 duration, e.g. PT30M or PT1H.',
        },
        startDateTime: {
          type: 'string',
          description:
            'Optional search-window start dateTime. Must be paired with endDateTime.',
        },
        endDateTime: {
          type: 'string',
          description:
            'Optional search-window end dateTime. Must be paired with startDateTime.',
        },
        timeZone: {
          type: 'string',
          description:
            'Timezone for startDateTime/endDateTime and response preference. Defaults to configured timezone.',
        },
        meetingHours: {
          type: 'boolean',
          description:
            'When false, search unrestricted hours. Default true searches work hours.',
        },
        activityDomain: {
          type: 'string',
          enum: ['work', 'personal', 'unrestricted'],
          description:
            'Graph timeConstraint activity domain. Defaults to work unless meetingHours=false.',
        },
        maxCandidates: {
          type: 'integer',
          description: 'Maximum suggestions to return (default 5, max 20).',
        },
        isOrganizerOptional: {
          type: 'boolean',
          description:
            'Whether the organiser can be unavailable. Default false.',
        },
        minimumAttendeePercentage: {
          type: 'number',
          description:
            'Minimum confidence percentage for returned suggestions.',
        },
        timeConstraint: {
          type: 'object',
          description:
            'Advanced Graph timeConstraint object. Overrides startDateTime/endDateTime and activityDomain.',
        },
        locationConstraint: {
          type: 'object',
          description: 'Advanced Graph locationConstraint object.',
        },
      },
      additionalProperties: false,
      required: ['attendees'],
    },
    handler: handleFindMeetingTimes,
  },
];

module.exports = {
  advancedTools,
  handleAccessSharedMailbox,
  handleSetMessageFlag,
  handleClearMessageFlag,
  handleFindMeetingRooms,
  handleFindMeetingTimes,
  buildFindMeetingTimesPayload,
};
