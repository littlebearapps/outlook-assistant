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
const {
  formatEmailContent,
  formatEmailsAsCSV,
  VERBOSITY,
} = require('../utils/response-formatter');
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

    const endpoint = `me/mailFolders/${folder}/messages`;
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
    let conversationList = Array.from(conversations.values())
      .sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate))
      .slice(0, count);

    // Format output
    let output = [];
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
        { type: 'text', text: `Error listing conversations: ${error.message}` },
      ],
    };
  }
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

  if (!conversationId) {
    return {
      content: [{ type: 'text', text: 'Conversation ID is required.' }],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Select appropriate fields
    const fieldPreset = includeHeaders ? 'forensic' : 'conversation';
    const selectFields = getEmailFields(fieldPreset);

    // Search all folders for messages with this conversation ID
    const endpoint = 'me/messages';
    const queryParams = {
      $select: selectFields,
      $filter: `conversationId eq '${conversationId}'`,
      $orderby: 'receivedDateTime asc',
      $top: 100,
    };

    let response;
    try {
      response = await callGraphAPI(
        accessToken,
        'GET',
        endpoint,
        null,
        queryParams
      );
    } catch (apiError) {
      if (
        apiError.message.includes('ErrorInvalidUrlQueryFilter') ||
        apiError.message.includes('InefficientFilter') ||
        apiError.message.includes('filter')
      ) {
        return {
          content: [
            {
              type: 'text',
              text: `Conversation retrieval by conversationId is not supported on personal Microsoft accounts. Use read-email with individual message IDs instead.`,
            },
          ],
        };
      }
      throw apiError;
    }
    const messages = response.value || [];

    if (messages.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No messages found for conversation ID: ${conversationId}`,
          },
        ],
      };
    }

    // Format output
    let output = [];
    output.push(`# Email Conversation\n`);
    output.push(`**Subject**: ${messages[0].subject || '(no subject)'}`);
    output.push(`**Messages**: ${messages.length}`);
    output.push(`**Conversation ID**: \`${conversationId}\`\n`);
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
        { type: 'text', text: `Error getting conversation: ${error.message}` },
      ],
    };
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
  const outputDir = args.outputDir;
  const _includeAttachments = args.includeAttachments !== false;
  const order = args.order || 'chronological';

  if (!conversationId) {
    return {
      content: [{ type: 'text', text: 'Conversation ID is required.' }],
    };
  }

  if (!outputDir) {
    return {
      content: [{ type: 'text', text: 'Output directory is required.' }],
    };
  }

  const validFormats = ['eml', 'mbox', 'markdown', 'json', 'html', 'csv'];
  if (!validFormats.includes(format)) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid format. Use: ${validFormats.join(', ')}`,
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Get all messages in conversation
    const selectFields = getEmailFields('export');
    const endpoint = 'me/messages';
    const queryParams = {
      $select: selectFields,
      $filter: `conversationId eq '${conversationId}'`,
      $orderby: `receivedDateTime ${order === 'reverse' ? 'desc' : 'asc'}`,
      $top: 100,
    };

    let response;
    try {
      response = await callGraphAPI(
        accessToken,
        'GET',
        endpoint,
        null,
        queryParams
      );
    } catch (apiError) {
      if (
        apiError.message.includes('ErrorInvalidUrlQueryFilter') ||
        apiError.message.includes('InefficientFilter') ||
        apiError.message.includes('filter')
      ) {
        return {
          content: [
            {
              type: 'text',
              text: `Conversation export is not supported on personal Microsoft accounts. Use export with target=message and individual message IDs instead.`,
            },
          ],
        };
      }
      throw apiError;
    }
    const messages = response.value || [];

    if (messages.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No messages found for conversation ID: ${conversationId}`,
          },
        ],
      };
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

    let exportedFiles = [];
    let exportStats = { messages: messages.length, attachments: 0, bytes: 0 };

    switch (format) {
      case 'eml': {
        // Export each message as individual .eml file
        const emlDir = path.join(resolvedDir, filenameBase);
        if (!fs.existsSync(emlDir)) {
          fs.mkdirSync(emlDir, { recursive: true });
        }

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          const mimeContent = await callGraphAPIRaw(accessToken, msg.id);
          const msgDate = formatDateForFilename(msg.receivedDateTime);
          const emlPath = path.join(
            emlDir,
            `${i + 1}_${msgDate}_${sanitizeForFilename(msg.from?.emailAddress?.name || 'unknown', 20)}.eml`
          );
          fs.writeFileSync(emlPath, mimeContent, 'utf8');
          exportStats.bytes += Buffer.byteLength(mimeContent, 'utf8');
          exportedFiles.push(emlPath);
        }
        break;
      }

      case 'mbox': {
        // Export all messages to single MBOX file
        const mboxPath = path.join(resolvedDir, `${filenameBase}.mbox`);
        let mboxContent = '';

        for (const msg of messages) {
          const mimeContent = await callGraphAPIRaw(accessToken, msg.id);
          const from = msg.from?.emailAddress?.address || 'unknown@unknown.com';
          const date = new Date(msg.receivedDateTime);
          const mboxDate = date.toUTCString().replace('GMT', '+0000');

          // MBOX format: From line + MIME content + blank line
          mboxContent += `From ${from} ${mboxDate}\n`;
          mboxContent += mimeContent.replace(/^From /gm, '>From '); // Escape From lines
          mboxContent += '\n\n';
        }

        fs.writeFileSync(mboxPath, mboxContent, 'utf8');
        exportStats.bytes = Buffer.byteLength(mboxContent, 'utf8');
        exportedFiles.push(mboxPath);
        break;
      }

      case 'markdown': {
        // Export as threaded Markdown document
        const mdPath = path.join(resolvedDir, `${filenameBase}.md`);
        let mdContent = [];

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
              // Simple HTML to text conversion
              const text = msg.body.content
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p>/gi, '\n\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&');
              mdContent.push(text.trim());
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
        fs.writeFileSync(mdPath, content, 'utf8');
        exportStats.bytes = Buffer.byteLength(content, 'utf8');
        exportedFiles.push(mdPath);
        break;
      }

      case 'json': {
        // Export as JSON
        const jsonPath = path.join(resolvedDir, `${filenameBase}.json`);
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

        fs.writeFileSync(jsonPath, jsonContent, 'utf8');
        exportStats.bytes = Buffer.byteLength(jsonContent, 'utf8');
        exportedFiles.push(jsonPath);
        break;
      }

      case 'html': {
        // Export as HTML document
        const htmlPath = path.join(resolvedDir, `${filenameBase}.html`);
        let htmlContent = [];

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
        fs.writeFileSync(htmlPath, content, 'utf8');
        exportStats.bytes = Buffer.byteLength(content, 'utf8');
        exportedFiles.push(htmlPath);
        break;
      }

      case 'csv': {
        // Export as CSV
        const csvPath = path.join(resolvedDir, `${filenameBase}.csv`);
        const csvContent = formatEmailsAsCSV(messages);
        fs.writeFileSync(csvPath, csvContent, 'utf8');
        exportStats.bytes = Buffer.byteLength(csvContent, 'utf8');
        exportedFiles.push(csvPath);
        break;
      }
    }

    // Format result
    const sizeFormatted =
      exportStats.bytes < 1024
        ? `${exportStats.bytes} B`
        : exportStats.bytes < 1024 * 1024
          ? `${(exportStats.bytes / 1024).toFixed(1)} KB`
          : `${(exportStats.bytes / (1024 * 1024)).toFixed(2)} MB`;

    let output = [];
    output.push(`# Conversation Exported\n`);
    output.push(`**Subject**: ${messages[0].subject || '(no subject)'}`);
    output.push(`**Format**: ${format.toUpperCase()}`);
    output.push(`**Messages**: ${exportStats.messages}`);
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
          text: `Error exporting conversation: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = {
  handleListConversations,
  handleGetConversation,
  handleExportConversation,
};
