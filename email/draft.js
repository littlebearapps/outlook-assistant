/**
 * Draft email functionality
 *
 * Supports creating, updating, sending, and deleting drafts,
 * plus creating reply/reply-all/forward drafts from existing messages.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const {
  checkRateLimit,
  checkRecipientAllowlist,
  formatDryRunPreview,
} = require('../utils/safety');
const { handleGetMailTips } = require('./mail-tips');

/**
 * Format comma-separated email string into Graph API recipient objects
 * @param {string} recipientString - Comma-separated email addresses
 * @returns {Array<{emailAddress: {address: string}}>}
 */
function formatRecipients(recipientString) {
  if (!recipientString) return [];
  return recipientString.split(',').map((email) => ({
    emailAddress: { address: email.trim() },
  }));
}

/**
 * Auto-detect HTML vs plain text body
 * @param {string} body - Email body content
 * @returns {'html'|'text'}
 */
function detectContentType(body) {
  if (!body) return 'text';
  return /<(html|div|p|h[1-6]|br|table|ul|ol|li|span|a\s|img|strong|em|b|i)\b/i.test(
    body
  )
    ? 'html'
    : 'text';
}

/**
 * Build a message object from draft parameters
 * @param {object} args - Draft parameters
 * @returns {object} - Graph API message object
 */
function buildMessageObject(args) {
  const { to, cc, bcc, subject, body, importance } = args;
  const message = {};

  if (subject !== undefined) message.subject = subject;
  if (body !== undefined) {
    message.body = {
      contentType: detectContentType(body),
      content: body,
    };
  }
  if (importance) message.importance = importance;

  const toRecipients = formatRecipients(to);
  const ccRecipients = formatRecipients(cc);
  const bccRecipients = formatRecipients(bcc);

  if (toRecipients.length > 0) message.toRecipients = toRecipients;
  if (ccRecipients.length > 0) message.ccRecipients = ccRecipients;
  if (bccRecipients.length > 0) message.bccRecipients = bccRecipients;

  return message;
}

/**
 * Format a draft response with key details
 * @param {object} draft - Graph API message response
 * @param {string} actionLabel - Human-readable action (e.g. "created", "updated")
 * @returns {object} - MCP response
 */
function formatDraftResponse(draft, actionLabel) {
  const to = (draft.toRecipients || [])
    .map((r) => r.emailAddress?.address)
    .join(', ');

  let text = `Draft ${actionLabel}.\n\n`;
  text += `**ID**: \`${draft.id}\`\n`;
  if (draft.subject) text += `**Subject**: ${draft.subject}\n`;
  if (to) text += `**To**: ${to}\n`;
  if (draft.lastModifiedDateTime)
    text += `**Modified**: ${draft.lastModifiedDateTime}\n`;
  if (draft.hasAttachments) text += `**Attachments**: yes\n`;

  return {
    content: [{ type: 'text', text }],
    _meta: { draftId: draft.id },
  };
}

/**
 * Draft handler — routes to action-specific logic
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleDraft(args) {
  const { action } = args;

  if (!action) {
    return {
      content: [
        {
          type: 'text',
          text: "Action is required. Use 'create', 'update', 'send', 'delete', 'reply', 'reply-all', or 'forward'.",
        },
      ],
    };
  }

  switch (action) {
    case 'create':
      return handleCreateDraft(args);
    case 'update':
      return handleUpdateDraft(args);
    case 'send':
      return handleSendDraft(args);
    case 'delete':
      return handleDeleteDraft(args);
    case 'reply':
      return handleReplyDraft(args, 'createReply');
    case 'reply-all':
      return handleReplyDraft(args, 'createReplyAll');
    case 'forward':
      return handleForwardDraft(args);
    default:
      return {
        content: [
          {
            type: 'text',
            text: `Invalid action '${action}'. Use 'create', 'update', 'send', 'delete', 'reply', 'reply-all', or 'forward'.`,
          },
        ],
      };
  }
}

/**
 * Create a new draft
 */
async function handleCreateDraft(args) {
  const { dryRun = false, checkRecipients: doCheckRecipients = false } = args;
  const message = buildMessageObject(args);

  // Check recipient allowlist if recipients specified
  const allRecipients = [
    ...(message.toRecipients || []),
    ...(message.ccRecipients || []),
    ...(message.bccRecipients || []),
  ];
  if (allRecipients.length > 0) {
    const allowlistError = checkRecipientAllowlist(allRecipients);
    if (allowlistError) return allowlistError;
  }

  // Pre-save recipient validation via mail-tips
  if (doCheckRecipients && allRecipients.length > 0) {
    const allAddresses = allRecipients.map((r) => r.emailAddress.address);
    const tipsResult = await handleGetMailTips({ recipients: allAddresses });
    const tipsText = tipsResult.content[0]?.text || '';

    if (dryRun) {
      const preview = formatDryRunPreview({ message, saveToSentItems: true });
      return {
        content: [
          {
            type: 'text',
            text:
              tipsText +
              '\n\n---\n\n' +
              preview.content[0].text.replace(
                'Email NOT sent',
                'Draft NOT saved'
              ),
          },
        ],
        _meta: { mailTips: tipsResult._meta },
      };
    }
  }

  // Dry-run mode: preview without saving
  if (dryRun) {
    const preview = formatDryRunPreview({ message, saveToSentItems: true });
    return {
      content: [
        {
          type: 'text',
          text: preview.content[0].text.replace(
            'Email NOT sent',
            'Draft NOT saved'
          ),
        },
      ],
    };
  }

  // Rate limit check
  const rateLimitError = checkRateLimit('draft');
  if (rateLimitError) return rateLimitError;

  try {
    const accessToken = await ensureAuthenticated();
    const draft = await callGraphAPI(
      accessToken,
      'POST',
      'me/messages',
      message
    );
    return formatDraftResponse(draft, 'created');
  } catch (error) {
    return handleError('creating draft', error);
  }
}

/**
 * Update an existing draft
 */
async function handleUpdateDraft(args) {
  const { id } = args;

  if (!id) {
    return {
      content: [
        { type: 'text', text: 'Draft ID (id) is required for update.' },
      ],
    };
  }

  const message = buildMessageObject(args);

  // Check recipient allowlist if recipients changed
  const allRecipients = [
    ...(message.toRecipients || []),
    ...(message.ccRecipients || []),
    ...(message.bccRecipients || []),
  ];
  if (allRecipients.length > 0) {
    const allowlistError = checkRecipientAllowlist(allRecipients);
    if (allowlistError) return allowlistError;
  }

  // Rate limit check
  const rateLimitError = checkRateLimit('draft');
  if (rateLimitError) return rateLimitError;

  try {
    const accessToken = await ensureAuthenticated();
    const draft = await callGraphAPI(
      accessToken,
      'PATCH',
      `me/messages/${id}`,
      message
    );
    return formatDraftResponse(draft, 'updated');
  } catch (error) {
    return handleError('updating draft', error);
  }
}

/**
 * Send an existing draft
 */
async function handleSendDraft(args) {
  const { id } = args;

  if (!id) {
    return {
      content: [{ type: 'text', text: 'Draft ID (id) is required for send.' }],
    };
  }

  // Rate limit via send-email counter (shares limit with direct sends)
  const rateLimitError = checkRateLimit('send-email');
  if (rateLimitError) return rateLimitError;

  try {
    const accessToken = await ensureAuthenticated();
    await callGraphAPI(accessToken, 'POST', `me/messages/${id}/send`);
    return {
      content: [
        {
          type: 'text',
          text: `Draft sent successfully.\n\n**Note**: The draft ID \`${id}\` is no longer valid — the message has been moved to Sent Items with a new ID.`,
        },
      ],
    };
  } catch (error) {
    return handleError('sending draft', error);
  }
}

/**
 * Delete a draft
 */
async function handleDeleteDraft(args) {
  const { id } = args;

  if (!id) {
    return {
      content: [
        { type: 'text', text: 'Draft ID (id) is required for delete.' },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();
    await callGraphAPI(accessToken, 'DELETE', `me/messages/${id}`);
    return {
      content: [
        {
          type: 'text',
          text: `Draft \`${id}\` deleted.`,
        },
      ],
    };
  } catch (error) {
    return handleError('deleting draft', error);
  }
}

/**
 * Create a reply or reply-all draft from an existing message
 */
async function handleReplyDraft(args, endpoint) {
  const { id, body, comment } = args;

  if (!id) {
    return {
      content: [
        {
          type: 'text',
          text: `Message ID (id) is required for ${endpoint === 'createReplyAll' ? 'reply-all' : 'reply'}.`,
        },
      ],
    };
  }

  if (comment && body) {
    return {
      content: [
        {
          type: 'text',
          text: 'Cannot use both comment and body. Use comment for a short prepended note, or body for full HTML/text content.',
        },
      ],
    };
  }

  const requestBody = {};
  if (comment) {
    requestBody.comment = comment;
  } else if (body) {
    requestBody.message = {
      body: {
        contentType: detectContentType(body),
        content: body,
      },
    };
  }

  try {
    const accessToken = await ensureAuthenticated();
    const draft = await callGraphAPI(
      accessToken,
      'POST',
      `me/messages/${id}/${endpoint}`,
      Object.keys(requestBody).length > 0 ? requestBody : null
    );
    const label =
      endpoint === 'createReplyAll'
        ? 'reply-all draft created'
        : 'reply draft created';
    return formatDraftResponse(draft, label);
  } catch (error) {
    return handleError(
      `creating ${endpoint === 'createReplyAll' ? 'reply-all' : 'reply'} draft`,
      error
    );
  }
}

/**
 * Create a forward draft from an existing message
 */
async function handleForwardDraft(args) {
  const { id, to, body, comment } = args;

  if (!id) {
    return {
      content: [
        { type: 'text', text: 'Message ID (id) is required for forward.' },
      ],
    };
  }

  if (!to) {
    return {
      content: [
        {
          type: 'text',
          text: 'Forward recipient (to) is required for forward.',
        },
      ],
    };
  }

  if (comment && body) {
    return {
      content: [
        {
          type: 'text',
          text: 'Cannot use both comment and body. Use comment for a short prepended note, or body for full HTML/text content.',
        },
      ],
    };
  }

  const toRecipients = formatRecipients(to);

  // Check recipient allowlist
  const allowlistError = checkRecipientAllowlist(toRecipients);
  if (allowlistError) return allowlistError;

  const requestBody = {
    toRecipients,
  };

  if (comment) {
    requestBody.comment = comment;
  } else if (body) {
    requestBody.message = {
      body: {
        contentType: detectContentType(body),
        content: body,
      },
    };
  }

  try {
    const accessToken = await ensureAuthenticated();
    const draft = await callGraphAPI(
      accessToken,
      'POST',
      `me/messages/${id}/createForward`,
      requestBody
    );
    return formatDraftResponse(draft, 'forward draft created');
  } catch (error) {
    return handleError('creating forward draft', error);
  }
}

/**
 * Standard error handler
 */
function handleError(actionLabel, error) {
  if (error.message === 'Authentication required') {
    return {
      content: [
        {
          type: 'text',
          text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Error ${actionLabel}: ${error.message}`,
      },
    ],
  };
}

module.exports = handleDraft;
