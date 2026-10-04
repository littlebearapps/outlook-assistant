/**
 * Calendar module for Outlook Assistant server
 */
const handleListEvents = require('./list');
const handleDeclineEvent = require('./decline');
const handleCreateEvent = require('./create');
const handleCancelEvent = require('./cancel');
const handleDeleteEvent = require('./delete');
const handleUpdateEvent = require('./update');
const { ATTENDEE_TYPES } = require('./attendees');
const { toolMetadata } = require('../utils/risk-classes');
const { toolError } = require('../utils/tool-error');

// One attendee: an email string, or {email, type} (#249). schema-coerce
// doesn't validate inside array items, so calendar/attendees.js re-checks.
const ATTENDEE_ITEM_SCHEMA = {
  oneOf: [
    { type: 'string' },
    {
      type: 'object',
      properties: {
        email: { type: 'string' },
        type: { type: 'string', enum: [...ATTENDEE_TYPES] },
      },
      required: ['email'],
      additionalProperties: false,
    },
  ],
};

// Calendar tool definitions (consolidated: 5 → 3)
const calendarTools = [
  {
    name: 'list-events',
    description:
      'List calendar events for the signed-in user (read-only). By default returns upcoming events (start ≥ now). Optional `startAfter`, `startBefore` and `subject` filters find past, current or specifically-named events; supplying any of them replaces the default "now" lower bound and the filters are AND-ed together. Results are oldest first, except when the search only looks backwards (`startBefore` without `startAfter`, or `subject` alone), where they are newest first. Each event shows its subject, location, start/end, a body preview and its id. Use `count` (default 10, max 100) to control page size. Each start/end is returned as a canonical UTC ISO-8601 instant (e.g. `2026-04-02T22:00:00.000Z`) followed by a labelled local rendering in the configured display timezone (default Australia/Melbourne; override with `OUTLOOK_DEFAULT_TIMEZONE`) — the UTC value is authoritative, so consumers never have to guess the zone.',
    ...toolMetadata('list-events', 'List Calendar Events'),
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of events to retrieve (default: 10, max: 100)',
        },
        startAfter: {
          type: 'string',
          format: 'date-time',
          description:
            'Optional ISO 8601 datetime with `Z` or a ±hh:mm offset (required). Only return events whose start is on or after this time. Replaces the default "now" lower bound when supplied. Example: "2026-01-01T00:00:00Z" or "2026-01-01T09:00:00+10:00".',
        },
        startBefore: {
          type: 'string',
          format: 'date-time',
          description:
            'Optional ISO 8601 datetime with `Z` or a ±hh:mm offset (required). Only return events whose start is strictly before this time. Combine with `startAfter` to bound a window; on its own, results are newest first. Example: "2026-02-01T00:00:00Z".',
        },
        subject: {
          type: 'string',
          description:
            'Optional substring (max 255 characters) to match against the event subject, case-insensitive (Graph `contains()`). Useful for finding past or current events by name; on its own, results are newest first.',
          maxLength: 255,
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: handleListEvents,
  },
  {
    name: 'create-event',
    description:
      "Create a new calendar event on the signed-in user's default calendar. Returns the created event with its `id`, `webLink`, and (if attendees are present) an auto-generated online-meeting URL — attendees receive invitations on save, so pass `dryRun: true` first to preview who would be invited (and how many are external) without creating anything. Times use the configured timezone (default Australia/Melbourne; override with `OUTLOOK_DEFAULT_TIMEZONE`); omit the `Z` suffix to send local time. Use `manage-event` action=`update` to modify an event after creation, or `manage-event` action=`cancel`/`delete` to remove it.",
    ...toolMetadata('create-event', 'Create Calendar Event'),
    inputSchema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'The subject of the event',
        },
        start: {
          type: 'string',
          description: 'The start time of the event in ISO 8601 format',
        },
        end: {
          type: 'string',
          description: 'The end time of the event in ISO 8601 format',
        },
        attendees: {
          type: 'array',
          items: ATTENDEE_ITEM_SCHEMA,
          description:
            "Attendees: email address strings (required attendees) or {email, type} objects, where type is 'required', 'optional' or 'resource' (a room or equipment)",
        },
        body: {
          type: 'string',
          description: 'Optional body content for the event',
        },
        dryRun: {
          type: 'boolean',
          description:
            'Preview only: nothing is created and no invitations are sent. Shows who would be invited and how many are external (default false).',
        },
      },
      additionalProperties: false,
      required: ['subject', 'start', 'end'],
    },
    handler: handleCreateEvent,
  },
  {
    name: 'manage-event',
    description:
      "Manage an existing calendar event. `dryRun: true` previews any action without changing or sending anything: who would be emailed, with an external count (decline/cancel/delete), or the PATCH body (update). action=`update` edits fields via PATCH (subject, start, end, attendees, body, location, isOnlineMeeting, sensitivity, showAs, importance, categories, reminderMinutesBeforeStart); only fields you pass change. action=`decline` declines an invitation (optional `comment`; `sendResponse: false` declines without notifying the organiser). action=`cancel` cancels an event you organised and emails attendees. action=`delete` removes the event from your calendar (Graph documents no guaranteed recovery); deleting a meeting you organised that has attendees still emails them a cancellation, so use `cancel` with a `comment` to control that message. Returns the updated event on update; a confirmation otherwise. There is no `accept` action: accept invitations in the Outlook UI, as Graph's accept verb is unreliable.",
    ...toolMetadata('manage-event', 'Manage Calendar Event'),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['update', 'decline', 'cancel', 'delete'],
          description: 'Action to perform (required)',
        },
        eventId: {
          type: 'string',
          description: 'The ID of the event',
        },
        id: {
          type: 'string',
          description:
            'Alias for `eventId` (canonical per the v3.7.3 alias pass).',
        },
        comment: {
          type: 'string',
          description:
            'Message sent with a decline or cancel (optional; omitted if not given)',
        },
        sendResponse: {
          type: 'boolean',
          description:
            'Send the decline to the organiser (action=decline only; default true). Pass false to decline without notifying the organiser.',
        },
        subject: {
          type: 'string',
          description: 'New subject (action=update only)',
        },
        start: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                dateTime: { type: 'string' },
                timeZone: { type: 'string' },
              },
              required: ['dateTime'],
              additionalProperties: false,
            },
          ],
          description:
            'New start time as ISO 8601 string or {dateTime, timeZone} object (action=update only)',
        },
        end: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                dateTime: { type: 'string' },
                timeZone: { type: 'string' },
              },
              required: ['dateTime'],
              additionalProperties: false,
            },
          ],
          description:
            'New end time as ISO 8601 string or {dateTime, timeZone} object (action=update only)',
        },
        attendees: {
          type: 'array',
          items: ATTENDEE_ITEM_SCHEMA,
          description:
            "Full replacement attendee list — pass the complete desired list, or [] to clear (action=update only). Each entry is an email address string or an {email, type} object (type 'required', 'optional' or 'resource'). A string, or an object without a type, keeps the type that address already has on the event (new addresses are required); an explicit type always wins.",
        },
        body: {
          type: 'string',
          description: 'New body content (action=update only)',
        },
        location: {
          type: 'string',
          description: 'New location display name (action=update only)',
        },
        isOnlineMeeting: {
          type: 'boolean',
          description: 'Toggle online meeting flag (action=update only)',
        },
        sensitivity: {
          type: 'string',
          enum: ['normal', 'personal', 'private', 'confidential'],
          description: 'Event sensitivity classification (action=update only)',
        },
        showAs: {
          type: 'string',
          enum: [
            'free',
            'tentative',
            'busy',
            'oof',
            'workingElsewhere',
            'unknown',
          ],
          description: 'Free/busy status shown to others (action=update only)',
        },
        importance: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description: 'Event importance flag (action=update only)',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Full replacement category list — pass [] to clear (action=update only)',
        },
        reminderMinutesBeforeStart: {
          type: 'number',
          description:
            'Minutes before start to fire the reminder (action=update only)',
        },
        dryRun: {
          type: 'boolean',
          description:
            'Preview only: nothing is changed or sent. Shows who would be emailed (decline/cancel/delete) or the PATCH body (update). Default false.',
        },
      },
      additionalProperties: false,
      required: ['action'],
    },
    handler: async (args) => {
      // F-37: accept `id` as alias for `eventId` so callers don't have
      // to remember which tool uses which name. Both work; eventId
      // remains the canonical Graph param.
      const normalised = { ...args };
      if (!normalised.eventId && normalised.id) {
        normalised.eventId = normalised.id;
      }
      if (!normalised.eventId) {
        return toolError(
          'Required parameter `eventId` (or alias `id`) is missing.'
        );
      }
      args = normalised;
      switch (args.action) {
        case 'update':
          return handleUpdateEvent(args);
        case 'decline':
          return handleDeclineEvent(args);
        case 'cancel':
          return handleCancelEvent(args);
        case 'delete':
          return handleDeleteEvent(args);
        default:
          return toolError(
            "Invalid action. Use 'update', 'decline', 'cancel', or 'delete'."
          );
      }
    },
  },
];

module.exports = {
  calendarTools,
  handleListEvents,
  handleDeclineEvent,
  handleCreateEvent,
  handleCancelEvent,
  handleDeleteEvent,
  handleUpdateEvent,
};
