/**
 * Safety controls for Outlook Assistant Server
 *
 * Provides rate limiting, recipient allowlists, and content safety markers
 * to protect against unintended destructive actions.
 */
const { toolError } = require('./tool-error');

// Per-tool session counters for rate limiting
const sessionCounters = {};

/** Default cap for every rate-limited tool without its own setting. */
const DEFAULT_LIMIT_ENV = 'OUTLOOK_MAX_EMAILS_PER_SESSION';

/**
 * Rate-limit buckets and what each counts. `draft` action=send counts
 * against `send-email`, so blocking `send-email` blocks every send.
 */
const RATE_LIMITED_TOOLS = {
  'send-email': 'sends (send-email and draft action=send)',
  draft: 'draft writes (create, update, reply, reply-all, forward)',
  'create-event': 'calendar invitations (create-event)',
  'manage-rules': 'inbox rule changes (create, update, reorder, delete)',
};

/**
 * The per-tool setting for a rate-limited tool, e.g.
 * OUTLOOK_MAX_SEND_EMAIL_PER_SESSION for send-email.
 * @param {string} toolName
 * @returns {string}
 */
function sessionLimitEnvKey(toolName) {
  return `OUTLOOK_MAX_${toolName.toUpperCase().replace(/-/g, '_')}_PER_SESSION`;
}

/**
 * Resolve the per-session cap for a tool (#302). The tool's own setting
 * wins over OUTLOOK_MAX_EMAILS_PER_SESSION. Unset or empty = no cap. A whole
 * number is the cap, and 0 refuses every call. Anything else (negative,
 * decimal, text) also refuses every call: a safety setting that can't be
 * read fails closed.
 * @param {string} toolName
 * @returns {{limit: number|null, envKey: string|null, raw: string|null, invalid: boolean}}
 */
function resolveSessionLimit(toolName) {
  for (const key of [sessionLimitEnvKey(toolName), DEFAULT_LIMIT_ENV]) {
    const raw = process.env[key];
    if (raw === undefined || raw.trim() === '') continue;
    const value = raw.trim();
    if (/^\d+$/.test(value)) {
      return {
        limit: parseInt(value, 10),
        envKey: key,
        raw: value,
        invalid: false,
      };
    }
    return { limit: 0, envKey: key, raw: value, invalid: true };
  }
  return { limit: null, envKey: null, raw: null, invalid: false };
}

/**
 * One line per rate-limited tool describing its cap, for `auth action=about`
 * and the startup log.
 * @returns {string[]}
 */
function describeSessionLimits() {
  return Object.entries(RATE_LIMITED_TOOLS).map(([tool, counts]) => {
    const { limit, envKey, raw, invalid } = resolveSessionLimit(tool);
    if (limit === null) return `${tool}: no limit (not set)`;
    if (invalid) {
      return `${tool}: BLOCKED (${envKey}="${raw}" is not a whole number, so it fails closed)`;
    }
    if (limit === 0) {
      return `${tool}: BLOCKED (${envKey}=0 allows no ${counts})`;
    }
    const used = sessionCounters[tool] || 0;
    return `${tool}: ${limit} per session, ${used} used (${envKey})`;
  });
}

/**
 * Rate-limited tools the current settings block outright (cap 0 or
 * unreadable), for the server instructions.
 * @returns {string[]}
 */
function blockedTools() {
  return Object.keys(RATE_LIMITED_TOOLS).filter(
    (tool) => resolveSessionLimit(tool).limit === 0
  );
}

/**
 * Check rate limit for a tool. Returns null if OK, or an error response if
 * the tool is blocked (cap 0) or its cap is used up.
 * @param {string} toolName - The tool name to rate-limit
 * @param {number} [limit] - Override limit (tests); default from the env
 * @returns {object|null} - MCP error response if refused, null if OK
 */
function checkRateLimit(toolName, limit) {
  const resolved =
    limit === undefined
      ? resolveSessionLimit(toolName)
      : { limit, envKey: sessionLimitEnvKey(toolName), invalid: false };
  const envKey = resolved.envKey;

  if (resolved.limit === null) return null;

  const nextStep = (change) =>
    `Tell the user it was refused by their session limit. Do not retry, and do not use another tool or action to get around it. To allow it, the user can ${change} and restart the server.`;

  if (resolved.limit === 0) {
    const why = resolved.invalid
      ? `${envKey} is set to "${resolved.raw}", which is not a whole number, so ${toolName} is blocked (an unreadable limit fails closed)`
      : `${envKey}=0 turns off ${RATE_LIMITED_TOOLS[toolName] || toolName}`;
    return toolError(
      `${toolName} is blocked: ${why}. Nothing was sent or changed.`,
      {
        nextStep: nextStep(
          `set ${envKey} to a whole number above 0, or unset it for no limit,`
        ),
      }
    );
  }

  if (!sessionCounters[toolName]) sessionCounters[toolName] = 0;

  if (sessionCounters[toolName] >= resolved.limit) {
    return toolError(
      `Rate limit reached: ${resolved.limit} ${toolName} operations per session (${envKey}). Nothing was sent or changed.`,
      { nextStep: nextStep(`raise ${envKey}`) }
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
 * Characters never found in a single plain address: separators that would
 * let one string carry several addresses (`;` `,`), display-name and route
 * syntax (`<` `>` `"` `` ` `` `(` `)` `[` `]` `\` `:`), and any whitespace,
 * control or invisible format character.
 */
const NOT_PLAIN_ADDRESS = /[;,<>"`()[\]\\:\s\p{Cc}\p{Cf}\p{Z}]/u;

/**
 * Whether `address` is one plain email address: exactly one `@`, non-empty
 * local and domain parts, and none of NOT_PLAIN_ADDRESS.
 * @param {*} address
 * @returns {boolean}
 */
function isPlainAddress(address) {
  if (typeof address !== 'string') return false;
  const at = address.indexOf('@');
  return (
    at > 0 &&
    at === address.lastIndexOf('@') &&
    at < address.length - 1 &&
    !NOT_PLAIN_ADDRESS.test(address)
  );
}

/**
 * Addresses not covered by the recipient allowlist. With an allowlist set,
 * anything that isn't a single plain address is blocked outright, so a
 * string like `a@other.test;b@allowed.test` can't pass a domain match.
 * @param {Array<{emailAddress: {address: string}}>} recipients - Graph API recipient objects
 * @returns {{blocked: string[], allowed: string[]}|null} - null when nothing is
 *   blocked (or no allowlist is configured)
 */
function findBlockedRecipients(recipients) {
  const allowed = getRecipientAllowlist();
  if (!allowed) return null;

  const blocked = [];
  for (const r of recipients) {
    const raw = r?.emailAddress?.address;
    if (!isPlainAddress(raw)) {
      blocked.push(
        `${JSON.stringify(raw ?? '')} (not a single plain email address)`
      );
      continue;
    }
    const addr = raw.toLowerCase();
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

  let preview = `Email NOT sent.\n\n`;
  preview += `To: ${to}\n`;
  if (cc) preview += `CC: ${cc}\n`;
  if (bcc) preview += `BCC: ${bcc}\n`;
  preview += `Subject: ${msg.subject}\n`;
  preview += `Importance: ${msg.importance || 'normal'}\n`;
  preview += `Content-Type: ${msg.body?.contentType || 'text'}\n`;
  // A draft is never "saved to Sent", so its preview leaves this out.
  if (!emailObject.isDraft) {
    preview += `Save to Sent: ${emailObject.saveToSentItems !== false}\n`;
  }
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
  if (cond.hasAttachments === true) condParts.push('Has attachment');
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
  if (exc.hasAttachments === true) excParts.push('Has attachment');
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
  resolveSessionLimit,
  describeSessionLimits,
  blockedTools,
  sessionLimitEnvKey,
  RATE_LIMITED_TOOLS,
  DEFAULT_LIMIT_ENV,
  checkRecipientAllowlist,
  findBlockedRecipients,
  getRecipientAllowlist,
  isPlainAddress,
  formatDryRunPreview,
  formatRuleDryRunPreview,
  DRY_RUN_LABEL,
  dryRunResult,
  dryRunUnsupported,
};
