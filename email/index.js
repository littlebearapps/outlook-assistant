/**
 * Email module for Outlook Assistant server
 *
 * Consolidated from 17 tools to 6 for token efficiency.
 */
const handleListEmails = require('./list');
const { handleSearchEmails, handleSearchByMessageId } = require('./search');
const handleReadEmail = require('./read');
const handleSendEmail = require('./send');
const handleMarkAsRead = require('./mark-as-read');
const {
  handleListAttachments,
  handleDownloadAttachment,
  handleGetAttachmentContent,
} = require('./attachments');
const { handleExportEmail, handleBatchExportEmails } = require('./export');
const handleListEmailsDelta = require('./delta');
const { handleGetEmailHeaders } = require('./headers');
const { handleGetMimeContent } = require('./mime');
const {
  handleListConversations,
  handleGetConversation,
  handleExportConversation,
} = require('./conversations');

// Import flag handlers from advanced module
const { handleSetMessageFlag, handleClearMessageFlag } = require('../advanced');

// Consolidated email tool definitions (17 → 6)
const emailTools = [
  {
    name: 'search-emails',
    description:
      'Search and list emails. With no query, lists recent emails (like list-emails). Supports search queries, KQL, delta sync, message-id lookup, and conversation listing.',
    annotations: {
      title: 'Search Emails',
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        // Mode selectors (all optional — defaults to list mode)
        deltaMode: {
          type: 'boolean',
          description:
            'Enable delta sync mode. Returns only changes since last sync. Use deltaToken for subsequent calls.',
        },
        internetMessageId: {
          type: 'string',
          description:
            'Look up email by Message-ID header (e.g. <abc123@example.com>). For threading/deduplication.',
        },
        conversationId: {
          type: 'string',
          description:
            'Get all messages in a conversation thread by conversationId.',
        },
        groupByConversation: {
          type: 'boolean',
          description:
            'List conversations (threads) grouped by conversationId instead of individual emails.',
        },
        // Search/list params
        query: {
          type: 'string',
          description: 'Search query text. Omit for list mode.',
        },
        kqlQuery: {
          type: 'string',
          description:
            'Raw KQL (Keyword Query Language) query for advanced search. Bypasses other search params.',
        },
        folder: {
          type: 'string',
          description: "Email folder (default: 'inbox')",
        },
        from: {
          type: 'string',
          description: 'Filter by sender email/name',
        },
        to: {
          type: 'string',
          description: 'Filter by recipient email/name',
        },
        subject: {
          type: 'string',
          description: 'Filter by subject',
        },
        hasAttachments: {
          type: 'boolean',
          description: 'Filter to emails with attachments',
        },
        unreadOnly: {
          type: 'boolean',
          description: 'Filter to unread emails only',
        },
        receivedAfter: {
          type: 'string',
          description: 'Filter emails received after date (ISO 8601)',
        },
        receivedBefore: {
          type: 'string',
          description: 'Filter emails received before date (ISO 8601)',
        },
        searchAllFolders: {
          type: 'boolean',
          description: 'Search across all mail folders',
        },
        count: {
          type: 'number',
          description:
            'Number of results (list default: 25, search default: 10, max: 50)',
        },
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description: 'Output detail level (default: standard)',
        },
        // Delta mode params
        deltaToken: {
          type: 'string',
          description:
            'Token from previous delta call for incremental sync (deltaMode only)',
        },
        maxResults: {
          type: 'number',
          description:
            'Max results per page for delta sync (default: 100, max: 200)',
        },
        // Conversation params
        includeHeaders: {
          type: 'boolean',
          description:
            'Include email headers for each message (conversationId only)',
        },
      },
      required: [],
    },
    handler: async (args) => {
      // Route to appropriate handler based on mode
      if (args.deltaMode) {
        return handleListEmailsDelta(args);
      }
      if (args.internetMessageId) {
        return handleSearchByMessageId({
          messageId: args.internetMessageId,
          outputVerbosity: args.outputVerbosity,
        });
      }
      if (args.conversationId) {
        return handleGetConversation(args);
      }
      if (args.groupByConversation) {
        return handleListConversations(args);
      }
      // If any search params provided, use search handler
      if (
        args.query ||
        args.kqlQuery ||
        args.from ||
        args.to ||
        args.subject ||
        args.hasAttachments ||
        args.unreadOnly ||
        args.receivedAfter ||
        args.receivedBefore ||
        args.searchAllFolders
      ) {
        return handleSearchEmails(args);
      }
      // Default: list mode
      return handleListEmails(args);
    },
  },
  {
    name: 'read-email',
    description:
      'Read email content. Set headersMode=true for forensic headers (DKIM, SPF, Received, Message-ID).',
    annotations: {
      title: 'Read Email',
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the email to read',
        },
        headersMode: {
          type: 'boolean',
          description:
            'Return forensic headers instead of email content (default: false)',
        },
        includeHeaders: {
          type: 'boolean',
          description:
            'Include basic headers alongside email content (default: false)',
        },
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description: 'Output detail level (default: standard)',
        },
        // Headers mode params
        groupByType: {
          type: 'boolean',
          description:
            'Group headers by category (headersMode only, default: false)',
        },
        importantOnly: {
          type: 'boolean',
          description:
            'Show only important headers (headersMode only, default: false)',
        },
        raw: {
          type: 'boolean',
          description:
            'Return raw JSON instead of Markdown (headersMode only, default: false)',
        },
      },
      required: ['id'],
    },
    handler: async (args) => {
      if (args.headersMode) {
        return handleGetEmailHeaders(args);
      }
      return handleReadEmail(args);
    },
  },
  {
    name: 'send-email',
    description:
      'Compose and send an email. Use dryRun=true to preview without sending. Subject to rate limits and recipient allowlist when configured.',
    annotations: {
      title: 'Send Email',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Comma-separated recipient email addresses',
        },
        cc: {
          type: 'string',
          description: 'Comma-separated CC email addresses',
        },
        bcc: {
          type: 'string',
          description: 'Comma-separated BCC email addresses',
        },
        subject: {
          type: 'string',
          description: 'Email subject',
        },
        body: {
          type: 'string',
          description: 'Email body (plain text or HTML)',
        },
        importance: {
          type: 'string',
          enum: ['normal', 'high', 'low'],
          description: 'Email importance (default: normal)',
        },
        saveToSentItems: {
          type: 'boolean',
          description: 'Save to sent items (default: true)',
        },
        dryRun: {
          type: 'boolean',
          description:
            'Preview email without sending (default: false). Returns composed email for review.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
    handler: handleSendEmail,
  },
  {
    name: 'update-email',
    description:
      'Update email state. action=mark-read/mark-unread changes read status. action=flag sets follow-up flag. action=unflag clears flag. action=complete marks flag as done.',
    annotations: {
      title: 'Update Email',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['mark-read', 'mark-unread', 'flag', 'unflag', 'complete'],
          description: 'Action to perform (required)',
        },
        id: {
          type: 'string',
          description:
            'Single message ID (required for mark-read/mark-unread, or use instead of ids for flag actions)',
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Array of message IDs for batch flag/unflag/complete operations',
        },
        // Flag params
        dueDateTime: {
          type: 'string',
          description: 'Due date/time for follow-up, ISO 8601 (action=flag)',
        },
        startDateTime: {
          type: 'string',
          description: 'Start date/time for follow-up, ISO 8601 (action=flag)',
        },
      },
      required: ['action'],
    },
    handler: async (args) => {
      switch (args.action) {
        case 'mark-read':
          return handleMarkAsRead({ id: args.id, isRead: true });
        case 'mark-unread':
          return handleMarkAsRead({ id: args.id, isRead: false });
        case 'flag':
          return handleSetMessageFlag({
            messageId: args.id,
            messageIds: args.ids,
            dueDateTime: args.dueDateTime,
            startDateTime: args.startDateTime,
          });
        case 'unflag':
          return handleClearMessageFlag({
            messageId: args.id,
            messageIds: args.ids,
            markComplete: false,
          });
        case 'complete':
          return handleClearMessageFlag({
            messageId: args.id,
            messageIds: args.ids,
            markComplete: true,
          });
        default:
          return {
            content: [
              {
                type: 'text',
                text: "Invalid action. Use 'mark-read', 'mark-unread', 'flag', 'unflag', or 'complete'.",
              },
            ],
          };
      }
    },
  },
  {
    name: 'attachments',
    description:
      'Manage email attachments. action=list shows attachments for a message. action=view shows content/metadata. action=download saves to disk.',
    annotations: {
      title: 'Attachments',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'view', 'download'],
          description: 'Action to perform (default: list)',
        },
        messageId: {
          type: 'string',
          description: 'Email message ID (required)',
        },
        attachmentId: {
          type: 'string',
          description: 'Attachment ID (action=view/download, required)',
        },
        savePath: {
          type: 'string',
          description:
            'Directory to save file (action=download, default: current directory)',
        },
      },
      required: ['messageId'],
    },
    handler: async (args) => {
      const action = args.action || 'list';
      switch (action) {
        case 'view':
          return handleGetAttachmentContent(args);
        case 'download':
          return handleDownloadAttachment(args);
        case 'list':
        default:
          return handleListAttachments(args);
      }
    },
  },
  {
    name: 'export',
    description:
      'Export emails. target=message exports one email. target=messages batch-exports. target=conversation exports a thread. target=mime gets raw MIME/EML content.',
    annotations: {
      title: 'Export Emails',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['message', 'messages', 'conversation', 'mime'],
          description: 'Export target (default: message)',
        },
        // Single message export
        id: {
          type: 'string',
          description: 'Email ID (target=message/mime, required)',
        },
        format: {
          type: 'string',
          enum: ['mime', 'eml', 'markdown', 'json', 'mbox', 'html', 'csv'],
          description:
            'Export format (target=message: mime/eml/markdown/json/csv, target=conversation: eml/mbox/markdown/json/html/csv)',
        },
        savePath: {
          type: 'string',
          description: 'File path or directory (target=message)',
        },
        includeAttachments: {
          type: 'boolean',
          description:
            'Include attachments (default: true for single, false for batch)',
        },
        // Batch export
        emailIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Email IDs to export (target=messages)',
        },
        searchQuery: {
          type: 'object',
          properties: {
            folder: { type: 'string' },
            from: { type: 'string' },
            subject: { type: 'string' },
            receivedAfter: { type: 'string' },
            receivedBefore: { type: 'string' },
            maxResults: { type: 'number' },
          },
          description:
            'Search query to find emails (target=messages, alternative to emailIds)',
        },
        outputDir: {
          type: 'string',
          description:
            'Output directory (target=messages/conversation, required)',
        },
        // Conversation export
        conversationId: {
          type: 'string',
          description: 'Conversation ID (target=conversation, required)',
        },
        order: {
          type: 'string',
          enum: ['chronological', 'reverse'],
          description:
            'Message order (target=conversation, default: chronological)',
        },
        // MIME params
        headersOnly: {
          type: 'boolean',
          description: 'MIME headers only, no body (target=mime)',
        },
        base64: {
          type: 'boolean',
          description: 'Return base64 encoded (target=mime)',
        },
        maxSize: {
          type: 'number',
          description: 'Max content size in bytes (target=mime, default: 1MB)',
        },
      },
      required: [],
    },
    handler: async (args) => {
      const target = args.target || 'message';
      switch (target) {
        case 'messages':
          return handleBatchExportEmails(args);
        case 'conversation':
          return handleExportConversation(args);
        case 'mime':
          return handleGetMimeContent(args);
        case 'message':
        default:
          return handleExportEmail(args);
      }
    },
  },
];

module.exports = {
  emailTools,
  handleListEmails,
  handleSearchEmails,
  handleSearchByMessageId,
  handleReadEmail,
  handleSendEmail,
  handleMarkAsRead,
  handleListAttachments,
  handleDownloadAttachment,
  handleGetAttachmentContent,
  handleExportEmail,
  handleBatchExportEmails,
  handleListEmailsDelta,
  handleGetEmailHeaders,
  handleGetMimeContent,
  handleListConversations,
  handleGetConversation,
  handleExportConversation,
};
