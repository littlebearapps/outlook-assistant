/**
 * Response formatting utilities for token-efficient MCP responses
 *
 * Provides:
 * - Markdown formatting (15% more token-efficient than JSON)
 * - Verbosity levels (minimal/standard/full)
 * - Truncation with metadata
 * - Response metadata (_meta blocks)
 */

/**
 * Verbosity levels for response formatting
 */
const VERBOSITY = {
  MINIMAL: 'minimal', // IDs + subject only (for batch operations)
  STANDARD: 'standard', // Key fields (default)
  FULL: 'full', // All available fields
};

/**
 * Default limits for token efficiency
 */
const DEFAULT_LIMITS = {
  listEmails: 25,
  searchEmails: 10,
  bodyPreviewLength: 100,
  batchExport: 25,
  maxBodyTruncation: 2000,
  maxTableRows: 50,
};

/**
 * Truncates text with metadata for long content
 * @param {string} text - Text to truncate
 * @param {number} maxChars - Maximum characters (default 2000)
 * @returns {object|string} - Truncated content with metadata or original text
 */
function truncateWithMeta(text, maxChars = DEFAULT_LIMITS.maxBodyTruncation) {
  if (!text || text.length <= maxChars) {
    return text;
  }

  return {
    content: text.substring(0, maxChars),
    _truncated: true,
    _fullLength: text.length,
    _hint: 'Use read-email with includeFullBody=true for complete content',
  };
}

/**
 * Formats a single email for list display (minimal verbosity)
 * @param {object} email - Email object from Graph API
 * @param {number} index - Index in list (1-based)
 * @returns {string} - Minimal format: ID, subject, from
 */
function formatEmailMinimal(email, index) {
  const from = email.from?.emailAddress?.address || 'unknown';
  return `${index}. ${email.id} | ${email.subject || '(no subject)'} | ${from}`;
}

/**
 * Formats a single email for list display (standard verbosity)
 * @param {object} email - Email object from Graph API
 * @param {number} index - Index in list (1-based)
 * @returns {string} - Standard markdown format
 */
function formatEmailStandard(email, index) {
  const from = email.from?.emailAddress || {
    name: 'Unknown',
    address: 'unknown',
  };
  const date = formatDate(email.receivedDateTime);
  const readStatus = email.isRead ? '' : '**[UNREAD]** ';
  const attachIcon = email.hasAttachments ? ' 📎' : '';

  return `${index}. ${readStatus}**${email.subject || '(no subject)'}**${attachIcon}
   From: ${from.name} <${from.address}>
   Date: ${date}
   ID: \`${email.id}\``;
}

/**
 * Formats a single email for list display (full verbosity)
 * @param {object} email - Email object from Graph API
 * @param {number} index - Index in list (1-based)
 * @returns {string} - Full markdown format with all fields
 */
function formatEmailFull(email, index) {
  const from = email.from?.emailAddress || {
    name: 'Unknown',
    address: 'unknown',
  };
  const to = formatRecipients(email.toRecipients);
  const cc = formatRecipients(email.ccRecipients);
  const date = formatDate(email.receivedDateTime);
  const readStatus = email.isRead ? 'Read' : '**UNREAD**';
  const importance = email.importance || 'normal';
  const preview = email.bodyPreview
    ? truncateText(email.bodyPreview, DEFAULT_LIMITS.bodyPreviewLength)
    : '';

  let output = `### ${index}. ${email.subject || '(no subject)'}

| Field | Value |
|-------|-------|
| From | ${from.name} <${from.address}> |
| To | ${to} |
| Date | ${date} |
| Status | ${readStatus} |
| Importance | ${importance} |
| Attachments | ${email.hasAttachments ? 'Yes' : 'No'} |
| ID | \`${email.id}\` |`;

  if (cc) {
    output += `\n| CC | ${cc} |`;
  }

  if (preview) {
    output += `\n\n> ${preview}`;
  }

  return output;
}

/**
 * Formats an email list as Markdown
 * @param {Array} emails - Array of email objects from Graph API
 * @param {string} folder - Folder name
 * @param {string} verbosity - Verbosity level (minimal/standard/full)
 * @param {object} meta - Metadata (totalAvailable, hasMore, nextPageToken)
 * @returns {string} - Formatted Markdown string
 */
function formatEmailList(
  emails,
  folder,
  verbosity = VERBOSITY.STANDARD,
  meta = {}
) {
  if (!emails || emails.length === 0) {
    return `No emails found in ${folder}.`;
  }

  const count = emails.length;
  let output = `## Emails in ${folder} (${count}${meta.totalAvailable ? `/${meta.totalAvailable}` : ''})\n\n`;

  // Format based on verbosity
  const formatFn =
    {
      [VERBOSITY.MINIMAL]: formatEmailMinimal,
      [VERBOSITY.STANDARD]: formatEmailStandard,
      [VERBOSITY.FULL]: formatEmailFull,
    }[verbosity] || formatEmailStandard;

  output += emails.map((email, i) => formatFn(email, i + 1)).join('\n\n');

  // Add metadata footer
  if (meta.hasMore || meta.nextPageToken) {
    output += `\n\n---\n_More emails available. ${meta.nextPageToken ? 'Use nextPageToken to continue.' : ''}_`;
  }

  return output;
}

/**
 * Formats an email list as Markdown table (compact format)
 * @param {Array} emails - Array of email objects
 * @param {string} folder - Folder name
 * @param {object} meta - Metadata
 * @returns {string} - Markdown table
 */
function formatEmailListAsTable(emails, folder, meta = {}) {
  if (!emails || emails.length === 0) {
    return `No emails found in ${folder}.`;
  }

  let output = `## Emails in ${folder} (${emails.length}${meta.totalAvailable ? `/${meta.totalAvailable}` : ''})\n\n`;
  output += '| # | Status | Date | From | Subject | ID |\n';
  output += '|---|--------|------|------|---------|----|\n';

  const rows = emails.slice(0, DEFAULT_LIMITS.maxTableRows);
  rows.forEach((email, i) => {
    const from =
      email.from?.emailAddress?.name ||
      email.from?.emailAddress?.address ||
      'Unknown';
    const date = formatDateShort(email.receivedDateTime);
    const status = email.isRead ? '📖' : '📬';
    const subject = truncateText(email.subject || '(no subject)', 40);
    const shortId = email.id.substring(0, 20) + '...';

    output += `| ${i + 1} | ${status} | ${date} | ${truncateText(from, 20)} | ${subject} | \`${shortId}\` |\n`;
  });

  if (emails.length > DEFAULT_LIMITS.maxTableRows) {
    output += `\n_Showing ${DEFAULT_LIMITS.maxTableRows} of ${emails.length} emails._`;
  }

  if (meta.hasMore) {
    output += `\n\n---\n_More emails available._`;
  }

  return output;
}

/**
 * Formats a single email for reading (full content)
 * @param {object} email - Email object from Graph API
 * @param {string} verbosity - Verbosity level
 * @param {object} options - Additional options (includeHeaders, includeRaw)
 * @returns {string} - Formatted Markdown string
 */
function formatEmailContent(
  email,
  verbosity = VERBOSITY.STANDARD,
  options = {}
) {
  const from = formatEmailAddress(email.from?.emailAddress);
  const to = formatRecipients(email.toRecipients);
  const cc = formatRecipients(email.ccRecipients);
  const bcc = formatRecipients(email.bccRecipients);
  const date = formatDate(email.receivedDateTime);

  let output = `# ${email.subject || '(no subject)'}

**From:** ${from}`;

  if (to) output += `\n**To:** ${to}`;

  output += `\n**Date:** ${date}`;

  if (cc) output += `\n**CC:** ${cc}`;
  if (bcc) output += `\n**BCC:** ${bcc}`;

  output += `\n**Importance:** ${email.importance || 'normal'}`;
  output += `\n**Attachments:** ${email.hasAttachments ? 'Yes' : 'No'}`;

  if (verbosity === VERBOSITY.FULL) {
    output += `\n**ID:** \`${email.id}\``;
    if (email.conversationId)
      output += `\n**Conversation ID:** \`${email.conversationId}\``;
    if (email.internetMessageId)
      output += `\n**Message-ID:** \`${email.internetMessageId}\``;
  }

  output += '\n\n---\n\n';

  // Body content
  let body;
  if (verbosity === VERBOSITY.MINIMAL) {
    // At minimal verbosity, show bodyPreview only
    body = email.bodyPreview || '_(Body omitted at minimal verbosity)_';
  } else if (email.body) {
    body =
      email.body.contentType === 'html'
        ? stripHtml(email.body.content)
        : email.body.content;
  } else {
    body = email.bodyPreview || 'No content';
  }

  // Truncate if needed (unless full verbosity requested)
  if (verbosity !== VERBOSITY.FULL) {
    const truncated = truncateWithMeta(body, DEFAULT_LIMITS.maxBodyTruncation);
    if (typeof truncated === 'object') {
      output += truncated.content;
      output += `\n\n---\n_Content truncated (${truncated._fullLength} chars). ${truncated._hint}_`;
    } else {
      output += body;
    }
  } else {
    output += body;
  }

  // Headers if requested
  if (options.includeHeaders && email.internetMessageHeaders) {
    output += formatEmailHeaders(
      email.internetMessageHeaders,
      options.includeAllHeaders
    );
  }

  return output;
}

/**
 * Formats email headers for legal/forensic use
 * @param {Array} headers - Array of header objects
 * @param {boolean} includeAll - Include all headers (not just important ones)
 * @returns {string} - Formatted headers section
 */
function formatEmailHeaders(headers, includeAll = false) {
  if (!headers || headers.length === 0) return '';

  const importantHeaders = [
    'Message-ID',
    'Date',
    'Received',
    'DKIM-Signature',
    'Authentication-Results',
    'X-MS-Exchange-Organization-AuthSource',
    'X-MS-Exchange-Organization-AuthAs',
    'Return-Path',
    'X-Originating-IP',
    'X-MS-Has-Attach',
    'SPF',
    'DMARC',
  ];

  const filteredHeaders = includeAll
    ? headers
    : headers.filter((h) =>
        importantHeaders.some((ih) =>
          h.name.toLowerCase().startsWith(ih.toLowerCase())
        )
      );

  if (filteredHeaders.length === 0) return '';

  let output = '\n\n---\n\n## Email Headers (Legal/Forensic)\n\n';
  output += '| Header | Value |\n|--------|-------|\n';

  filteredHeaders.forEach((h) => {
    const value = truncateText(h.value, 60);
    output += `| ${h.name} | \`${value}\` |\n`;
  });

  return output;
}

/**
 * Creates a response metadata block
 * @param {object} data - Response data
 * @returns {object} - Metadata object
 */
function createResponseMeta(data) {
  return {
    returned: data.returned || 0,
    totalAvailable: data.totalAvailable || null,
    hasMore: data.hasMore || false,
    nextPageToken: data.nextPageToken || null,
    verbosity: data.verbosity || VERBOSITY.STANDARD,
    truncated: data.truncated || false,
  };
}

/**
 * Wraps response content with MCP format
 * @param {string} text - Response text
 * @param {object} meta - Optional metadata
 * @returns {object} - MCP response object
 */
function wrapMcpResponse(text, meta = null) {
  const response = {
    content: [{ type: 'text', text }],
  };

  if (meta) {
    response._meta = meta;
  }

  return response;
}

// ============ Helper Functions ============

/**
 * Formats a date string
 */
function formatDate(dateStr) {
  if (!dateStr) return 'Unknown';
  const date = new Date(dateStr);
  return date.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Formats a date string (short version for tables)
 */
function formatDateShort(dateStr) {
  if (!dateStr) return 'Unknown';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
  });
}

/**
 * Formats an email address object
 */
function formatEmailAddress(addr) {
  if (!addr) return 'Unknown';
  return `${addr.name || addr.address} <${addr.address}>`;
}

/**
 * Formats recipient array to string
 */
function formatRecipients(recipients) {
  if (!recipients || recipients.length === 0) return '';
  return recipients.map((r) => formatEmailAddress(r.emailAddress)).join(', ');
}

/**
 * Truncates text to specified length
 */
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Strips HTML tags (simple implementation)
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  VERBOSITY,
  DEFAULT_LIMITS,
  truncateWithMeta,
  formatEmailMinimal,
  formatEmailStandard,
  formatEmailFull,
  formatEmailList,
  formatEmailListAsTable,
  formatEmailContent,
  formatEmailHeaders,
  createResponseMeta,
  wrapMcpResponse,
  formatDate,
  formatDateShort,
  formatEmailAddress,
  formatRecipients,
  truncateText,
  stripHtml,
};
