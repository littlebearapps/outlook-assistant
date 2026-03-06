/**
 * Safety controls for Outlook Assistant Server
 *
 * Provides rate limiting, recipient allowlists, and content safety markers
 * to protect against unintended destructive actions.
 */

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
    return {
      content: [
        {
          type: 'text',
          text: `Rate limit reached: ${maxPerSession} ${toolName} operations per session. Restart the server to reset. Configure via ${envKey} environment variable.`,
        },
      ],
    };
  }

  sessionCounters[toolName]++;
  return null;
}

/**
 * Check recipient allowlist. Returns null if OK, or an error response if blocked.
 * @param {Array<{emailAddress: {address: string}}>} recipients - Graph API recipient objects
 * @returns {object|null} - MCP error response if blocked, null if OK
 */
function checkRecipientAllowlist(recipients) {
  const allowlistRaw = process.env.OUTLOOK_ALLOWED_RECIPIENTS;
  if (!allowlistRaw) return null; // No allowlist configured — allow all

  const allowed = allowlistRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) return null;

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

  if (blocked.length > 0) {
    return {
      content: [
        {
          type: 'text',
          text: `Recipient not allowed: ${blocked.join(', ')}. Allowed recipients/domains: ${allowed.join(', ')}. Configure via OUTLOOK_ALLOWED_RECIPIENTS environment variable.`,
        },
      ],
    };
  }

  return null;
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

module.exports = {
  checkRateLimit,
  checkRecipientAllowlist,
  formatDryRunPreview,
};
