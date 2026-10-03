/**
 * Safety controls for Outlook Assistant Server
 *
 * Provides rate limiting, recipient allowlists, and content safety markers
 * to protect against unintended destructive actions.
 */
const { toolError } = require('./tool-error');

// Per-tool session counters for rate limiting
const sessionCounters = {};

/**
 * Check rate limit for a tool. Returns null if OK, or an error response if exceeded.
 * @param {string} toolName - The tool name to rate-limit
 * @param {number} [limit] - Override limit (default: from env or 10)
 * @returns {object|null} - MCP error response if limit exceeded, null if OK
 */
function checkRateLimit(toolName, limit) {
  const envKey = `OUTLOOK_MAX_${toolName.toUpperCase().replace(/-/g, '_')}_PER_SESSION`;
  const maxPerSession =
    limit ||
    parseInt(
      process.env[envKey] || process.env.OUTLOOK_MAX_EMAILS_PER_SESSION || '0',
      10
    );

  // 0 means unlimited (disabled)
  if (maxPerSession <= 0) return null;

  if (!sessionCounters[toolName]) sessionCounters[toolName] = 0;

  if (sessionCounters[toolName] >= maxPerSession) {
    return toolError(
      `Rate limit reached: ${maxPerSession} ${toolName} operations per session. Restart the server to reset. Configure via ${envKey} environment variable.`
    );
  }

  sessionCounters[toolName]++;
  return null;
}

/**
 * The configured recipient allowlist (OUTLOOK_ALLOWED_RECIPIENTS), lower-cased.
 * @returns {string[]|null} - Exact addresses and bare domains, or null if none
 */
function getRecipientAllowlist() {
  const allowlistRaw = process.env.OUTLOOK_ALLOWED_RECIPIENTS;
  if (!allowlistRaw) return null; // No allowlist configured — allow all

  const allowed = allowlistRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return allowed.length > 0 ? allowed : null;
}

/**
 * Addresses not covered by the recipient allowlist.
 * @param {Array<{emailAddress: {address: string}}>} recipients - Graph API recipient objects
 * @returns {{blocked: string[], allowed: string[]}|null} - null when nothing is
 *   blocked (or no allowlist is configured)
 */
function findBlockedRecipients(recipients) {
  const allowed = getRecipientAllowlist();
  if (!allowed) return null;

  const blocked = [];
  for (const r of recipients) {
    const addr = (r.emailAddress?.address || '').toLowerCase();
    const isAllowed = allowed.some(
      (rule) =>
        addr === rule || // Exact match
        addr.endsWith(`@${rule}`) // Domain match
    );
    if (!isAllowed) blocked.push(addr);
  }

  return blocked.length > 0 ? { blocked, allowed } : null;
}

/**
 * Check recipient allowlist. Returns null if OK, or an error response if blocked.
 * @param {Array<{emailAddress: {address: string}}>} recipients - Graph API recipient objects
 * @returns {object|null} - MCP error response if blocked, null if OK
 */
function checkRecipientAllowlist(recipients) {
  const result = findBlockedRecipients(recipients);
  if (!result) return null;

  return toolError(
    `Recipient not allowed: ${result.blocked.join(', ')}. Allowed recipients/domains: ${result.allowed.join(', ')}. Configure via OUTLOOK_ALLOWED_RECIPIENTS environment variable.`
  );
}

/**
 * Format a dry-run preview for send-email
 * @param {object} emailObject - The composed Graph API email object
 * @returns {object} - MCP response with preview
 */
function formatDryRunPreview(emailObject) {
  const msg = emailObject.message;
  const to = (msg.toRecipients || [])
    .map((r) => r.emailAddress?.address)
    .join(', ');
  const cc = (msg.ccRecipients || [])
    .map((r) => r.emailAddress?.address)
    .join(', ');
  const bcc = (msg.bccRecipients || [])
    .map((r) => r.emailAddress?.address)
    .join(', ');

  let preview = `DRY RUN — Email NOT sent.\n\n`;
  preview += `To: ${to}\n`;
  if (cc) preview += `CC: ${cc}\n`;
  if (bcc) preview += `BCC: ${bcc}\n`;
  preview += `Subject: ${msg.subject}\n`;
  preview += `Importance: ${msg.importance || 'normal'}\n`;
  preview += `Content-Type: ${msg.body?.contentType || 'text'}\n`;
  preview += `Save to Sent: ${emailObject.saveToSentItems !== false}\n`;
  preview += `\n--- Body ---\n${msg.body?.content || '(empty)'}\n--- End Body ---`;

  return {
    content: [{ type: 'text', text: preview }],
  };
}

/**
 * Format a dry-run preview for a mail rule (create or update).
 * @param {object} rule - The composed Graph API rule object
 * @returns {string} - Human-readable rule preview text
 */
function formatRuleDryRunPreview(rule) {
  const lines = [];

  lines.push(`Name: ${rule.displayName}`);
  lines.push(`Enabled: ${rule.isEnabled !== false}`);
  if (rule.sequence) lines.push(`Sequence: ${rule.sequence}`);

  // Conditions
  const cond = rule.conditions || {};
  const condParts = [];
  if (cond.fromAddresses?.length > 0) {
    condParts.push(
      `From: ${cond.fromAddresses.map((a) => a.emailAddress?.address).join(', ')}`
    );
  }
  if (cond.subjectContains?.length > 0) {
    condParts.push(
      `Subject contains (any): "${cond.subjectContains.join('", "')}"`
    );
  }
  if (cond.bodyContains?.length > 0) {
    condParts.push(`Body contains (any): "${cond.bodyContains.join('", "')}"`);
  }
  if (cond.bodyOrSubjectContains?.length > 0) {
    condParts.push(
      `Body or subject contains (any): "${cond.bodyOrSubjectContains.join('", "')}"`
    );
  }
  if (cond.senderContains?.length > 0) {
    condParts.push(
      `Sender contains (any): "${cond.senderContains.join('", "')}"`
    );
  }
  if (cond.recipientContains?.length > 0) {
    condParts.push(
      `Recipient contains (any): "${cond.recipientContains.join('", "')}"`
    );
  }
  if (cond.sentToAddresses?.length > 0) {
    condParts.push(
      `Sent to: ${cond.sentToAddresses.map((a) => a.emailAddress?.address).join(', ')}`
    );
  }
  if (cond.hasAttachment === true) condParts.push('Has attachment');
  if (cond.importance) condParts.push(`Importance: ${cond.importance}`);
  if (cond.sensitivity) condParts.push(`Sensitivity: ${cond.sensitivity}`);
  if (cond.sentToMe === true) condParts.push('Sent to me');
  if (cond.sentOnlyToMe === true) condParts.push('Sent only to me');
  if (cond.sentCcMe === true) condParts.push('I am in CC');
  if (cond.isAutomaticReply === true) condParts.push('Is automatic reply');
  if (condParts.length > 0) {
    lines.push(`Conditions: ${condParts.join('; ')}`);
  }

  // Actions
  const act = rule.actions || {};
  const actParts = [];
  if (act.moveToFolder) actParts.push(`Move to folder: ${act.moveToFolder}`);
  if (act.copyToFolder) actParts.push(`Copy to folder: ${act.copyToFolder}`);
  if (act.markAsRead === true) actParts.push('Mark as read');
  if (act.markImportance) {
    actParts.push(`Mark importance: ${act.markImportance}`);
  }
  if (act.forwardTo?.length > 0) {
    actParts.push(
      `Forward to: ${act.forwardTo.map((r) => r.emailAddress?.address).join(', ')}`
    );
  }
  if (act.redirectTo?.length > 0) {
    actParts.push(
      `Redirect to: ${act.redirectTo.map((r) => r.emailAddress?.address).join(', ')}`
    );
  }
  if (act.assignCategories?.length > 0) {
    actParts.push(`Assign categories: ${act.assignCategories.join(', ')}`);
  }
  if (act.stopProcessingRules === true) actParts.push('Stop processing rules');
  if (act.delete === true) actParts.push('Delete (move to Deleted Items)');
  if (actParts.length > 0) {
    lines.push(`Actions: ${actParts.join('; ')}`);
  }

  // Exceptions
  const exc = rule.exceptions || {};
  const excParts = [];
  if (exc.fromAddresses?.length > 0) {
    excParts.push(
      `From: ${exc.fromAddresses.map((a) => a.emailAddress?.address).join(', ')}`
    );
  }
  if (exc.subjectContains?.length > 0) {
    excParts.push(`Subject contains: "${exc.subjectContains.join('", "')}"`);
  }
  if (exc.senderContains?.length > 0) {
    excParts.push(`Sender contains: "${exc.senderContains.join('", "')}"`);
  }
  if (exc.bodyContains?.length > 0) {
    excParts.push(`Body contains: "${exc.bodyContains.join('", "')}"`);
  }
  if (exc.hasAttachment === true) excParts.push('Has attachment');
  if (excParts.length > 0) {
    lines.push(`Exceptions (rule skipped when): ${excParts.join('; ')}`);
  }

  return lines.join('\n');
}

/** First line of every dry-run preview, so it can't be read as a result (#274). */
const DRY_RUN_LABEL = 'DRY RUN — nothing was changed.';

/**
 * A dry-run tool result: the labelled preview plus `_meta.dryRun`.
 * @param {string|string[]} lines - What the call would do, line by line
 * @param {object} [meta] - Extra `_meta` fields
 * @returns {{content: Array<{type: 'text', text: string}>, _meta: object}}
 */
function dryRunResult(lines, meta = {}) {
  const text = [DRY_RUN_LABEL, '', ...[].concat(lines)].join('\n');
  return {
    content: [{ type: 'text', text }],
    _meta: { dryRun: true, ...meta },
  };
}

/**
 * The refusal for `dryRun: true` on an action with no preview (#274). Nothing
 * runs, and the caller is told which action does preview.
 * @param {string} toolName
 * @param {string} action - the action that was asked for
 * @param {string} previewAction - the tool's previewing action
 * @returns {{content: Array<{type: 'text', text: string}>, isError: true}}
 */
function dryRunUnsupported(toolName, action, previewAction) {
  return toolError(
    `dryRun is only available for ${toolName} action=${previewAction}, not action=${action}; nothing was changed.`,
    {
      nextStep:
        'Describe the change to the user, then call it without dryRun once they confirm.',
    }
  );
}

module.exports = {
  checkRateLimit,
  checkRecipientAllowlist,
  findBlockedRecipients,
  getRecipientAllowlist,
  formatDryRunPreview,
  formatRuleDryRunPreview,
  DRY_RUN_LABEL,
  dryRunResult,
  dryRunUnsupported,
};
