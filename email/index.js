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
const { toolMetadata } = require('../utils/risk-classes');
const { toolError } = require('../utils/tool-error');

// Consolidated email tool definitions (17 → 6)
const emailTools = [
  {
    name: 'search-emails',
    description:
      'Search, list, delta-sync or thread-group emails (read-only); parameters set the mode. No params: recent emails in `folder` (default `inbox`). `query`/`from`/`to`/`subject`/date filters: search, combined as an OData filter. `searchExpression` (deprecated alias `kqlQuery`): a raw Graph `$search` expression. `deltaMode: true`: current state plus a `deltaToken` to pass back next time for changes only. `groupByConversation: true`: conversation threads. `conversationId`: every message in one thread. `internetMessageId`: the message with that RFC Message-ID. `sharedMailbox` (alias `email`) searches a shared/delegated mailbox, custom folders and nested paths included. Personal Outlook.com accounts have limited `$search`, so the tool falls back to OData filters and a recent listing automatically; structured filters (`from`/`subject`/`receivedAfter`/`hasAttachments`/`unreadOnly`) give cleaner results there. Returns up to `count` messages (id/subject/from/receivedDateTime/preview); `outputVerbosity` expands them.',
    ...toolMetadata('search-emails', 'Search Emails'),
    inputSchema: {
      type: 'object',
      properties: {
        // Mode selectors (all optional — defaults to list mode)
        deltaMode: {
          type: 'boolean',
          description:
            'Enable delta sync mode. Returns only changes since last sync. Use deltaToken for subsequent calls; an initial sync larger than `maxResults` arrives over several pages, each returning a continuation token to pass back until a delta token is returned. Honors `sharedMailbox`/`email` (and custom `folder` paths) to sync within a shared/delegated mailbox.',
        },
        internetMessageId: {
          type: 'string',
          description:
            'Look up email by Message-ID header (e.g. <abc123@example.com>). For threading/deduplication. Honors `sharedMailbox`/`email` to look up within a shared/delegated mailbox.',
        },
        conversationId: {
          type: 'string',
          description:
            'Get the messages in a conversation thread by conversationId, oldest first (up to 100; a longer thread is marked truncated — use `export target=conversation` for up to 1000). Honors `sharedMailbox`/`email` to thread within a shared/delegated mailbox.',
        },
        groupByConversation: {
          type: 'boolean',
          description:
            'List conversations (threads) grouped by conversationId, not individual emails. Honors `sharedMailbox`/`email` (and custom `folder` paths) to group within a shared/delegated mailbox.',
        },
        // Search/list params
        query: {
          type: 'string',
          description:
            'Search query text. Omit for list mode. On personal Outlook.com accounts Graph `$search` is unavailable, so this falls back to a subject substring match (all words must appear in the subject) — precise, but it does NOT search message bodies. Use `searchExpression` when you need body content.',
        },
        searchExpression: {
          type: 'string',
          description:
            'Raw Microsoft Graph `$search` expression for advanced server-side search, e.g. `subject:"invoice"`, `from:github.com`, or `foo OR bar`. Quote your own phrases, escaping any `"` or `\\` inside them with a backslash; a single bare token is auto-quoted and escaped for you. Pair with `searchAllFolders: true` for cross-folder search. Bypasses other search params. NOTE: personal Outlook.com accounts reject field-scoped `$search` outright; since v3.10.0 recognised `from:`/`to:`/`subject:` expressions are translated into the closest equivalent OData filters and retried automatically (a `subject:` term becomes a substring match, so it is close but not identical) (reported as strategy `raw-kql-translated`). Expressions that cannot be translated exactly — free text, `AND`/`OR`, unknown prefixes — are not retried, so use `query` for those there. RELEVANCE, NOT RECENCY: an untranslated expression is answered by Graph `$search` over the whole message including the body, ranked by relevance and not sorted by date, so top hits can look unrelated to a caller expecting a subject match. `query` is the more predictable choice for a term you expect in a subject line; `searchExpression` is the one that reaches body text.',
        },
        kqlQuery: {
          type: 'string',
          description:
            'DEPRECATED alias for `searchExpression` (this was never full KQL — it is a Graph `$search` expression).',
        },
        folder: {
          type: 'string',
          description:
            "Email folder (default: 'inbox'). Accepts a well-known name, a custom/localized display name, or a nested path like `Inbox/Subfolder`.",
        },
        sharedMailbox: {
          type: 'string',
          description:
            'Email address of a shared/delegated mailbox to search (default: the signed-in account). Combine with `folder` (incl. custom subfolders/paths) or `searchAllFolders`. Work/school only; needs the server opt-in setting OUTLOOK_SHARED_MAILBOX (otherwise the call is refused with setup guidance).',
        },
        email: {
          type: 'string',
          description: 'Alias for `sharedMailbox`.',
        },
        from: {
          type: 'string',
          description: 'Filter by sender email/name',
        },
        to: {
          type: 'string',
          description:
            'Filter by recipient email/name. Personal Outlook.com accounts reject the server-side recipient filter, in which case this is matched locally over the 500 most recent messages only (raise with `OUTLOOK_SEARCH_SCAN_LIMIT`). On a large archive, pair `to` with `receivedAfter`/`receivedBefore` to reach older mail; the response says so when the scan was truncated.',
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
            'Number of results (list default: 25, search default: 10, max: 50). There is no page cursor: when the result says more emails are available, raise `count` or narrow `receivedAfter`/`receivedBefore`.',
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
            'Token from previous delta call for incremental sync (deltaMode only). The token is authoritative — it encodes its own mailbox and folder, so `folder`/`sharedMailbox` are ignored and a token from a different mailbox is rejected.',
        },
        maxResults: {
          type: 'number',
          description:
            'Delta sync page size (deltaMode only): 1-200, default 100, sent to Graph as the `Prefer: odata.maxpagesize` header. It sizes each page, not the whole sync: while a page returns a continuation token, keep calling with that token until a delta token is returned, and pass the same `maxResults` on every page (an omitted value means 100).',
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
          sharedMailbox: args.sharedMailbox || args.email || null,
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
        args.searchExpression ||
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
      'Read a single email by id (read-only). Returns subject, from/to/cc, date and the body as Markdown (HTML stripped to text): up to 2,000 characters by default, up to 40,000 with `outputVerbosity: full`; a cut body ends with a note on how to get the rest. With `headersMode: true`: returns RFC-822 forensic headers in place of the body (DKIM, SPF, DMARC, Received chain, Message-ID, Authentication-Results) — `importantOnly: true` for the security-relevant subset, `groupByType: true` for a category-bucketed view, `raw: true` for JSON. With `includeHeaders: true` (non-headers-mode): adds basic headers alongside the body. **If the id came from a shared/delegated mailbox (e.g. via `search-emails` or `access-shared-mailbox` with `sharedMailbox` set), you MUST pass the same `sharedMailbox` (or alias `email`) here** — message IDs are mailbox-scoped, and reading a shared-mailbox id without it fails with 404 ErrorInvalidMailboxItemId.',
    ...toolMetadata('read-email', 'Read Email'),
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the email to read',
        },
        sharedMailbox: {
          type: 'string',
          description:
            'Email address of the shared/delegated mailbox the id belongs to. Required when the id was obtained from a shared mailbox — message IDs are mailbox-scoped and reading without it returns 404 ErrorInvalidMailboxItemId. Requires delegate access + Mail.Read.Shared. Work/school only; needs the server opt-in setting OUTLOOK_SHARED_MAILBOX (otherwise the call is refused with setup guidance).',
        },
        email: {
          type: 'string',
          description: 'Alias for `sharedMailbox`.',
        },
        headersMode: {
          type: 'boolean',
          description:
            'Return forensic headers in place of the email content (default: false)',
        },
        includeHeaders: {
          type: 'boolean',
          description:
            'Include basic headers alongside email content (default: false)',
        },
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description:
            'Output detail level (default: standard). minimal: body preview only; standard: body up to 2,000 characters; full: adds IDs, body up to 40,000 characters. For a longer body, export it with `export` target=message.',
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
            'Return the headers as raw JSON, not Markdown (headersMode only, default: false)',
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
      'Compose and send an email immediately (destructive: sends external comms). Returns a confirmation. Safety controls: `dryRun: true` returns the composed message for review without sending; `checkRecipients: true` runs `get-mail-tips` first and returns its warnings. If the tips show an out-of-office reply, a full mailbox, a delivery restriction or external recipients, the send is refused until repeated with `acknowledgeWarnings: true`. Personal Outlook.com accounts return no tips, and no warnings is not proof of delivery. Subject to session rate limits (`OUTLOOK_MAX_EMAILS_PER_SESSION` env) and recipient allowlist (`OUTLOOK_ALLOWED_RECIPIENTS` env) when configured — calls outside the allowlist fail before any Graph request. For a review-before-send workflow, use `draft` (action=`create` → `update` → `send`); a draft can be checked in Outlook before it goes. Comma-separated recipient strings or arrays both accepted.',
    ...toolMetadata('send-email', 'Send Email'),
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
            'Check recipients with mail tips before sending (default: false). Out-of-office, mailbox full, delivery restrictions or external recipients refuse the send unless acknowledgeWarnings=true. Combine with dryRun=true for pre-send review.',
        },
        acknowledgeWarnings: {
          type: 'boolean',
          default: false,
          description:
            'Send even though checkRecipients flagged an out-of-office reply, a full mailbox, a delivery restriction or external recipients (default: false). Without it those warnings refuse the send. Pass only after the user has seen the warnings. No effect without checkRecipients.',
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
      "Draft lifecycle for review-before-send workflows (destructive: covers `send` and `delete`). action=`create` saves a new draft and returns its id (`dryRun: true` previews without saving; `checkRecipients: true` runs mail-tips first). action=`update` patches a draft by `id` (only fields passed change). action=`send` sends a draft and shares the rate limit with `send-email`. action=`delete` deletes a draft into Recoverable Items (Outlook can restore it for a limited time, depending on the account). update/send/delete refuse any `id` that is not an unsent draft. action=`reply`/`reply-all` creates a reply draft from a message `id` (`comment` prepends text; not with `body`). action=`forward` creates a forward draft (needs `id` and `to`). The recipient allowlist (OUTLOOK_ALLOWED_RECIPIENTS) applies to create/update/forward, to the draft's current to/cc/bcc on send, and to reply/reply-all, whose draft is deleted if a recipient is not allowed. Returns the draft on create/update/reply/forward; a status on send/delete.",
    ...toolMetadata('draft', 'Draft Operations'),
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
            'Draft or message ID. Required for update/send/delete/reply/reply-all/forward. update/send/delete need a draft ID; reply/reply-all/forward take any message ID.',
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
            'Preview only (action=create): shows the draft without saving it. Other actions refuse dryRun and change nothing. Default false.',
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
      'Update message state without modifying content (idempotent — safe to retry). action=`mark-read`/`mark-unread` sets `isRead` on a single message by `id`. action=`flag` sets a follow-up flag with optional `dueDateTime`/`startDateTime`: ISO 8601 with a time, kept as that exact instant when it has `Z` or a ±hh:mm offset and read in OUTLOOK_DEFAULT_TIMEZONE when it has none; date-only or unparseable values are refused before any change. With only `dueDateTime`, the start is 09:00 on the due date, or the due time if earlier. action=`unflag` clears the flag; action=`complete` marks it done. Flag/unflag/complete take `id` (single) or `ids` (batch, updated one at a time: one PATCH each, not Graph `$batch`). `sharedMailbox` (alias `email`) updates messages in a shared/delegated mailbox (default: the signed-in account; needs Mail.ReadWrite.Shared and delegate access). Returns a status per message.',
    ...toolMetadata('update-email', 'Update Email'),
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
            'Single message ID (required for mark-read/mark-unread; flag actions take `id` or `ids`)',
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
          description:
            'Due date/time for follow-up (action=flag). ISO 8601 with a time: "2026-03-01T09:00:00Z" or "2026-03-01T09:00:00+10:00" is that exact instant; "2026-03-01T09:00:00" (no zone) is read in the default timezone (OUTLOOK_DEFAULT_TIMEZONE).',
        },
        startDateTime: {
          type: 'string',
          description:
            'Start date/time for follow-up (action=flag), same format as dueDateTime. Defaults to 09:00 on the due date in the default timezone (capped at the due time) when only dueDateTime is given.',
        },
        sharedMailbox: {
          type: 'string',
          description:
            'Email address of the shared/delegated mailbox whose message(s) to update (default: the signed-in account). Requires delegate access + Mail.ReadWrite.Shared. Work/school only; needs the server opt-in setting OUTLOOK_SHARED_MAILBOX (otherwise the call is refused with setup guidance).',
        },
        email: {
          type: 'string',
          description: 'Alias for `sharedMailbox`.',
        },
      },
      additionalProperties: false,
      required: ['action'],
    },
    handler: async (args) => {
      const sharedMailbox = args.sharedMailbox || args.email || null;
      switch (args.action) {
        case 'mark-read':
          return handleMarkAsRead({ id: args.id, isRead: true, sharedMailbox });
        case 'mark-unread':
          return handleMarkAsRead({
            id: args.id,
            isRead: false,
            sharedMailbox,
          });
        case 'flag':
          return handleSetMessageFlag({
            messageId: args.id,
            messageIds: args.ids,
            dueDateTime: args.dueDateTime,
            startDateTime: args.startDateTime,
            sharedMailbox,
          });
        case 'unflag':
          return handleClearMessageFlag({
            messageId: args.id,
            messageIds: args.ids,
            markComplete: false,
            sharedMailbox,
          });
        case 'complete':
          return handleClearMessageFlag({
            messageId: args.id,
            messageIds: args.ids,
            markComplete: true,
            sharedMailbox,
          });
        default:
          return toolError(
            "Invalid action. Use 'mark-read', 'mark-unread', 'flag', 'unflag', or 'complete'."
          );
      }
    },
  },
  {
    name: 'attachments',
    description:
      'Inspect or retrieve email attachments. action=`list` (default) returns metadata for all attachments on `messageId` (id, name, contentType, size, isInline) — read-only. action=`view` returns inline content for text/JSON/XML attachments via `attachmentId`; binary types require download. action=`download` saves the attachment under a new, unique name in `outputDir` (default system temp directory, auto-created; must be inside the temp directory, ~/Downloads, ~/Documents or OUTLOOK_EXPORT_DIR) and returns the saved file path. `messageId` is required for all actions; `attachmentId` is required for view/download. If `messageId` came from a shared/delegated mailbox, pass the same `sharedMailbox` (or alias `email`) — attachment IDs are scoped to the message and fail under /me otherwise. Use `outputVerbosity` to control list field count.',
    ...toolMetadata('attachments', 'Attachments'),
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
        sharedMailbox: {
          type: 'string',
          description:
            'Email address of the shared/delegated mailbox the messageId belongs to. Required when the message came from a shared mailbox. Requires delegate access + Mail.Read.Shared. Work/school only; needs the server opt-in setting OUTLOOK_SHARED_MAILBOX (otherwise the call is refused with setup guidance).',
        },
        email: {
          type: 'string',
          description: 'Alias for `sharedMailbox`.',
        },
        outputDir: {
          type: 'string',
          description:
            'Absolute directory (or ~/…) to save the file in (action=download, default: system temp directory). Auto-created if missing. Must be inside the system temp directory, ~/Downloads, ~/Documents or OUTLOOK_EXPORT_DIR, with no dot-prefixed folder names.',
        },
        savePath: {
          type: 'string',
          description:
            'DEPRECATED alias for `outputDir`. Will be removed in a future release.',
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
          return toolError(
            `Unknown action '${action}'. Valid actions: list, view, download.`
          );
      }
    },
  },
  {
    name: 'export',
    description:
      'Export emails to files. target=`message` (default) exports one email by `id` (mime/eml/markdown/json/csv) to `savePath`: a directory gets a new, unique file name; a file path is created new and an existing file is replaced only with `overwrite: true`. target=`messages` batch-exports `emailIds`, or matches for `searchQuery`/`query`, into `outputDir` (markdown/json/csv), at most 100 messages per call. target=`conversation` exports a thread (up to 1000 messages) by `conversationId` into `outputDir` (eml/mbox/markdown/json/html/csv; `order: "reverse"` for newest first). target=`mime` returns raw RFC-822 MIME for `id` (`headersOnly`, `base64`, `maxSize`, default 1MB). Files are written only inside the system temp directory (the default), ~/Downloads, ~/Documents or OUTLOOK_EXPORT_DIR, never to dot-prefixed names. Pass `sharedMailbox` (alias `email`) when the ids come from a shared mailbox. `includeAttachments` defaults to true for one message, false for batch.',
    ...toolMetadata('export', 'Export Emails'),
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
          description:
            'Absolute file path or directory, or one starting with ~/ (target=message). Relative paths are refused. Must be inside the system temp directory, ~/Downloads, ~/Documents or OUTLOOK_EXPORT_DIR. An existing file is not replaced unless overwrite is true.',
        },
        overwrite: {
          type: 'boolean',
          description:
            'Replace an existing file at savePath (target=message, default: false). Never replaces a dotfile, a file in a dot-directory, or a symlink.',
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
          description:
            'Email IDs to export (target=messages). At most 100 per call: any beyond the first 100 are left out, and the result says how many.',
        },
        searchQuery: {
          type: 'object',
          properties: {
            folder: {
              type: 'string',
              description:
                'Folder to search (default: inbox): a well-known name, display name, `Parent/Child` path or folder ID',
            },
            from: {
              type: 'string',
              description: 'Sender address or name to match (Graph `$search`)',
            },
            subject: {
              type: 'string',
              description: 'Subject text to match (Graph `$search`)',
            },
            receivedAfter: {
              type: 'string',
              description:
                'Only messages received at or after this date/time (ISO 8601)',
            },
            receivedBefore: {
              type: 'string',
              description:
                'Only messages received at or before this date/time (ISO 8601)',
            },
            maxResults: {
              type: 'number',
              description:
                'Most messages to export (default: 25, max: 100 per call). Newest first, or by relevance when `from`/`subject` is set.',
            },
          },
          description:
            'Search to find emails (target=messages, alternative to emailIds)',
        },
        query: {
          type: 'string',
          description:
            'Free-text search shortcut (target=messages). Equivalent to passing searchQuery: { subject: <query> }. Convenience alias for callers used to search-emails.',
        },
        outputDir: {
          type: 'string',
          description:
            'Absolute output directory, or one starting with ~/ (target=messages, required; target=message/conversation, default: system temp directory). Must be inside the system temp directory, ~/Downloads, ~/Documents or OUTLOOK_EXPORT_DIR.',
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
        sharedMailbox: {
          type: 'string',
          description:
            'Email address of a shared/delegated mailbox to export from (default: the signed-in account). Applies to all targets (message/messages/conversation/mime) — pass it whenever the id(s)/conversationId/searchQuery belong to a shared mailbox. Requires delegate access + Mail.Read.Shared. Work/school only; needs the server opt-in setting OUTLOOK_SHARED_MAILBOX (otherwise the call is refused with setup guidance).',
        },
        email: {
          type: 'string',
          description: 'Alias for `sharedMailbox`.',
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
          return toolError(
            `Unknown export target '${target}'. Valid targets: message, messages, conversation, mime.`
          );
      }
    },
  },
  {
    name: 'get-mail-tips',
    description:
      'Pre-send recipient validation via Graph `POST /me/getMailTips` (read-only; uses the existing `Mail.Read` scope — no extra permissions). Returns per-recipient tips covering automatic replies (out-of-office), mailbox full status, custom admin mail tips, delivery restrictions, moderation requirements, external-vs-internal scope, max message size, and group member counts (total + external). Use ahead of `send-email` or `draft` action=`create` to catch issues like OOO replies or external-recipient warnings before the message goes out; `send-email`/`draft` accept `checkRecipients: true` to invoke this automatically. Accepts either a comma-separated string or an array of addresses; `tipTypes` filters which tips are requested (defaults to all).',
    ...toolMetadata('get-mail-tips', 'Mail Tips'),
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
