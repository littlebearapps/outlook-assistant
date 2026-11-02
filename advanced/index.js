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
const config = require('../config');
const { DEFAULT_TIMEZONE } = config;
const {
  buildMailboxPrefix,
  validateMailboxPrefix,
  SHARED_MAILBOX_DISABLED_MESSAGE,
} = require('../utils/mailbox');
const { resolveFolder } = require('../folder/resolve');
const { getAllFoldersHierarchy } = require('../folder/list');
const {
  InvalidDateTimeError,
  toGraphDateTimeTimeZone,
  zonedParts,
  zonedWallTimeToUtcMs,
} = require('../utils/datetime');
const { toolMetadata } = require('../utils/risk-classes');
const { toolError, authRequiredError } = require('../utils/tool-error');

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
 * Shared-mailbox hint appended to access errors while OUTLOOK_SHARED_MAILBOX
 * is off (the token then carries no `.Shared` scope).
 */
const ENABLE_SHARED_HINT =
  '\n\nShared-mailbox scopes are not enabled. Reading a mailbox other than your own normally needs `Mail.Read.Shared`: set OUTLOOK_SHARED_MAILBOX=read (work/school accounts only), restart the server, and run `auth action=authenticate force=true`.';

/**
 * Access shared mailbox handler.
 *
 * With OUTLOOK_SHARED_MAILBOX off this behaves exactly as before the opt-in
 * flag existed: `folder` (or `folderId`) is used as given — a well-known name
 * or a folder ID — and the read is sent to Graph with whatever scopes the
 * token already has; a 403 or 404 gets the setup hint. This is deliberate and
 * documented (#338): it is the one tool that makes a request for another
 * mailbox while the opt-in is off. Every other tool goes through
 * buildMailboxPrefix, which refuses first. With the flag on, custom/localized
 * names and nested paths are resolved, and `listFolders` is available.
 */
async function handleAccessSharedMailbox(args) {
  // F-46: accept `email` as alias for `sharedMailbox`. The original
  // param name is awkward; most callers reach for `email` first.
  const { folder, folderId, count, outputVerbosity, listFolders } = args;
  const sharedMailbox = args.sharedMailbox || args.email;

  if (!sharedMailbox) {
    return toolError(
      "Shared mailbox email address is required (e.g., 'shared@company.com')."
    );
  }

  // Validate up front, through the same helper every other tool uses. The
  // ungated variant keeps this tool's pre-opt-in behaviour when
  // OUTLOOK_SHARED_MAILBOX is off; with it on, buildMailboxPrefix and
  // validateMailboxPrefix agree.
  let mailboxPrefix;
  try {
    mailboxPrefix = validateMailboxPrefix(sharedMailbox);
  } catch (error) {
    return toolError(error.message);
  }
  if (mailboxPrefix === 'me') {
    return toolError(
      'access-shared-mailbox reads another mailbox — pass its email address. To read your own mailbox, use `search-emails`.'
    );
  }

  // listFolders mode: enumerate the shared mailbox's folder tree so callers
  // can discover custom subfolder names/IDs to read from.
  const sharedEnabled = config.SHARED_MAILBOX_MODE !== 'off';

  if (listFolders) {
    if (!sharedEnabled) {
      return toolError(SHARED_MAILBOX_DISABLED_MESSAGE);
    }
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
    if (!sharedEnabled) {
      // Pre-opt-in behaviour: no folder resolution.
      resolvedFolder = folderId || mailFolder;
    } else {
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
        return toolError(
          `${resolveError.message}\n\n` +
            `Searched in ${sharedMailbox}. List its folders first to get exact names/IDs:\n` +
            '- `access-shared-mailbox` with `listFolders: true`, or\n' +
            `- \`folders\` tool with \`action: list\`, \`sharedMailbox: "${sharedMailbox}"\``
        );
      }
    }

    // Build endpoint for shared mailbox
    const endpoint = `${mailboxPrefix}/mailFolders/${resolvedFolder}/messages`;
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
      return authRequiredError();
    }

    if (
      error.message.includes('Access is denied') ||
      error.message.includes('403')
    ) {
      return toolError(
        `Access denied to shared mailbox "${sharedMailbox}".\n\n**Possible causes:**\n- You don't have access to this shared mailbox\n- The Mail.Read.Shared permission is not granted\n- The shared mailbox address is incorrect${sharedEnabled ? '' : ENABLE_SHARED_HINT}`
      );
    }

    if (error.message.includes('not found') || error.message.includes('404')) {
      return toolError(
        `Shared mailbox "${sharedMailbox}" not found, or you can't access it. Please verify the email address.${sharedEnabled ? '' : ENABLE_SHARED_HINT}`
      );
    }

    return toolError(`Error accessing shared mailbox: ${error.message}`);
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
      return authRequiredError();
    }

    if (
      error.message.includes('Access is denied') ||
      error.message.includes('403')
    ) {
      return toolError(
        `Access denied to shared mailbox "${sharedMailbox}".\n\n**Possible causes:**\n- You don't have delegate access to this shared mailbox\n- The Mail.Read.Shared permission is not granted\n- The shared mailbox address is incorrect`
      );
    }

    return toolError(`Error listing shared mailbox folders: ${error.message}`);
  }
}

/**
 * Default follow-up start for a flag with only a due date: 09:00 in
 * DEFAULT_TIMEZONE on the due's local date, or the due itself when the due is
 * earlier than that (a start after the due would be nonsense).
 */
function deriveFlagStart(due) {
  let wall;
  if (due.timeZone === DEFAULT_TIMEZONE) {
    wall = due.dateTime;
  } else {
    const parts = zonedParts(Date.parse(`${due.dateTime}Z`), DEFAULT_TIMEZONE);
    if (!parts) return { ...due };
    wall = `${parts.date}T${parts.time}`;
  }
  const nineAm = `${wall.slice(0, 10)}T09:00:00`;
  // Same zone and fixed-width prefix, so string order is time order.
  return wall < nineAm
    ? { ...due }
    : { dateTime: nineAm, timeZone: DEFAULT_TIMEZONE };
}

/**
 * Describe a flag dateTimeTimeZone envelope as UTC plus DEFAULT_TIMEZONE,
 * e.g. "2026-03-01 09:00 UTC (2026-03-01 20:00 Australia/Melbourne)".
 */
function describeFlagTime(envelope) {
  const ms =
    envelope.timeZone === 'UTC'
      ? Date.parse(`${envelope.dateTime}Z`)
      : zonedWallTimeToUtcMs(envelope.dateTime, envelope.timeZone);
  const local = (date, time) =>
    `${date} ${time.slice(0, 5)} ${DEFAULT_TIMEZONE}`;
  if (Number.isNaN(ms)) {
    // DEFAULT_TIMEZONE isn't an IANA zone Intl knows; show it as given.
    return local(envelope.dateTime.slice(0, 10), envelope.dateTime.slice(11));
  }
  const iso = new Date(ms).toISOString();
  const utc = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  const parts =
    DEFAULT_TIMEZONE === 'UTC' ? null : zonedParts(ms, DEFAULT_TIMEZONE);
  return parts ? `${utc} (${local(parts.date, parts.time)})` : utc;
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
    return toolError('Message ID (messageId) or IDs (messageIds) required.');
  }

  // Build flag object. Zoned values (Z/offset) are sent as the same instant in
  // UTC; zone-less values are read in DEFAULT_TIMEZONE. Bad dates are refused
  // here, before authenticating or calling Graph.
  const flag = {
    flagStatus: 'flagged',
  };
  try {
    if (startDateTime) {
      flag.startDateTime = toGraphDateTimeTimeZone(
        startDateTime,
        'startDateTime'
      );
    }
    if (dueDateTime) {
      flag.dueDateTime = toGraphDateTimeTimeZone(dueDateTime, 'dueDateTime');
      // Graph requires startDateTime when dueDateTime is set.
      if (!flag.startDateTime) {
        flag.startDateTime = deriveFlagStart(flag.dueDateTime);
      }
    }
  } catch (error) {
    if (error instanceof InvalidDateTimeError) {
      return {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      };
    }
    throw error;
  }

  try {
    const accessToken = await ensureAuthenticated();

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

      if (flag.dueDateTime) {
        output.push(`**Due**: ${describeFlagTime(flag.dueDateTime)}`);
      }
      if (flag.startDateTime) {
        output.push(`**Start**: ${describeFlagTime(flag.startDateTime)}`);
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
      return authRequiredError();
    }
    return toolError(`Error setting message flag: ${error.message}`);
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
    return toolError('Message ID (messageId) or IDs (messageIds) required.');
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
      return authRequiredError();
    }
    return toolError(`Error clearing message flag: ${error.message}`);
  }
}

/** Most pages of `places/microsoft.graph.room` read (100 rooms per page). */
const ROOM_PAGE_CAP = 10;

/**
 * `findRooms` exists only on the beta endpoint (v1.0 always 404s), so the
 * fallback names the beta URL in full. Beta APIs can change without notice.
 * It needs only User.Read but returns at most the first 100 rooms, as
 * `{ name, address }` pairs with no building, floor or capacity.
 */
const FIND_ROOMS_BETA_URL = 'https://graph.microsoft.com/beta/me/findRooms';

const PLACE_SCOPE_NOTE =
  "Listing rooms through Graph `places` needs the Place.Read.All permission (admin consent), and this server doesn't request that scope yet (tracked in #337)";

/** HTTP status from a callGraphAPI error message, or null. */
function graphErrorStatus(error) {
  const match = /status (\d{3})/.exec(error?.message || '');
  return match ? Number(match[1]) : null;
}

/**
 * Graph says so outright for a personal account (live, 2026-10-08):
 * `400 … This API is not supported for MSA accounts`.
 */
function isPersonalAccountError(error) {
  return /not supported for MSA accounts/i.test(error?.message || '');
}

/** A refusal for want of permission: missing Place.Read.All consent. */
function isPermissionError(error) {
  return (
    graphErrorStatus(error) === 403 ||
    /ErrorAccessDenied|Authorization_RequestDenied|Forbidden/i.test(
      error?.message || ''
    )
  );
}

/**
 * Every room from `places/microsoft.graph.room`, following `@odata.nextLink`
 * up to ROOM_PAGE_CAP pages.
 * @returns {Promise<{rooms: object[], truncated: boolean}>}
 */
async function listPlacesRooms(accessToken) {
  let response = await callGraphAPI(
    accessToken,
    'GET',
    'places/microsoft.graph.room'
  );
  const rooms = [...(response?.value || [])];
  let pages = 1;
  while (response?.['@odata.nextLink'] && pages < ROOM_PAGE_CAP) {
    response = await callGraphAPI(
      accessToken,
      'GET',
      response['@odata.nextLink']
    );
    rooms.push(...(response?.value || []));
    pages++;
  }
  return { rooms, truncated: Boolean(response?.['@odata.nextLink']) };
}

/**
 * Find meeting rooms handler (#240): `places` first, paged; the beta
 * `findRooms` when that fails, except on a personal account, where Graph
 * has no rooms to offer.
 */
async function handleFindMeetingRooms(args) {
  const { query, building, floor, capacity, outputVerbosity } = args;
  const verbosity = outputVerbosity || 'standard';

  try {
    const accessToken = await ensureAuthenticated();

    let rooms = [];
    let source = 'places';
    let truncated = false;
    const notes = [];

    try {
      ({ rooms, truncated } = await listPlacesRooms(accessToken));
    } catch (placesError) {
      if (isPersonalAccountError(placesError)) {
        return toolError(
          "Meeting rooms are a Microsoft 365 (work or school) feature. Graph doesn't support room lookup for personal Microsoft accounts (Outlook.com, Hotmail, Live), so there are no rooms to find.",
          {
            nextStep:
              'Sign in with a Microsoft 365 work or school account to look up rooms.',
          }
        );
      }
      const placesWhy = isPermissionError(placesError)
        ? `${PLACE_SCOPE_NOTE}, so Graph refused it.`
        : `Graph \`places\` failed: ${placesError.message}`;
      try {
        const roomsResponse = await callGraphAPI(
          accessToken,
          'GET',
          FIND_ROOMS_BETA_URL
        );
        rooms = (roomsResponse?.value || []).map((r) => ({
          displayName: r.name,
          emailAddress: r.address,
        }));
        source = 'findRooms-beta';
        notes.push(
          `_Listed with the beta \`findRooms\` call (names and addresses only, at most the first 100 rooms in the organisation). ${placesWhy}_`
        );
      } catch (findRoomsError) {
        const explanation = isPermissionError(placesError)
          ? `Couldn't list meeting rooms. ${PLACE_SCOPE_NOTE}, so Graph refused it (403).`
          : `Couldn't list meeting rooms. ${placesWhy}`;
        return toolError(
          `${explanation}\n\nThe fallback, the beta \`findRooms\` call (needs only User.Read), also failed: ${findRoomsError.message}`,
          {
            nextStep:
              "If you know the room's email address, add it to `create-event` as an attendee with type `resource`.",
          }
        );
      }
    }

    if (source === 'findRooms-beta') {
      // findRooms carries no building, floor or capacity, so filtering on
      // them would drop every room. Say so rather than return nothing.
      const unchecked = [
        ['building', building],
        ['floor', floor],
        ['capacity', capacity],
      ]
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([name]) => `\`${name}\``);
      if (unchecked.length > 0) {
        notes.push(
          `_${unchecked.join(', ')} ${unchecked.length === 1 ? 'was' : 'were'} not applied: \`findRooms\` returns no building, floor or capacity._`
        );
      }
    }
    if (truncated) {
      notes.push(
        `_Only the first ${ROOM_PAGE_CAP} pages of rooms were read, so the list may be incomplete._`
      );
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

    const placeFilters = source === 'places';

    if (building && placeFilters) {
      const b = building.toLowerCase();
      rooms = rooms.filter((r) => r.building?.toLowerCase().includes(b));
    }

    if (floor !== undefined && placeFilters) {
      rooms = rooms.filter((r) => r.floorNumber === floor);
    }

    if (capacity && placeFilters) {
      rooms = rooms.filter((r) => r.capacity >= capacity);
    }

    if (rooms.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: [
              'No meeting rooms found matching your criteria.\n\nTry broadening your search or check if rooms are configured in your organisation.',
              ...notes,
            ].join('\n\n'),
          },
        ],
        _meta: { count: 0, rooms: [], source, truncated },
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

    if (notes.length > 0) {
      output.push('', ...notes);
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
        source,
        truncated,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }
    return toolError(`Error finding meeting rooms: ${error.message}`);
  }
}

// Consolidated tool definitions (4 → 2, flag tools moved to email/update-email)
const advancedTools = [
  {
    name: 'access-shared-mailbox',
    description:
      "List emails or folders in a shared mailbox the signed-in user can access (read-only). While the server setting OUTLOOK_SHARED_MAILBOX is unset, this tool still sends the read to Microsoft Graph with whatever access the current sign-in has, for a well-known `folder` name or a `folderId` only, and adds the setup steps on a 403 or 404; every other tool's `sharedMailbox` parameter is refused before any request. With the setting on (work/school only), `folder` also takes a custom/localized display name (e.g. `Archiv`) or a nested path (e.g. `Inbox/Vendors/Acme`), and `listFolders: true` enumerates the mailbox's folder tree. Returns messages from `sharedMailbox` (alias `email`) and `folder` (default `inbox`) with id/subject/from/receivedDateTime/preview. Needs the mailbox delegated to the signed-in user in Exchange (admin-configured). `outputVerbosity` sets field count and `count` (default 25, max 50) page size. `search-emails` with `sharedMailbox` searches and filters a shared mailbox.",
    ...toolMetadata('access-shared-mailbox', 'Shared Mailbox'),
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
            "Enumerate the shared mailbox's full folder tree (names, paths, IDs, item counts) in place of reading messages.",
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
      "List bookable meeting rooms in the user's Microsoft 365 organisation (read-only). Reads Graph `places` (all pages, up to 1,000 rooms): name, email address, building, floor, capacity and devices. `places` needs the Place.Read.All permission, which this server doesn't request yet (#337); when Graph refuses it, the tool falls back to the beta `findRooms` call (User.Read; names and addresses only, first 100 rooms), and says so in the result. A room's email address works as a `create-event` attendee with type `resource`. Filter by `query` (name or address), `building`, `floor` or minimum `capacity`; filters run on the returned list, and `findRooms` results can't be filtered by building, floor or capacity. Personal Microsoft accounts (Outlook.com) have no rooms: the call returns an error saying so. `outputVerbosity` controls field count.",
    ...toolMetadata('find-meeting-rooms', 'Meeting Rooms'),
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
