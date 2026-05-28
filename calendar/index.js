/**
 * Calendar module for Outlook Assistant server
 */
const handleListEvents = require('./list');
const handleDeclineEvent = require('./decline');
const handleCreateEvent = require('./create');
const handleCancelEvent = require('./cancel');
const handleDeleteEvent = require('./delete');
const handleUpdateEvent = require('./update');

// Calendar tool definitions (consolidated: 5 → 3)
const calendarTools = [
  {
    name: 'list-events',
    description:
      'List calendar events for the signed-in user (read-only). By default returns upcoming events (`start ≥ now`). Optional `startAfter`, `startBefore`, and `subject` filters let you search past, current, or specifically-named events; supplying any of them replaces the default "now" filter and the provided filters are AND-ed together. Returns an array of events with id, subject, start/end, attendees, location, organiser, and webLink. Use `count` (default 10, max 50) to control page size. Times are returned in the configured timezone (default Australia/Melbourne; override with `OUTLOOK_DEFAULT_TIMEZONE`).',
    annotations: {
      title: 'List Calendar Events',
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of events to retrieve (default: 10, max: 50)',
        },
        startAfter: {
          type: 'string',
          format: 'date-time',
          description:
            'Optional ISO 8601 datetime. Only return events whose start is on or after this time. Replaces the default "now" lower bound when supplied. Example: "2026-01-01T00:00:00Z".',
        },
        startBefore: {
          type: 'string',
          format: 'date-time',
          description:
            'Optional ISO 8601 datetime. Only return events whose start is strictly before this time. Combine with `startAfter` to bound a window. Example: "2026-02-01T00:00:00Z".',
        },
        subject: {
          type: 'string',
          description:
            'Optional substring to match against the event subject (case-insensitive via Graph `contains()`). Useful for finding past or current events by name.',
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
      "Create a new calendar event on the signed-in user's default calendar. Returns the created event with its `id`, `webLink`, and (if attendees are present) an auto-generated online-meeting URL — attendees receive invitations on save. Times use the configured timezone (default Australia/Melbourne; override with `OUTLOOK_DEFAULT_TIMEZONE`); omit the `Z` suffix to send local time. Use `manage-event` action=`update` to modify an event after creation, or `manage-event` action=`cancel`/`delete` to remove it.",
    annotations: {
      title: 'Create Calendar Event',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
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
          items: {
            type: 'string',
          },
          description: 'List of attendee email addresses',
        },
        body: {
          type: 'string',
          description: 'Optional body content for the event',
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
      "Manage an existing calendar event (destructive: covers update/decline/cancel/delete — use dryRun where supported to preview). action=`update` edits fields in place via PATCH (subject, start, end, attendees, body, location, isOnlineMeeting, sensitivity, showAs, importance, categories, reminderMinutesBeforeStart) — only fields you pass are changed; pass `dryRun: true` to preview the PATCH payload. action=`decline` declines an invitation (optional `comment`). action=`cancel` cancels an event you organised and notifies attendees. action=`delete` permanently removes the event. Returns the updated event on update; status confirmation otherwise. Note: there is no `accept` action — accept invitations in the Outlook UI (Graph's accept verb is unreliable across personal/M365).",
    annotations: {
      title: 'Manage Calendar Event',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
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
          description: 'Optional comment for declining or cancelling the event',
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
          items: { type: 'string' },
          description:
            'Full replacement attendee list — pass complete desired list, or [] to clear (action=update only)',
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
            'Preview the PATCH without applying it (action=update only). Returns the body that would be sent to Graph.',
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
        return {
          content: [
            {
              type: 'text',
              text: 'Required parameter `eventId` (or alias `id`) is missing.',
            },
          ],
        };
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
          return {
            content: [
              {
                type: 'text',
                text: "Invalid action. Use 'update', 'decline', 'cancel', or 'delete'.",
              },
            ],
          };
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
