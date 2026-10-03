/**
 * Update event functionality.
 *
 * Wraps the Microsoft Graph PATCH /me/events/{id} endpoint. Sends only
 * the fields the caller provides — anything left out is preserved
 * server-side. Useful for re-scheduling, adding/removing attendees,
 * editing the body, or tweaking metadata without rebuilding the event
 * from scratch (which loses RSVP state).
 *
 * Supports the following Graph event properties:
 *   - subject
 *   - start          (ISO string or {dateTime, timeZone} object)
 *   - end            (same shape as start)
 *   - attendees      (full replacement list; email strings or {email, type})
 *   - body           (sent as HTML)
 *   - location       (displayName)
 *   - isOnlineMeeting
 *   - sensitivity    (normal | personal | private | confidential)
 *   - showAs         (free | tentative | busy | oof | workingElsewhere | unknown)
 *   - importance     (low | normal | high)
 *   - categories     (full replacement array of category names)
 *   - reminderMinutesBeforeStart
 *
 * `dryRun: true` returns a preview of the PATCH payload without changing
 * anything — useful for confirming behaviour before mutating real data.
 * When an attendee has no explicit type, the event's current attendees are
 * read first (also on dryRun) so existing optional/resource attendees keep
 * their type (#249).
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { DEFAULT_TIMEZONE } = require('../config');
const { normaliseAttendees, buildAttendees } = require('./attendees');

const SENSITIVITY_VALUES = new Set([
  'normal',
  'personal',
  'private',
  'confidential',
]);
const SHOW_AS_VALUES = new Set([
  'free',
  'tentative',
  'busy',
  'oof',
  'workingElsewhere',
  'unknown',
]);
const IMPORTANCE_VALUES = new Set(['low', 'normal', 'high']);

/**
 * Update event handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleUpdateEvent(args) {
  const {
    eventId,
    subject,
    start,
    end,
    attendees,
    body,
    location,
    isOnlineMeeting,
    sensitivity,
    showAs,
    importance,
    categories,
    reminderMinutesBeforeStart,
    dryRun = false,
  } = args;

  if (!eventId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Event ID is required to update an event.',
        },
      ],
    };
  }

  // Build the patch body from only the fields the caller actually provided.
  // Graph treats absent properties as "no change", so we never overwrite
  // something the user didn't intend to touch.
  const patch = {};
  // Attendee entries without an explicit type, which need the event's
  // current attendees to resolve (#249).
  let untypedAttendees = null;

  if (subject !== undefined) patch.subject = subject;

  if (start !== undefined) {
    patch.start = {
      dateTime: start.dateTime || start,
      timeZone: start.timeZone || DEFAULT_TIMEZONE,
    };
  }

  if (end !== undefined) {
    patch.end = {
      dateTime: end.dateTime || end,
      timeZone: end.timeZone || DEFAULT_TIMEZONE,
    };
  }

  if (attendees !== undefined) {
    // Replaces the full attendee list — Graph PATCH on this property is
    // not additive. Caller must pass the desired complete list.
    let entries;
    try {
      entries = normaliseAttendees(attendees || []);
    } catch (error) {
      return {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      };
    }
    patch.attendees = buildAttendees(entries);
    if (entries.some((entry) => !entry.type)) untypedAttendees = entries;
  }

  if (body !== undefined) {
    patch.body = { contentType: 'HTML', content: body };
  }

  if (location !== undefined) {
    patch.location = { displayName: location };
  }

  if (isOnlineMeeting !== undefined) {
    patch.isOnlineMeeting = Boolean(isOnlineMeeting);
  }

  if (sensitivity !== undefined) {
    if (!SENSITIVITY_VALUES.has(sensitivity)) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid sensitivity: '${sensitivity}'. Must be one of: ${[...SENSITIVITY_VALUES].join(', ')}.`,
          },
        ],
      };
    }
    patch.sensitivity = sensitivity;
  }

  if (showAs !== undefined) {
    if (!SHOW_AS_VALUES.has(showAs)) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid showAs: '${showAs}'. Must be one of: ${[...SHOW_AS_VALUES].join(', ')}.`,
          },
        ],
      };
    }
    patch.showAs = showAs;
  }

  if (importance !== undefined) {
    if (!IMPORTANCE_VALUES.has(importance)) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid importance: '${importance}'. Must be one of: ${[...IMPORTANCE_VALUES].join(', ')}.`,
          },
        ],
      };
    }
    patch.importance = importance;
  }

  if (categories !== undefined) {
    // Full replacement, like attendees. Pass [] to clear all categories.
    patch.categories = Array.isArray(categories) ? categories : [];
  }

  if (reminderMinutesBeforeStart !== undefined) {
    const reminder = Number(reminderMinutesBeforeStart);
    if (!Number.isFinite(reminder) || reminder < 0) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid reminderMinutesBeforeStart: '${reminderMinutesBeforeStart}'. Must be a non-negative number.`,
          },
        ],
      };
    }
    patch.reminderMinutesBeforeStart = reminder;
  }

  if (Object.keys(patch).length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No fields to update — provide at least one updatable field (subject, start, end, attendees, body, location, isOnlineMeeting, sensitivity, showAs, importance, categories, reminderMinutesBeforeStart).',
        },
      ],
    };
  }

  try {
    let accessToken;

    // Keep the type of attendees already on the event: an entry without an
    // explicit type takes its current type, so a room or optional attendee
    // isn't turned into a required one. Runs before the dryRun return so the
    // preview shows the resolved types.
    if (untypedAttendees) {
      accessToken = await ensureAuthenticated();
      const current = await callGraphAPI(
        accessToken,
        'GET',
        `me/events/${eventId}`,
        null,
        { $select: 'attendees' }
      );
      patch.attendees = buildAttendees(untypedAttendees, current?.attendees);
    }

    // dryRun: show the caller what would be sent without changing anything.
    if (dryRun) {
      return {
        content: [
          {
            type: 'text',
            text: [
              `**Dry run** — would PATCH \`me/events/${eventId}\` with:`,
              '',
              '```json',
              JSON.stringify(patch, null, 2),
              '```',
              '',
              `Fields that would change: ${Object.keys(patch).join(', ')}`,
            ].join('\n'),
          },
        ],
        _meta: {
          eventId,
          dryRun: true,
          patch,
          fieldsChanged: Object.keys(patch),
        },
      };
    }

    accessToken = accessToken || (await ensureAuthenticated());
    const endpoint = `me/events/${eventId}`;

    const response = await callGraphAPI(accessToken, 'PATCH', endpoint, patch);

    const output = [
      `Event '${response.subject || eventId}' updated successfully.`,
    ];
    if (response.id) {
      output.push(`**ID**: \`${response.id}\``);
    }
    if (response.start) {
      output.push(
        `**Start**: ${response.start.dateTime} (${response.start.timeZone})`
      );
    }
    if (response.end) {
      output.push(
        `**End**: ${response.end.dateTime} (${response.end.timeZone})`
      );
    }
    if (response.webLink) {
      output.push(`**Link**: ${response.webLink}`);
    }
    output.push(`\nFields changed: ${Object.keys(patch).join(', ')}`);

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        eventId: response.id,
        subject: response.subject,
        start: response.start,
        end: response.end,
        fieldsChanged: Object.keys(patch),
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'authenticate' tool first.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error updating event: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = handleUpdateEvent;
