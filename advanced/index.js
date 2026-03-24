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
  const { sharedMailbox, folder, count, outputVerbosity } = args;

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

    let output = [];
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
        const startOfDay = dueDt.split('T')[0] + 'T09:00:00';
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

    let output = [];

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
    let output = [];

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
        return {
          content: [
            {
              type: 'text',
              text: `Unable to find meeting rooms.\n\n**Note**: This feature requires:\n- Places.Read.All permission\n- Meeting rooms configured in your organization\n\nError: ${findRoomsError.message}`,
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

    let output = [];
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

// Consolidated tool definitions (4 → 2, flag tools moved to email/update-email)
const advancedTools = [
  {
    name: 'access-shared-mailbox',
    description: 'Read emails from a shared mailbox you have access to',
    annotations: {
      title: 'Shared Mailbox',
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        sharedMailbox: {
          type: 'string',
          description: 'Email address of the shared mailbox (required)',
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
      required: ['sharedMailbox'],
    },
    handler: handleAccessSharedMailbox,
  },
  {
    name: 'find-meeting-rooms',
    description: 'Search for meeting rooms in your organisation',
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
      required: [],
    },
    handler: handleFindMeetingRooms,
  },
];

module.exports = {
  advancedTools,
  handleAccessSharedMailbox,
  handleSetMessageFlag,
  handleClearMessageFlag,
  handleFindMeetingRooms,
};
