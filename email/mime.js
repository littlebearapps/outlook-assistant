/**
 * MIME content retrieval functionality
 *
 * Retrieves raw MIME/EML content from emails for archival, forensics,
 * and forwarding to other systems.
 */
const { callGraphAPIRaw } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { buildMailboxPrefix } = require('../utils/mailbox');

/**
 * Parse MIME headers from raw content
 * @param {string} mimeContent - Raw MIME content
 * @returns {object} - Parsed headers and body boundary info
 */
function parseMimeHeaders(mimeContent) {
  // Find the first blank line (separates headers from body)
  const headerEndIndex = mimeContent.indexOf('\r\n\r\n');
  if (headerEndIndex === -1) {
    return { headers: {}, headerSection: '', bodyStart: 0 };
  }

  const headerSection = mimeContent.substring(0, headerEndIndex);
  const headers = {};

  // Parse headers (handle folded headers)
  const lines = headerSection.split(/\r?\n/);
  let currentHeader = null;
  let currentValue = '';

  lines.forEach((line) => {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      // Continuation of previous header
      currentValue += ` ${line.trim()}`;
    } else {
      // Save previous header
      if (currentHeader) {
        headers[currentHeader] = currentValue;
      }
      // Start new header
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        currentHeader = line.substring(0, colonIndex).trim();
        currentValue = line.substring(colonIndex + 1).trim();
      }
    }
  });

  // Save last header
  if (currentHeader) {
    headers[currentHeader] = currentValue;
  }

  return {
    headers,
    headerSection,
    bodyStart: headerEndIndex + 4,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Get MIME content size info
 * @param {string} mimeContent - Raw MIME content
 * @returns {object} - Size information
 */
function getMimeStats(mimeContent) {
  const bytes = Buffer.byteLength(mimeContent, 'utf8');
  const lines = mimeContent.split(/\r?\n/).length;

  return {
    bytes,
    formattedSize: formatBytes(bytes),
    lines,
  };
}

/**
 * Get MIME content handler
 * @param {object} args - Tool arguments
 * @param {string} args.id - Email ID (required)
 * @param {boolean} [args.headersOnly] - Return only MIME headers (default: false)
 * @param {boolean} [args.base64] - Return content as base64 (for binary safety, default: false)
 * @param {number} [args.maxSize] - Max content size to return in bytes (default: 1MB, 0 = no limit)
 * @returns {object} - MCP response with MIME content
 */
async function handleGetMimeContent(args) {
  const emailId = args.id;
  const headersOnly = args.headersOnly || false;
  const returnBase64 = args.base64 || false;
  const maxSize = args.maxSize !== undefined ? args.maxSize : 1024 * 1024; // 1MB default
  // Mailbox-scoped IDs: route to /users/{mailbox} for a shared/delegated mailbox.
  const prefix = buildMailboxPrefix(args.sharedMailbox || args.email || null);

  if (!emailId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Email ID is required.',
        },
      ],
    };
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    try {
      // Fetch raw MIME content
      const mimeContent = await callGraphAPIRaw(accessToken, emailId, prefix);

      if (!mimeContent) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to retrieve MIME content for email ${emailId}.`,
            },
          ],
        };
      }

      const stats = getMimeStats(mimeContent);
      const parsed = parseMimeHeaders(mimeContent);

      // Check size limit
      if (maxSize > 0 && stats.bytes > maxSize) {
        if (headersOnly) {
          // Return just headers if over limit
          return {
            content: [
              {
                type: 'text',
                text:
                  `# MIME Content (Headers Only - Content Truncated)\n\n` +
                  `**Size**: ${stats.formattedSize} (exceeds ${maxSize} byte limit)\n` +
                  `**Lines**: ${stats.lines}\n\n` +
                  `## MIME Headers\n\n\`\`\`\n${parsed.headerSection}\n\`\`\``,
              },
            ],
            _meta: {
              emailId,
              bytes: stats.bytes,
              lines: stats.lines,
              truncated: true,
              headersOnly: true,
            },
          };
        }

        return {
          content: [
            {
              type: 'text',
              text:
                `# MIME Content Too Large\n\n` +
                `**Size**: ${stats.formattedSize}\n` +
                `**Limit**: ${(maxSize / 1024).toFixed(0)} KB\n\n` +
                `Use \`headersOnly: true\` to get just headers, or increase \`maxSize\` parameter.\n\n` +
                `## MIME Headers Preview\n\n\`\`\`\n${parsed.headerSection.substring(0, 2000)}${parsed.headerSection.length > 2000 ? '\n...' : ''}\n\`\`\``,
            },
          ],
          _meta: {
            emailId,
            bytes: stats.bytes,
            lines: stats.lines,
            truncated: true,
            maxSizeExceeded: true,
          },
        };
      }

      // Prepare content based on options
      let content;
      if (headersOnly) {
        content = parsed.headerSection;
      } else if (returnBase64) {
        content = Buffer.from(mimeContent, 'utf8').toString('base64');
      } else {
        content = mimeContent;
      }

      // Build response
      const output = [];
      output.push(`# MIME Content${headersOnly ? ' (Headers Only)' : ''}\n`);
      output.push(`**Size**: ${stats.formattedSize}`);
      output.push(`**Lines**: ${stats.lines}`);

      // Show key headers
      if (parsed.headers.Subject) {
        output.push(`**Subject**: ${parsed.headers.Subject}`);
      }
      if (parsed.headers.From) {
        output.push(`**From**: ${parsed.headers.From}`);
      }
      if (parsed.headers['Content-Type']) {
        output.push(
          `**Content-Type**: ${parsed.headers['Content-Type'].split(';')[0]}`
        );
      }

      output.push('\n---\n');

      if (returnBase64) {
        output.push('## Base64 Encoded Content\n');
        output.push('```');
        output.push(content);
        output.push('```');
      } else {
        output.push('## Raw MIME Content\n');
        output.push('```');
        output.push(content);
        output.push('```');
      }

      return {
        content: [
          {
            type: 'text',
            text: output.join('\n'),
          },
        ],
        _meta: {
          emailId,
          bytes: stats.bytes,
          lines: stats.lines,
          format: returnBase64 ? 'base64' : 'raw',
          headersOnly,
          contentType: parsed.headers['Content-Type'] || 'unknown',
          messageId: parsed.headers['Message-ID'] || null,
        },
      };
    } catch (error) {
      console.error(`Error getting MIME content: ${error.message}`);

      if (error.message.includes("doesn't belong to the targeted mailbox")) {
        return {
          content: [
            {
              type: 'text',
              text: `The email ID seems invalid or doesn't belong to your mailbox.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Failed to get MIME content: ${error.message}`,
          },
        ],
      };
    }
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
          text: `Error accessing email: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = {
  handleGetMimeContent,
  parseMimeHeaders,
  getMimeStats,
};
