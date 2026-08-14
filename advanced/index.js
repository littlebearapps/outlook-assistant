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
const { buildMailboxPrefix } = require('../utils/mailbox');
const { resolveFolder } = require('../folder/resolve');
const { getAllFoldersHierarchy } = require('../folder/list');

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
  const { folder, folderId, count, outputVerbosity, listFolders } = args;
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

  // listFolders mode: enumerate the shared mailbox's folder tree so callers
  // can discover custom subfolder names/IDs to read from.
  if (listFolders) {
    return handleListSharedMailboxFolders(sharedMailbox, args);
  }

  const mailFolder = folder || 'inbox';
  const pageSize = Math.min(count || 25, 50);
  const verbosity = outputVerbosity || 'standard';

  try {
    const accessToken = await ensureAuthenticated();

    // Resolve the requested folder to an ID/well-known segment scoped to the
    // shared mailbox. A raw `folderId` (from `listFolders`) is used as-is;
    // otherwise custom and localized folder names are resolved via the tree.
    let resolvedFolder;
    try {
      const resolved = await resolveFolder(accessToken, {
        id: folderId,
        name: mailFolder,
        mailbox: sharedMailbox,
      });
      resolvedFolder = resolved.id;
    } catch (resolveError) {
      // Only resolution failures get the discovery hint — a Graph error
      // (access denied, 5xx) must fall through to the generic handler below
      // rather than masquerading as "folder not found".
      if (!/not found|ambiguous/i.test(resolveError.message)) {
        throw resolveError;
      }
      return {
        content: [
          {
            type: 'text',
            text:
              `${resolveError.message}\n\n` +
              `Searched in ${sharedMailbox}. List its folders first to get exact names/IDs:\n` +
              '- `access-shared-mailbox` with `listFolders: true`, or\n' +
              `- \`folders\` tool with \`action: list\`, \`sharedMailbox: "${sharedMailbox}"\``,
          },
        ],
      };
    }

    // Build endpoint for shared mailbox
    const endpoint = `users/${sharedMailbox}/mailFolders/${resolvedFolder}/messages`;
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
 * Enumerate a shared mailbox's folder hierarchy.
 *
 * Lists the full folder tree (recursively) of a shared/delegated mailbox so
 * callers can discover custom subfolder names, paths, and IDs — the values
 * needed to read or search those folders.
 * @param {string} sharedMailbox - Shared mailbox email address
 * @param {object} args - Tool arguments (outputVerbosity)
 * @returns {object} - MCP response
 */
async function handleListSharedMailboxFolders(sharedMailbox, args) {
  const verbosity = args.outputVerbosity || 'standard';

  try {
    const accessToken = await ensureAuthenticated();

    const { folders, warnings } = await getAllFoldersHierarchy(
      accessToken,
      true,
      sharedMailbox
    );

    if (!folders || folders.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No folders found in ${sharedMailbox}.\n\nNote: Make sure you have delegate access to this shared mailbox and the Mail.Read.Shared permission is granted.`,
          },
        ],
      };
    }

    const output = [];
    output.push(`# Shared Mailbox Folders: ${sharedMailbox}`);
    output.push(
      `**Folders**: ${folders.length}${warnings.length > 0 ? ' (partial)' : ''}\n`
    );

    folders.forEach((f) => {
      const depth = f.path ? f.path.split('/').length - 1 : 0;
      const indent = '  '.repeat(depth);
      let line = `${indent}- ${f.displayName}`;
      const total = f.totalItemCount || 0;
      const unread = f.unreadItemCount || 0;
      line += ` (${total} items${unread > 0 ? `, ${unread} unread` : ''})`;
      output.push(line);
      if (verbosity === 'full') {
        output.push(`${indent}  path: \`${f.path}\``);
        output.push(`${indent}  id: \`${f.id}\``);
      }
    });

    if (warnings.length > 0) {
      output.push(
        `\n**Partial listing — ${warnings.length} branch(es) incomplete:**`
      );
      warnings.forEach((w) => output.push(`- ${w}`));
    }

    output.push(
      '\nRead a folder with `access-shared-mailbox` using its name, ' +
        'path (e.g. `Inbox/Subfolder`), or `folderId`.'
    );

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        sharedMailbox,
        folderCount: folders.length,
        partial: warnings.length > 0,
        warnings,
        folders: folders.map((f) => ({
          id: f.id,
          displayName: f.displayName,
          folderPath: f.path,
          parentFolderId: f.parentFolderId,
          totalItemCount: f.totalItemCount,
          unreadItemCount: f.unreadItemCount,
        })),
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
            text: `Access denied to shared mailbox "${sharedMailbox}".\n\n**Possible causes:**\n- You don't have delegate access to this shared mailbox\n- The Mail.Read.Shared permission is not granted\n- The shared mailbox address is incorrect`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error listing shared mailbox folders: ${error.message}`,
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
  const prefix = buildMailboxPrefix(args.sharedMailbox || args.email || null);

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
        await callGraphAPI(accessToken, 'PATCH', `${prefix}/messages/${id}`, {
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
  const prefix = buildMailboxPrefix(args.sharedMailbox || args.email || null);

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
        await callGraphAPI(accessToken, 'PATCH', `${prefix}/messages/${id}`, {
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

// Consolidated tool definitions (4 → 2, flag tools moved to email/update-email)
const advancedTools = [
  {
    name: 'access-shared-mailbox',
    description:
      "List emails — or enumerate folders — from a shared mailbox the signed-in user has been granted access to (read-only). Returns paged messages from the named `sharedMailbox` (or alias `email`) and `folder` (default `inbox`) with id/subject/from/receivedDateTime/preview — same shape as `search-emails` list mode. `folder` accepts a well-known name (inbox, sent, archive…), a custom/localized folder display name (e.g. `Archiv`), a nested folder path (e.g. `Inbox/Vendors/Acme`), or pass a raw `folderId`. Set `listFolders: true` to enumerate the shared mailbox's full folder tree (names, paths, IDs, counts) — use this to discover custom subfolders before reading them. Requires that the shared mailbox has been delegated to the signed-in user in Exchange (admin-configured). Use `outputVerbosity` to control field count and `count` (default 25, max 50) for page size. For full search/filter capability over a shared mailbox, prefer `search-emails` with `sharedMailbox` set.",
    annotations: {
      title: 'Shared Mailbox',
      readOnlyHint: true,
      // openWorldHint: returns shared-mailbox messages authored by external
      // senders. (#92)
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
          description:
            'Folder to read from (default: inbox). Accepts a well-known name, a custom/localized display name, or a nested path like `Inbox/Subfolder`.',
        },
        folderId: {
          type: 'string',
          description:
            'Exact Graph folder ID to read from (e.g. from `listFolders`). Skips name resolution; takes precedence over `folder`.',
        },
        listFolders: {
          type: 'boolean',
          description:
            "Enumerate the shared mailbox's full folder tree (names, paths, IDs, item counts) instead of reading messages.",
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
];

module.exports = {
  advancedTools,
  handleAccessSharedMailbox,
  handleListSharedMailboxFolders,
  handleSetMessageFlag,
  handleClearMessageFlag,
  handleFindMeetingRooms,
};
