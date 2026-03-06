/**
 * Calendar module for Outlook Assistant server
 */
const handleListEvents = require('./list');
const handleDeclineEvent = require('./decline');
const handleCreateEvent = require('./create');
const handleCancelEvent = require('./cancel');
const handleDeleteEvent = require('./delete');

// Calendar tool definitions (consolidated: 5 → 3)
const calendarTools = [
  {
    name: 'list-events',
    description: 'Lists upcoming events from your calendar',
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
      },
      required: [],
    },
    handler: handleListEvents,
  },
  {
    name: 'create-event',
    description: 'Creates a new calendar event',
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
      required: ['subject', 'start', 'end'],
    },
    handler: handleCreateEvent,
  },
  {
    name: 'manage-event',
    description:
      'Manage an existing calendar event. action=decline declines an invitation. action=cancel cancels an event you organised. action=delete permanently removes an event.',
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
          enum: ['decline', 'cancel', 'delete'],
          description: 'Action to perform (required)',
        },
        eventId: {
          type: 'string',
          description: 'The ID of the event',
        },
        comment: {
          type: 'string',
          description: 'Optional comment for declining or cancelling the event',
        },
      },
      required: ['action', 'eventId'],
    },
    handler: async (args) => {
      switch (args.action) {
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
                text: "Invalid action. Use 'decline', 'cancel', or 'delete'.",
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
};
