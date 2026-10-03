/**
 * Conversation threading functionality
 *
 * Manages email conversation threads - listing, retrieving, and exporting.
 */
const fs = require('fs');
const path = require('path');
const {
  callGraphAPI,
  callGraphAPIRaw,
  callGraphAPIPaginated: _callGraphAPIPaginated,
} = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { getEmailFields } = require('../utils/field-presets');
const { resolveFolderPath } = require('./folder-utils');
const { buildMailboxPrefix } = require('../utils/mailbox');
const { writeClaimedFile, makeClaimedDir } = require('../utils/safe-write');
const { escapeODataString } = require('../utils/odata-helpers');
const {
  formatEmailContent,
  formatEmailsAsCSV,
  stripHtml,
  VERBOSITY,
} = require('../utils/response-formatter');
const { toolError, authRequiredError } = require('../utils/tool-error');
// Note: buildFromFilter/buildToFilter from search.js use OData $filter which causes
// InefficientFilter on personal accounts with $orderby. Client-side filtering used instead.

/**
 * Format a date for filenames
 * @param {string} isoDate - ISO date string
 * @returns {string} - Formatted date string
 */
function formatDateForFilename(isoDate) {
  if (!isoDate) return 'unknown-date';
  const date = new Date(isoDate);
  return date.toISOString().split('T')[0];
}

/**
 * Sanitize string for filename
 * @param {string} str - String to sanitize
 * @param {number} maxLength - Max length
 * @returns {string} - Sanitized string
 */
function sanitizeForFilename(str, maxLength = 50) {
  if (!str) return 'untitled';
  return str
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, maxLength)
    .trim();
}

/**
 * List conversations handler - groups emails by conversationId
 * @param {object} args - Tool arguments
 * @param {string} [args.folder] - Folder to search (default: inbox)
 * @param {number} [args.count] - Number of conversations to return (default: 20, max: 50)
 * @param {string} [args.outputVerbosity] - Output verbosity level
 * @returns {object} - MCP response with conversation list
 */
async function handleListConversations(args) {
  const folder = args.folder || 'inbox';
  const count = Math.min(args.count || 20, 50);
  const verbosity = args.outputVerbosity || VERBOSITY.STANDARD;
  // Optional: scope to a shared/delegated mailbox instead of the signed-in user.
  const sharedMailbox = args.sharedMailbox || args.email || null;

  try {
    const accessToken = await ensureAuthenticated();

    // Get recent emails with conversation fields
    const selectFields = [
      'id',
      'subject',
      'from',
      'toRecipients',
      'receivedDateTime',
      'conversationId',
      'conversationIndex',
      'isRead',
      'hasAttachments',
      'bodyPreview',
    ].join(',');

    // resolveFolderPath handles well-known names, custom/localized names, nested
    // paths, and raw IDs, scoped to the signed-in user or the shared mailbox.
    const endpoint = await resolveFolderPath(
      accessToken,
      folder,
      sharedMailbox
    );
    const queryParams = {
      $select: selectFields,
      $orderby: 'receivedDateTime desc',
      $top: 200, // Get more to group
    };

    // Apply simple $filter conditions that Graph API supports on personal accounts
    // Complex filters (contains on subject, endswith on email) cause InefficientFilter
    // errors, so those are handled client-side after fetching.
    const serverFilterConditions = [];
    if (args.hasAttachments === true) {
      serverFilterConditions.push('hasAttachments eq true');
    }
    if (args.receivedAfter) {
      try {
        const afterDate = new Date(args.receivedAfter).toISOString();
        serverFilterConditions.push(`receivedDateTime ge ${afterDate}`);
      } catch (_e) {
        /* ignore invalid date */
      }
    }
    if (args.receivedBefore) {
      try {
        const beforeDate = new Date(args.receivedBefore).toISOString();
        serverFilterConditions.push(`receivedDateTime le ${beforeDate}`);
      } catch (_e) {
        /* ignore invalid date */
      }
    }

    if (serverFilterConditions.length > 0) {
      queryParams.$filter = serverFilterConditions.join(' and ');
    }

    const response = await callGraphAPI(
      accessToken,
      'GET',
      endpoint,
      null,
      queryParams
    );
    let messages = response.value || [];

    // Client-side filtering for conditions that cause InefficientFilter on personal accounts
    if (args.subject) {
      const subjectLower = args.subject.toLowerCase();
      messages = messages.filter((m) =>
        (m.subject || '').toLowerCase().includes(subjectLower)
      );
    }
    if (args.from) {
      const fromLower = args.from.toLowerCase();
      messages = messages.filter((m) => {
        const addr = (m.from?.emailAddress?.address || '').toLowerCase();
        const name = (m.from?.emailAddress?.name || '').toLowerCase();
        return addr.includes(fromLower) || name.includes(fromLower);
      });
    }
    if (args.to) {
      const toLower = args.to.toLowerCase();
      messages = messages.filter((m) =>
        (m.toRecipients || []).some((r) => {
          const addr = (r.emailAddress?.address || '').toLowerCase();
          const name = (r.emailAddress?.name || '').toLowerCase();
          return addr.includes(toLower) || name.includes(toLower);
        })
      );
    }

    // Group by conversationId
    const conversations = new Map();

    messages.forEach((msg) => {
      const convId = msg.conversationId;
      if (!conversations.has(convId)) {
        conversations.set(convId, {
          conversationId: convId,
          subject: msg.subject,
          messages: [],
          participants: new Set(),
          firstDate: msg.receivedDateTime,
          lastDate: msg.receivedDateTime,
          unreadCount: 0,
        });
      }

      const conv = conversations.get(convId);
      conv.messages.push(msg);
      conv.lastDate = msg.receivedDateTime;
      if (msg.from?.emailAddress?.address) {
        conv.participants.add(msg.from.emailAddress.address);
      }
      if (!msg.isRead) {
        conv.unreadCount++;
      }
    });

    // Convert to array and sort by most recent
    const conversationList = Array.from(conversations.values())
      .sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate))
      .slice(0, count);

    // Format output
    const output = [];
    output.push(`# Email Conversations\n`);
    output.push(`**Folder**: ${folder}`);
    output.push(`**Conversations**: ${conversationList.length}`);
    output.push(`**Total Messages Scanned**: ${messages.length}\n`);
    output.push('---\n');

    conversationList.forEach((conv, index) => {
      output.push(`## ${index + 1}. ${conv.subject || '(no subject)'}`);
      output.push(`- **Messages**: ${conv.messages.length}`);
      output.push(`- **Unread**: ${conv.unreadCount}`);
      output.push(
        `- **Participants**: ${Array.from(conv.participants).slice(0, 5).join(', ')}${conv.participants.size > 5 ? '...' : ''}`
      );
      output.push(
        `- **Date Range**: ${formatDateForFilename(conv.firstDate)} → ${formatDateForFilename(conv.lastDate)}`
      );
      output.push(`- **Conversation ID**: \`${conv.conversationId}\``);

      if (verbosity === VERBOSITY.FULL && conv.messages.length > 0) {
        output.push(
          `\n**Latest Preview**: ${conv.messages[0].bodyPreview?.substring(0, 100) || ''}...`
        );
      }
      output.push('');
    });

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        folder,
        conversationCount: conversationList.length,
        totalMessagesScanned: messages.length,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }
    return toolError(`Error listing conversations: ${error.message}`);
  }
}

// Upper bounds on the messages one conversation read/export will load. The
// inline read returns every message in the tool result, so it stops sooner.
const GET_CONVERSATION_MESSAGE_LIMIT = 100;
const EXPORT_CONVERSATION_MESSAGE_LIMIT = 1000;

/**
 * Fetch the messages in a conversation, oldest first (or newest first).
 *
 * Graph rejects `$filter=conversationId eq '…'` combined with `$orderby` on
 * personal Microsoft accounts (400 InefficientFilter), so the query carries no
 * `$orderby`: the pages are fetched and the messages are sorted here. Paging
 * stops at the caller's `limit` or if Graph repeats a nextLink; either
 * way the result is marked truncated. (Not callGraphAPIPaginated: it can't
 * report truncation or catch a repeated nextLink.)
 * @param {string} accessToken - Access token
 * @param {string} prefix - Mailbox prefix (`me` or `users/{mailbox}`)
 * @param {string} conversationId - Conversation ID
 * @param {string} selectFields - `$select` fields
 * @param {object} options
 * @param {number} options.limit - Most messages to load
 * @param {boolean} [options.newestFirst=false] - Sort newest first instead
 * @returns {Promise<{messages: Array<object>, truncated: boolean}>}
 */
async function fetchConversationMessages(
  accessToken,
  prefix,
  conversationId,
  selectFields,
  { limit, newestFirst = false }
) {
  let messages = [];
  let truncated = false;
  const seenLinks = new Set();
  let url = `${prefix}/messages`;
  let queryParams = {
    $select: selectFields,
    $filter: `conversationId eq '${escapeODataString(String(conversationId))}'`,
    $top: Math.min(100, limit),
  };

  while (url) {
    const response = await callGraphAPI(
      accessToken,
      'GET',
      url,
      null,
      queryParams
    );
    messages.push(...(response.value || []));
    const nextLink = response['@odata.nextLink'];
    if (messages.length > limit) {
      messages = messages.slice(0, limit);
      truncated = true;
      break;
    }
    if (nextLink && (messages.length >= limit || seenLinks.has(nextLink))) {
      truncated = true;
      break;
    }
    if (nextLink) seenLinks.add(nextLink);
    url = nextLink;
    queryParams = {}; // the nextLink already carries every parameter
  }

  return { messages: sortByReceivedDate(messages, newestFirst), truncated };
}

/**
 * Note added to output when a conversation hit a fetch limit.
 * @param {number} count - Messages loaded
 * @returns {string}
 */
function truncationNote(count) {
  return `**Note**: Conversation truncated at ${count} messages.`;
}

/**
 * Sort messages by receivedDateTime (stable; messages without a valid date
 * go last in either direction).
 * @param {Array<object>} messages - Messages to sort
 * @param {boolean} newestFirst - Sort newest first instead of oldest first
 * @returns {Array<object>} - New sorted array
 */
function sortByReceivedDate(messages, newestFirst) {
  const time = (msg) => {
    const t = Date.parse(msg.receivedDateTime);
    return Number.isNaN(t) ? null : t;
  };
  return [...messages].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta === null || tb === null) return (ta === null) - (tb === null);
    return newestFirst ? tb - ta : ta - tb;
  });
}

/**
 * Get conversation handler - retrieves all messages in a thread
 * @param {object} args - Tool arguments
 * @param {string} args.conversationId - Conversation ID (required)
 * @param {boolean} [args.includeHeaders] - Include email headers
 * @param {string} [args.outputVerbosity] - Output verbosity level
 * @returns {object} - MCP response with conversation messages
 */
async function handleGetConversation(args) {
  const conversationId = args.conversationId;
  const includeHeaders = args.includeHeaders || false;
  const verbosity = args.outputVerbosity || VERBOSITY.STANDARD;
  const sharedMailbox = args.sharedMailbox || args.email || null;
  const prefix = buildMailboxPrefix(sharedMailbox);

  if (!conversationId) {
    return toolError('Conversation ID is required.');
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Select appropriate fields
    const fieldPreset = includeHeaders ? 'forensic' : 'conversation';
    const selectFields = getEmailFields(fieldPreset);

    // Search all folders for messages with this conversation ID
    const { messages, truncated } = await fetchConversationMessages(
      accessToken,
      prefix,
      conversationId,
      selectFields,
      { limit: GET_CONVERSATION_MESSAGE_LIMIT }
    );

    if (messages.length === 0) {
      return toolError(
        `No messages found for conversation ID: ${conversationId}`
      );
    }

    // Format output
    const output = [];
    output.push(`# Email Conversation\n`);
    output.push(`**Subject**: ${messages[0].subject || '(no subject)'}`);
    output.push(`**Messages**: ${messages.length}`);
    output.push(`**Conversation ID**: \`${conversationId}\`\n`);
    if (truncated) output.push(`${truncationNote(messages.length)}\n`);
    output.push('---\n');

    messages.forEach((msg, index) => {
      output.push(`## Message ${index + 1} of ${messages.length}`);
      output.push(formatEmailContent(msg, verbosity, { includeHeaders }));
      output.push('\n---\n');
    });

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        conversationId,
        messageCount: messages.length,
        subject: messages[0]?.subject,
        truncated,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }
    return toolError(`Error getting conversation: ${error.message}`);
  }
}

/**
 * Export conversation handler - exports entire thread to various formats
 * @param {object} args - Tool arguments
 * @param {string} args.conversationId - Conversation ID (required)
 * @param {string} [args.format] - Export format (eml, mbox, markdown, json, html)
 * @param {string} [args.outputDir] - Output directory (required)
 * @param {boolean} [args.includeAttachments] - Include attachments (default: true)
 * @param {string} [args.order] - Message order: 'chronological' or 'reverse' (default: chronological)
 * @returns {object} - MCP response with export status
 */
async function handleExportConversation(args) {
  const conversationId = args.conversationId;
  const format = (args.format || 'markdown').toLowerCase();
  // F-29: default outputDir to os.tmpdir() to match target=message
  // behaviour. Previously conversation export rejected calls without
  // outputDir, inconsistent with the other export targets.
  const outputDir = args.outputDir || require('os').tmpdir();
  const _includeAttachments = args.includeAttachments !== false;
  const order = args.order || 'chronological';
  const sharedMailbox = args.sharedMailbox || args.email || null;
  const prefix = buildMailboxPrefix(sharedMailbox);

  if (!conversationId) {
    return toolError('Conversation ID is required.');
  }

  const validFormats = ['eml', 'mbox', 'markdown', 'json', 'html', 'csv'];
  if (!validFormats.includes(format)) {
    return toolError(`Invalid format. Use: ${validFormats.join(', ')}`);
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Get all messages in conversation
    const { messages, truncated } = await fetchConversationMessages(
      accessToken,
      prefix,
      conversationId,
      getEmailFields('export'),
      {
        limit: EXPORT_CONVERSATION_MESSAGE_LIMIT,
        newestFirst: order === 'reverse',
      }
    );

    if (messages.length === 0) {
      return toolError(
        `No messages found for conversation ID: ${conversationId}`
      );
    }

    // Create output directory
    const resolvedDir = path.resolve(outputDir);
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    // Generate filename base
    const subject = sanitizeForFilename(messages[0].subject);
    const date = formatDateForFilename(messages[0].receivedDateTime);
    const filenameBase = `${date}_${subject}_conversation`;

    // Every file is written exclusively (never overwrites, never follows a
    // symlink); a name already taken gets a -1, -2, … suffix.
    const writeExport = (dir, base, extension, content) =>
      writeClaimedFile(dir, base, extension, null, content, 'utf8');

    const exportedFiles = [];
    const exportStats = { messages: messages.length, attachments: 0, bytes: 0 };

    switch (format) {
      case 'eml': {
        // Export each message as individual .eml file, into a directory this
        // export creates (never an existing one, which could be a symlink).
        const emlDir = makeClaimedDir(resolvedDir, filenameBase);

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          const mimeContent = await callGraphAPIRaw(
            accessToken,
            msg.id,
            prefix
          );
          const msgDate = formatDateForFilename(msg.receivedDateTime);
          const emlPath = writeExport(
            emlDir,
            `${i + 1}_${msgDate}_${sanitizeForFilename(msg.from?.emailAddress?.name || 'unknown', 20)}`,
            'eml',
            mimeContent
          );
          exportStats.bytes += Buffer.byteLength(mimeContent, 'utf8');
          exportedFiles.push(emlPath);
        }
        break;
      }

      case 'mbox': {
        // Export all messages to single MBOX file
        let mboxContent = '';

        for (const msg of messages) {
          const mimeContent = await callGraphAPIRaw(
            accessToken,
            msg.id,
            prefix
          );
          const from = msg.from?.emailAddress?.address || 'unknown@unknown.com';
          const msgDate = new Date(msg.receivedDateTime);
          const mboxDate = msgDate.toUTCString().replace('GMT', '+0000');

          // MBOX format: From line + MIME content + blank line
          mboxContent += `From ${from} ${mboxDate}\n`;
          mboxContent += mimeContent.replace(/^From /gm, '>From '); // Escape From lines
          mboxContent += '\n\n';
        }

        const mboxPath = writeExport(
          resolvedDir,
          filenameBase,
          'mbox',
          mboxContent
        );
        exportStats.bytes = Buffer.byteLength(mboxContent, 'utf8');
        exportedFiles.push(mboxPath);
        break;
      }

      case 'markdown': {
        // Export as threaded Markdown document
        const mdContent = [];

        mdContent.push(
          `# Email Conversation: ${messages[0].subject || '(no subject)'}\n`
        );
        mdContent.push(`**Exported**: ${new Date().toISOString()}`);
        mdContent.push(`**Messages**: ${messages.length}`);
        mdContent.push(`**Conversation ID**: \`${conversationId}\`\n`);
        mdContent.push('---\n');

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          mdContent.push(`## Message ${i + 1}/${messages.length}\n`);
          mdContent.push(
            `**From**: ${msg.from?.emailAddress?.name || ''} <${msg.from?.emailAddress?.address || ''}>`
          );
          mdContent.push(
            `**To**: ${msg.toRecipients?.map((r) => r.emailAddress?.address).join(', ') || ''}`
          );
          if (msg.ccRecipients?.length) {
            mdContent.push(
              `**CC**: ${msg.ccRecipients.map((r) => r.emailAddress?.address).join(', ')}`
            );
          }
          mdContent.push(`**Date**: ${msg.receivedDateTime}`);
          mdContent.push(`**Subject**: ${msg.subject || '(no subject)'}\n`);

          // Body content
          if (msg.body?.content) {
            if (msg.body.contentType === 'html') {
              mdContent.push(stripHtml(msg.body.content));
            } else {
              mdContent.push(msg.body.content);
            }
          }

          if (msg.hasAttachments) {
            mdContent.push(
              `\n*[${msg.hasAttachments ? 'Has attachments' : 'No attachments'}]*`
            );
          }

          mdContent.push('\n---\n');
        }

        const content = mdContent.join('\n');
        const mdPath = writeExport(resolvedDir, filenameBase, 'md', content);
        exportStats.bytes = Buffer.byteLength(content, 'utf8');
        exportedFiles.push(mdPath);
        break;
      }

      case 'json': {
        // Export as JSON
        const jsonContent = JSON.stringify(
          {
            conversationId,
            subject: messages[0].subject,
            exportedAt: new Date().toISOString(),
            messageCount: messages.length,
            messages: messages,
          },
          null,
          2
        );

        const jsonPath = writeExport(
          resolvedDir,
          filenameBase,
          'json',
          jsonContent
        );
        exportStats.bytes = Buffer.byteLength(jsonContent, 'utf8');
        exportedFiles.push(jsonPath);
        break;
      }

      case 'html': {
        // Export as HTML document
        const htmlContent = [];

        htmlContent.push('<!DOCTYPE html>');
        htmlContent.push('<html><head>');
        htmlContent.push(
          `<title>${messages[0].subject || 'Email Conversation'}</title>`
        );
        htmlContent.push('<meta charset="utf-8">');
        htmlContent.push('<style>');
        htmlContent.push(
          'body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }'
        );
        htmlContent.push(
          '.message { border: 1px solid #ddd; margin: 20px 0; padding: 15px; border-radius: 5px; }'
        );
        htmlContent.push(
          '.header { color: #666; font-size: 0.9em; margin-bottom: 10px; }'
        );
        htmlContent.push('.body { white-space: pre-wrap; }');
        htmlContent.push('</style>');
        htmlContent.push('</head><body>');
        htmlContent.push(
          `<h1>${messages[0].subject || 'Email Conversation'}</h1>`
        );
        htmlContent.push(
          `<p><strong>Messages:</strong> ${messages.length} | <strong>Exported:</strong> ${new Date().toISOString()}</p>`
        );
        htmlContent.push('<hr>');

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          htmlContent.push('<div class="message">');
          htmlContent.push('<div class="header">');
          htmlContent.push(
            `<strong>From:</strong> ${msg.from?.emailAddress?.name || ''} &lt;${msg.from?.emailAddress?.address || ''}&gt;<br>`
          );
          htmlContent.push(
            `<strong>Date:</strong> ${msg.receivedDateTime}<br>`
          );
          htmlContent.push(
            `<strong>Subject:</strong> ${msg.subject || '(no subject)'}`
          );
          htmlContent.push('</div>');
          htmlContent.push('<div class="body">');

          if (msg.body?.contentType === 'html') {
            htmlContent.push(msg.body.content);
          } else {
            htmlContent.push(`<pre>${msg.body?.content || ''}</pre>`);
          }

          htmlContent.push('</div></div>');
        }

        htmlContent.push('</body></html>');
        const content = htmlContent.join('\n');
        const htmlPath = writeExport(
          resolvedDir,
          filenameBase,
          'html',
          content
        );
        exportStats.bytes = Buffer.byteLength(content, 'utf8');
        exportedFiles.push(htmlPath);
        break;
      }

      case 'csv': {
        // Export as CSV
        const csvContent = formatEmailsAsCSV(messages);
        const csvPath = writeExport(
          resolvedDir,
          filenameBase,
          'csv',
          csvContent
        );
        exportStats.bytes = Buffer.byteLength(csvContent, 'utf8');
        exportedFiles.push(csvPath);
        break;
      }
    }

    // Format result
    let sizeFormatted;
    if (exportStats.bytes < 1024) {
      sizeFormatted = `${exportStats.bytes} B`;
    } else if (exportStats.bytes < 1024 * 1024) {
      sizeFormatted = `${(exportStats.bytes / 1024).toFixed(1)} KB`;
    } else {
      sizeFormatted = `${(exportStats.bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    const output = [];
    output.push(`# Conversation Exported\n`);
    output.push(`**Subject**: ${messages[0].subject || '(no subject)'}`);
    output.push(`**Format**: ${format.toUpperCase()}`);
    output.push(`**Messages**: ${exportStats.messages}`);
    if (truncated) output.push(truncationNote(exportStats.messages));
    output.push(`**Total Size**: ${sizeFormatted}`);
    output.push(`**Output Directory**: ${resolvedDir}\n`);
    output.push('## Exported Files\n');
    exportedFiles.forEach((f) => output.push(`- \`${path.basename(f)}\``));

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        conversationId,
        format,
        messageCount: exportStats.messages,
        bytes: exportStats.bytes,
        files: exportedFiles,
        truncated,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }
    return toolError(`Error exporting conversation: ${error.message}`);
  }
}

module.exports = {
  handleListConversations,
  handleGetConversation,
  handleExportConversation,
};
