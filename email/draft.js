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
  releaseRateLimit,
  checkRecipientAllowlist,
  findBlockedRecipients,
  getRecipientAllowlist,
  formatDryRunPreview,
} = require('../utils/safety');
const { handleGetMailTips } = require('./mail-tips');
const { toolError, authRequiredError } = require('../utils/tool-error');
const { resolveSendMailbox, sharedFrom } = require('../utils/mailbox');
const { sharedSendError } = require('../utils/graph-failure');

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

/** Graph fields holding a message's recipients. */
const RECIPIENT_FIELDS = ['toRecipients', 'ccRecipients', 'bccRecipients'];

/**
 * Every to/cc/bcc recipient on a Graph message.
 * @param {object} message - Graph message
 * @returns {Array<{emailAddress: {address: string}}>}
 */
function recipientsOf(message) {
  return RECIPIENT_FIELDS.flatMap((field) => message?.[field] || []);
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

/** "Drafts", or "the Drafts of shared@…" for a shared mailbox. */
function draftsOf(sharedMailbox) {
  return sharedMailbox ? `the Drafts of ${sharedMailbox}` : 'Drafts';
}

/** " sharedMailbox=shared@…" for a follow-up call hint, or '' for your own. */
function sharedMailboxArg(sharedMailbox) {
  return sharedMailbox ? ` sharedMailbox=${sharedMailbox}` : '';
}

/**
 * Format a draft response with key details
 * @param {object} draft - Graph API message response
 * @param {string} actionLabel - Heading, e.g. "Draft created" or "Reply draft created"
 * @returns {object} - MCP response
 */
function formatDraftResponse(draft, actionLabel) {
  const to = (draft.toRecipients || [])
    .map((r) => r.emailAddress?.address)
    .join(', ');

  let text = `${actionLabel}.\n\n`;
  text += `**ID**: \`${draft.id}\`\n`;
  if (draft.subject) text += `**Subject**: ${draft.subject}\n`;
  if (to) text += `**To**: ${to}\n`;
  if (draft.lastModifiedDateTime) {
    text += `**Modified**: ${draft.lastModifiedDateTime}\n`;
  }
  if (draft.hasAttachments) text += `**Attachments**: yes\n`;

  return {
    content: [{ type: 'text', text }],
    _meta: { draftId: draft.id },
  };
}

/**
 * Raised when update/send/delete is pointed at something that is not an
 * unsent draft. Carries the user-facing message; handleError turns it into
 * a tool error without the generic "Error ..." prefix.
 */
class DraftGuardError extends Error {}

/**
 * Refuse to mutate anything that is not an unsent draft. Graph's PATCH,
 * DELETE and /send accept any message id, so without this check a received
 * or sent message could be edited, deleted or re-sent (#246).
 * @param {string} accessToken - Graph access token
 * @param {string} prefix - Mailbox prefix: `me` or `users/{mailbox}`
 * @param {string} id - Message id the caller passed as the draft id
 * @param {string} action - The draft action being guarded (for the message)
 * @param {string[]} [extraFields] - Further fields to fetch in the same GET
 * @returns {Promise<object>} The draft, with id, isDraft, subject and extraFields
 * @throws {DraftGuardError} If the id is not a draft or does not exist
 */
async function assertIsDraft(
  accessToken,
  prefix,
  id,
  action,
  extraFields = []
) {
  let message;
  try {
    message = await callGraphAPI(
      accessToken,
      'GET',
      `${prefix}/messages/${id}`,
      null,
      {
        $select: ['id', 'isDraft', 'subject', ...extraFields].join(','),
      }
    );
  } catch (error) {
    if (/status 404\b|ErrorItemNotFound/.test(error.message)) {
      throw new DraftGuardError(
        `Draft not found: \`${id}\`. It may already have been sent or deleted, or the ID is wrong. IDs belong to their mailbox: pass the \`sharedMailbox\` the draft was created in, or leave it out for your own drafts.`
      );
    }
    throw error;
  }

  if (message?.isDraft !== true) {
    const subject = message?.subject ? ` ("${message.subject}")` : '';
    throw new DraftGuardError(
      `Message \`${id}\`${subject} is not a draft, so draft action=${action} refused it and nothing was changed. update/send/delete only act on unsent drafts.`
    );
  }
  return message;
}

/**
 * Draft handler — routes to action-specific logic
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleDraft(args) {
  const { action } = args;

  if (!action) {
    return toolError(
      "Action is required. Use 'create', 'update', 'send', 'delete', 'reply', 'reply-all', or 'forward'."
    );
  }

  // Refused before any request, dry runs included, while the opt-in is off.
  let mailbox;
  try {
    mailbox = resolveSendMailbox(args);
  } catch (error) {
    return toolError(`Nothing was changed: ${error.message}`);
  }

  switch (action) {
    case 'create':
      return handleCreateDraft(args, mailbox);
    case 'update':
      return handleUpdateDraft(args, mailbox);
    case 'send':
      return handleSendDraft(args, mailbox);
    case 'delete':
      return handleDeleteDraft(args, mailbox);
    case 'reply':
      return handleReplyDraft(args, mailbox, 'createReply');
    case 'reply-all':
      return handleReplyDraft(args, mailbox, 'createReplyAll');
    case 'forward':
      return handleForwardDraft(args, mailbox);
    default:
      return toolError(
        `Invalid action '${action}'. Use 'create', 'update', 'send', 'delete', 'reply', 'reply-all', or 'forward'.`
      );
  }
}

/**
 * Create a new draft
 */
async function handleCreateDraft(args, { prefix, sharedMailbox }) {
  const { dryRun = false, checkRecipients: doCheckRecipients = false } = args;
  const message = buildMessageObject(args);
  if (sharedMailbox) message.from = sharedFrom(sharedMailbox);

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

  // Pre-save recipient validation via mail-tips. The tips are returned
  // with the result, never added to the draft payload (#272).
  let tipsResult = null;
  if (doCheckRecipients && allRecipients.length > 0) {
    const allAddresses = allRecipients.map((r) => r.emailAddress.address);
    tipsResult = await handleGetMailTips(
      { recipients: allAddresses },
      { prefix, sharedMailbox }
    );
    const tipsText = tipsResult.content[0]?.text || '';

    if (dryRun) {
      const preview = formatDryRunPreview({ message, isDraft: true });
      return {
        content: [
          {
            type: 'text',
            text: `${tipsText}\n\n---\n\n${preview.content[0].text.replace(
              'Email NOT sent',
              'Draft NOT saved'
            )}`,
          },
        ],
        _meta: { mailTips: tipsResult._meta },
      };
    }
  }

  // Dry-run mode: preview without saving
  if (dryRun) {
    const preview = formatDryRunPreview({ message, isDraft: true });
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
      `${prefix}/messages`,
      message
    );
    const response = formatDraftResponse(draft, 'Draft created');
    if (tipsResult) {
      response.content[0].text += `\n---\n\n${tipsResult.content[0]?.text || ''}`;
      response._meta.mailTips = tipsResult._meta;
    }
    return response;
  } catch (error) {
    return handleError('creating draft', error, sharedMailbox);
  }
}

/**
 * Update an existing draft
 */
async function handleUpdateDraft(args, { prefix, sharedMailbox }) {
  const { id } = args;

  if (!id) {
    return toolError('Draft ID (id) is required for update.');
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

  try {
    const accessToken = await ensureAuthenticated();
    // Refusals must not consume a rate-limit slot, so check before counting
    await assertIsDraft(accessToken, prefix, id, 'update');

    const rateLimitError = checkRateLimit('draft');
    if (rateLimitError) return rateLimitError;

    const draft = await callGraphAPI(
      accessToken,
      'PATCH',
      `${prefix}/messages/${id}`,
      message
    );
    return formatDraftResponse(draft, 'Draft updated');
  } catch (error) {
    return handleError('updating draft', error, sharedMailbox);
  }
}

/**
 * Send an existing draft
 */
async function handleSendDraft(args, { prefix, sharedMailbox }) {
  const { id } = args;

  if (!id) {
    return toolError('Draft ID (id) is required for send.');
  }

  try {
    const accessToken = await ensureAuthenticated();
    // Fetch the recipients as they are now: the draft may have been edited
    // (here or in Outlook) since it was created.
    const draft = await assertIsDraft(
      accessToken,
      prefix,
      id,
      'send',
      RECIPIENT_FIELDS
    );
    const blocked = findBlockedRecipients(recipientsOf(draft));
    if (blocked) {
      return toolError(
        `Draft not sent: it is addressed to ${blocked.blocked.join(', ')}, which OUTLOOK_ALLOWED_RECIPIENTS does not allow (allowed recipients/domains: ${blocked.allowed.join(', ')}). The draft is unchanged and still in ${draftsOf(sharedMailbox)}.`,
        {
          nextStep: `Remove those recipients from the draft (in Outlook, or with draft action=update${sharedMailboxArg(sharedMailbox)}), or ask the user to add them to OUTLOOK_ALLOWED_RECIPIENTS.`,
        }
      );
    }

    // Rate limit via send-email counter (shares limit with direct sends)
    const rateLimitError = checkRateLimit('send-email');
    if (rateLimitError) return rateLimitError;

    await callGraphAPI(accessToken, 'POST', `${prefix}/messages/${id}/send`);
    const sentItems = sharedMailbox
      ? `the Sent Items of ${sharedMailbox}`
      : 'Sent Items';
    return {
      content: [
        {
          type: 'text',
          text: `Draft sent successfully.\n\n**Note**: The draft ID \`${id}\` is no longer valid — the message has been moved to ${sentItems} with a new ID.`,
        },
      ],
    };
  } catch (error) {
    return handleError('sending draft', error, sharedMailbox);
  }
}

/**
 * Delete a draft
 */
async function handleDeleteDraft(args, { prefix, sharedMailbox }) {
  const { id } = args;

  if (!id) {
    return toolError('Draft ID (id) is required for delete.');
  }

  try {
    const accessToken = await ensureAuthenticated();
    await assertIsDraft(accessToken, prefix, id, 'delete');
    await callGraphAPI(accessToken, 'DELETE', `${prefix}/messages/${id}`);
    return {
      content: [
        {
          type: 'text',
          text: `Draft \`${id}\` deleted. It skips Deleted Items and goes to Recoverable Items, where Outlook's "Recover deleted items" can restore it for a limited time, depending on your account.`,
        },
      ],
    };
  } catch (error) {
    return handleError('deleting draft', error, sharedMailbox);
  }
}

/**
 * Create a reply or reply-all draft from an existing message
 */
async function handleReplyDraft(args, { prefix, sharedMailbox }, endpoint) {
  const { id, body, comment } = args;

  if (!id) {
    return toolError(
      `Message ID (id) is required for ${endpoint === 'createReplyAll' ? 'reply-all' : 'reply'}.`
    );
  }

  if (comment && body) {
    return toolError(
      'Cannot use both comment and body. Use comment for a short prepended note, or body for full HTML/text content.'
    );
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
  // Graph refuses `comment` together with message.body, not with other fields.
  if (sharedMailbox) {
    requestBody.message = {
      ...requestBody.message,
      from: sharedFrom(sharedMailbox),
    };
  }

  const actionName = endpoint === 'createReplyAll' ? 'reply-all' : 'reply';

  // Taken before the draft is created, and given back only when nothing is
  // definitely left behind (#299): Graph rejected the create with a 4xx, or
  // the allowlist refused the reply and its draft was deleted again. A
  // timeout, 5xx or failed delete may leave a draft, so the slot stays used.
  const rateLimitError = checkRateLimit('draft');
  if (rateLimitError) return rateLimitError;

  let draft;
  try {
    const accessToken = await ensureAuthenticated();
    draft = await callGraphAPI(
      accessToken,
      'POST',
      `${prefix}/messages/${id}/${endpoint}`,
      Object.keys(requestBody).length > 0 ? requestBody : null
    );

    // Graph fills in the recipients from the original message, so they can
    // only be checked once the draft exists.
    const refusal = await refuseBlockedReply(
      accessToken,
      { prefix, sharedMailbox },
      draft,
      actionName
    );
    if (refusal) {
      if (refusal.draftDeleted) releaseRateLimit('draft');
      return refusal.error;
    }

    return formatDraftResponse(
      draft,
      `${actionName.charAt(0).toUpperCase()}${actionName.slice(1)} draft created`
    );
  } catch (error) {
    // Only Graph's own rejection, read from the start of the error (the
    // body after it is server text). 408 means it may have gone through.
    const rejected = /^API call failed with status (4\d\d):/.exec(
      error.message || ''
    );
    if (!draft && rejected && rejected[1] !== '408') {
      releaseRateLimit('draft');
    }
    return handleError(`creating ${actionName} draft`, error, sharedMailbox);
  }
}

/**
 * When a recipient allowlist is configured, check the recipients Graph put
 * on a new reply draft. If any is not allowed, delete the draft and return a
 * refusal; otherwise return null.
 * @param {string} accessToken - Graph access token
 * @param {{prefix: string, sharedMailbox: string|null}} mailbox - The
 *   mailbox the draft was created in
 * @param {object} draft - The draft Graph returned from createReply/createReplyAll
 * @param {string} actionName - 'reply' or 'reply-all'
 * @returns {Promise<{error: object, draftDeleted: boolean}|null>} The
 *   refusal and whether its draft was deleted, or null to keep the draft
 */
async function refuseBlockedReply(
  accessToken,
  { prefix, sharedMailbox },
  draft,
  actionName
) {
  if (!getRecipientAllowlist()) return null;

  let reason;
  let nextStep;
  try {
    let message = draft;
    if (!RECIPIENT_FIELDS.every((field) => Array.isArray(draft?.[field]))) {
      message = await callGraphAPI(
        accessToken,
        'GET',
        `${prefix}/messages/${draft.id}`,
        null,
        { $select: ['id', ...RECIPIENT_FIELDS].join(',') }
      );
    }
    const blocked = findBlockedRecipients(recipientsOf(message));
    if (!blocked) return null;
    reason = `The ${actionName} draft would be addressed to ${blocked.blocked.join(', ')}, which OUTLOOK_ALLOWED_RECIPIENTS does not allow (allowed recipients/domains: ${blocked.allowed.join(', ')}).`;
    const inMailbox = sharedMailbox
      ? `, both with sharedMailbox=${sharedMailbox}`
      : '';
    nextStep = `Reply only to allowed recipients (for example, action=reply rather than reply-all, or draft action=create addressed to them${inMailbox}), or ask the user to add those recipients to OUTLOOK_ALLOWED_RECIPIENTS.`;
  } catch (error) {
    // Unchecked recipients are treated like blocked ones.
    reason = `The ${actionName} draft's recipients could not be checked against OUTLOOK_ALLOWED_RECIPIENTS (${error.message}).`;
    nextStep = 'Try the call again.';
  }

  try {
    await callGraphAPI(accessToken, 'DELETE', `${prefix}/messages/${draft.id}`);
  } catch (error) {
    const stillThere = toolError(
      `${reason} The draft Graph created could not be deleted (${error.message}), so it is still in ${draftsOf(sharedMailbox)} with ID \`${draft.id}\`. Do not send it.`,
      {
        nextStep: `Delete it with draft action=delete id=${draft.id}${sharedMailboxArg(sharedMailbox)} (or in Outlook). ${nextStep}`,
      }
    );
    return { error: stillThere, draftDeleted: false };
  }

  return {
    error: toolError(
      `${reason} The draft Graph created was deleted, so nothing was kept.`,
      { nextStep }
    ),
    draftDeleted: true,
  };
}

/**
 * Create a forward draft from an existing message
 */
async function handleForwardDraft(args, { prefix, sharedMailbox }) {
  const { id, to, body, comment } = args;

  if (!id) {
    return toolError('Message ID (id) is required for forward.');
  }

  if (!to) {
    return toolError('Forward recipient (to) is required for forward.');
  }

  if (comment && body) {
    return toolError(
      'Cannot use both comment and body. Use comment for a short prepended note, or body for full HTML/text content.'
    );
  }

  const toRecipients = formatRecipients(to);

  // Check recipient allowlist
  const allowlistError = checkRecipientAllowlist(toRecipients);
  if (allowlistError) return allowlistError;

  const rateLimitError = checkRateLimit('draft');
  if (rateLimitError) return rateLimitError;

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
  if (sharedMailbox) {
    requestBody.message = {
      ...requestBody.message,
      from: sharedFrom(sharedMailbox),
    };
  }

  try {
    const accessToken = await ensureAuthenticated();
    const draft = await callGraphAPI(
      accessToken,
      'POST',
      `${prefix}/messages/${id}/createForward`,
      requestBody
    );
    return formatDraftResponse(draft, 'Forward draft created');
  } catch (error) {
    return handleError('creating forward draft', error, sharedMailbox);
  }
}

/**
 * Standard error handler
 * @param {string} actionLabel - e.g. "creating draft"
 * @param {Error} error - The failure
 * @param {string|null} [sharedMailbox] - The shared mailbox acted as, if any
 */
function handleError(actionLabel, error, sharedMailbox = null) {
  if (error instanceof DraftGuardError) {
    return {
      content: [{ type: 'text', text: error.message }],
      isError: true,
    };
  }

  if (error.message === 'Authentication required') {
    return authRequiredError();
  }

  const denied = sharedSendError(error, sharedMailbox, actionLabel);
  if (denied) return denied;

  return toolError(`Error ${actionLabel}: ${error.message}`);
}

module.exports = handleDraft;
