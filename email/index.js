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
const { handleGetMailTips } = require('./mail-tips');
const handleDraft = require('./draft');

// Import flag handlers from advanced module
const { handleSetMessageFlag, handleClearMessageFlag } = require('../advanced');

// Consolidated email tool definitions (17 → 6)
const emailTools = [
  {
    name: 'search-emails',
    description:
      'Search, list, delta-sync, or thread-group emails — six modes selected by parameters (read-only). With no params: lists recent emails in `folder` (default `inbox`). With `query`/`from`/`to`/`subject`/date filters: full search (combines via OData filter). With `kqlQuery`: raw Keyword Query Language for advanced server-side search. With `deltaMode: true`: returns current state plus a `deltaToken`; pass the token back on the next call for incremental changes only — ideal for inbox monitoring. With `groupByConversation: true`: returns conversation threads. With `conversationId`: returns all messages in a single thread. With `internetMessageId`: looks up a message by its RFC Message-ID header. Personal Outlook.com accounts have limited `$search` support — this tool falls back through OData filters / boolean filters / recent listing automatically, but structured filters (`from`/`subject`/`receivedAfter`/`hasAttachments`/`unreadOnly`) return cleaner results. Returns paged messages with id/subject/from/receivedDateTime/preview by default; use `outputVerbosity` to expand.',
    annotations: {
      title: 'Search Emails',
      readOnlyHint: true,
      openWorldHint: true,
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
      additionalProperties: false,
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
      'Read a single email by id (read-only). Default: returns the full message body (HTML stripped to text by default), subject, from/to/cc, receivedDateTime, conversationId, attachments metadata, and webLink as Markdown. With `headersMode: true`: returns RFC-822 forensic headers instead (DKIM, SPF, DMARC, Received chain, Message-ID, Authentication-Results) — pair with `importantOnly: true` for the security-relevant subset, `groupByType: true` for category-bucketed view, or `raw: true` for JSON instead of Markdown. With `includeHeaders: true` (non-headers-mode): adds basic headers alongside body. Use `outputVerbosity` (minimal/standard/full) to control field count.',
    annotations: {
      title: 'Read Email',
      readOnlyHint: true,
      openWorldHint: true,
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
      additionalProperties: false,
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
      'Compose and send an email immediately (destructive: sends external comms). Returns a confirmation with the saved-message id. Safety controls: `dryRun: true` returns the composed message for review without sending; `checkRecipients: true` runs `get-mail-tips` first to flag out-of-office / mailbox-full / delivery-restricted / external recipients; combine both for a full pre-send review. Subject to session rate limits (`OUTLOOK_MAX_EMAILS_PER_SESSION` env) and recipient allowlist (`OUTLOOK_ALLOWED_RECIPIENTS` env) when configured — calls outside the allowlist fail before any Graph request. For multi-step compose/review workflows prefer `draft` (action=`create` → `update` → `send`) since drafts can be inspected in Outlook before sending. Comma-separated recipient strings or arrays both accepted.',
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
        checkRecipients: {
          type: 'boolean',
          description:
            'Check recipients for out-of-office, mailbox full, delivery restrictions before sending (default: false). Combine with dryRun=true for pre-send review.',
        },
      },
      additionalProperties: false,
      required: ['to', 'subject', 'body'],
    },
    handler: handleSendEmail,
  },
  {
    name: 'draft',
    description:
      'Full draft lifecycle for review-before-send workflows (destructive: covers `send` and `delete`). action=`create` saves a new draft in the Drafts folder and returns its id (use `dryRun: true` to preview without saving; `checkRecipients: true` runs mail-tips first). action=`update` patches an existing draft by `id` (only fields passed are changed). action=`send` dispatches an existing draft — shares the rate limit with `send-email`. action=`delete` removes a draft permanently. action=`reply`/`reply-all` creates a reply draft from a message `id` (use `comment` to prepend text — mutually exclusive with `body`). action=`forward` creates a forward draft (requires `id` and `to`). Recipient allowlist applies to create/update/forward. Returns the draft object on create/update/reply/forward; status confirmation on send/delete.',
    annotations: {
      title: 'Draft Operations',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'create',
            'update',
            'send',
            'delete',
            'reply',
            'reply-all',
            'forward',
          ],
          description: 'Action to perform (required)',
        },
        id: {
          type: 'string',
          description:
            'Draft or message ID. Required for update/send/delete/reply/reply-all/forward.',
        },
        to: {
          type: 'string',
          description:
            'Comma-separated recipient email addresses (optional for create/update, required for forward)',
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
        comment: {
          type: 'string',
          description:
            'Comment text for reply/forward (prepended to original message). Cannot combine with body.',
        },
        dryRun: {
          type: 'boolean',
          description:
            'Preview draft without saving (action=create only, default: false)',
        },
        checkRecipients: {
          type: 'boolean',
          description:
            'Check recipients for out-of-office, delivery restrictions before saving (action=create, default: false)',
        },
      },
      additionalProperties: false,
      required: ['action'],
    },
    handler: handleDraft,
  },
  {
    name: 'update-email',
    description:
      'Update message state without modifying content (idempotent — safe to retry). action=`mark-read`/`mark-unread` toggles the `isRead` flag on a single message by `id`. action=`flag` sets a follow-up flag with optional `dueDateTime`/`startDateTime` (ISO 8601). action=`unflag` clears the flag. action=`complete` marks the flag as done. Flag/unflag/complete accept either `id` (single) or `ids` (batch array) — batch operations use Graph `$batch` for efficiency. Returns status confirmation per message.',
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
      additionalProperties: false,
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
      'Inspect or retrieve email attachments. action=`list` (default) returns metadata for all attachments on `messageId` (id, name, contentType, size, isInline) — read-only. action=`view` returns inline content for text/JSON/XML attachments via `attachmentId`; binary types require download. action=`download` saves the attachment to disk at `outputDir` (default system tmpdir, auto-created) and returns the saved file path. `messageId` is required for all actions; `attachmentId` is required for view/download. Use `outputVerbosity` to control list field count.',
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
        outputDir: {
          type: 'string',
          description:
            'Directory to save file (action=download, default: system tmpdir). Auto-created if missing.',
        },
        savePath: {
          type: 'string',
          description:
            'DEPRECATED alias for `outputDir`. Will be removed in v3.8.0.',
        },
      },
      additionalProperties: false,
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
          return handleListAttachments(args);
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown action '${action}'. Valid actions: list, view, download.`,
              },
            ],
          };
      }
    },
  },
  {
    name: 'export',
    description:
      'Export emails to file formats for archival, forensics, or programmatic processing. target=`message` (default) exports a single email by `id` to `savePath` — accepts `mime`/`eml`/`markdown`/`json`/`csv`. target=`messages` batch-exports either an explicit `emailIds` array or messages matching `searchQuery` (or `query` shortcut) into `outputDir` — accepts `markdown`/`json`/`csv`. target=`conversation` exports a full thread by `conversationId` into `outputDir` (chronological by default; pass `order: "reverse"` for newest-first) — accepts `eml`/`mbox`/`markdown`/`json`/`html`/`csv`. target=`mime` returns raw RFC-822 MIME bytes for `id` (use `headersOnly` for just headers, `base64` for encoded transport, `maxSize` to cap at default 1MB). `includeAttachments` defaults to true for single-message exports and false for batch. Format support varies by target — see the format param enum.',
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
            'Export format. Valid values vary by target: target=message accepts mime/eml/markdown/json/csv (mbox and html are conversation-only). target=conversation accepts eml/mbox/markdown/json/html/csv. target=messages (batch) accepts markdown/json/csv. mime is an alias for eml (same RFC822 bytes, .eml extension on disk).',
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
        query: {
          type: 'string',
          description:
            'Free-text search shortcut (target=messages). Equivalent to passing searchQuery: { subject: <query> }. Convenience alias for callers used to search-emails.',
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
      additionalProperties: false,
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
          return handleExportEmail(args);
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown export target '${target}'. Valid targets: message, messages, conversation, mime.`,
              },
            ],
          };
      }
    },
  },
  {
    name: 'get-mail-tips',
    description:
      'Pre-send recipient validation via Graph `POST /me/getMailTips` (read-only; uses the existing `Mail.Read` scope — no extra permissions). Returns per-recipient tips covering automatic replies (out-of-office), mailbox full status, custom admin mail tips, delivery restrictions, moderation requirements, external-vs-internal scope, max message size, and group member counts (total + external). Use ahead of `send-email` or `draft` action=`create` to catch issues like OOO replies or external-recipient warnings before the message goes out; `send-email`/`draft` accept `checkRecipients: true` to invoke this automatically. Accepts either a comma-separated string or an array of addresses; `tipTypes` filters which tips are requested (defaults to all).',
    annotations: {
      title: 'Mail Tips',
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        recipients: {
          oneOf: [
            {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of email addresses to check',
            },
            {
              type: 'string',
              description: 'Comma-separated email addresses to check',
            },
          ],
          description: 'Email addresses to check for mail tips',
        },
        tipTypes: {
          type: 'string',
          description:
            'Comma-separated tip types to request (default: all). Options: automaticReplies, mailboxFullStatus, customMailTip, externalMemberCount, totalMemberCount, maxMessageSize, deliveryRestriction, moderationStatus, recipientScope, recipientSuggestions',
        },
      },
      additionalProperties: false,
      required: ['recipients'],
    },
    handler: handleGetMailTips,
  },
];

module.exports = {
  emailTools,
  handleDraft,
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
  handleGetMailTips,
};
