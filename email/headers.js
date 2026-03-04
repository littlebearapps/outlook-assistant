/**
 * Email headers functionality
 *
 * Retrieves email headers for forensics, spam analysis, delivery troubleshooting,
 * and threading reconstruction.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

/**
 * Important headers to highlight (in order of relevance)
 */
const IMPORTANT_HEADERS = [
  // Threading headers
  'Message-ID',
  'In-Reply-To',
  'References',
  // Authentication headers
  'Authentication-Results',
  'DKIM-Signature',
  'ARC-Authentication-Results',
  // Delivery chain
  'Received',
  'Received-SPF',
  // Spam/filtering
  'X-MS-Exchange-Organization-SCL',
  'X-MS-Exchange-Organization-AuthSource',
  'X-Forefront-Antispam-Report',
  'X-Microsoft-Antispam',
  // Content
  'Content-Type',
  'MIME-Version',
  // Custom headers
  'X-Mailer',
  'X-Originating-IP',
  'X-Priority',
];

/**
 * Format headers as Markdown
 * @param {Array} headers - Array of {name, value} header objects
 * @param {object} options - Formatting options
 * @returns {string} - Markdown formatted headers
 */
function formatHeaders(headers, options = {}) {
  const { groupByType = false, includeAll = true } = options;

  if (!headers || headers.length === 0) {
    return '*No headers available*';
  }

  let output = [];

  if (groupByType) {
    // Group headers by category
    const groups = {
      Threading: [],
      Authentication: [],
      Delivery: [],
      'Spam/Security': [],
      Content: [],
      Other: [],
    };

    headers.forEach((h) => {
      const name = h.name;
      if (['Message-ID', 'In-Reply-To', 'References'].includes(name)) {
        groups['Threading'].push(h);
      } else if (
        [
          'Authentication-Results',
          'DKIM-Signature',
          'ARC-Authentication-Results',
          'Received-SPF',
        ].includes(name)
      ) {
        groups['Authentication'].push(h);
      } else if (name === 'Received' || name.startsWith('X-MS-Exchange')) {
        groups['Delivery'].push(h);
      } else if (
        name.includes('Antispam') ||
        name.includes('SCL') ||
        name === 'X-Spam-Status'
      ) {
        groups['Spam/Security'].push(h);
      } else if (
        ['Content-Type', 'MIME-Version', 'Content-Transfer-Encoding'].includes(
          name
        )
      ) {
        groups['Content'].push(h);
      } else {
        groups['Other'].push(h);
      }
    });

    for (const [groupName, groupHeaders] of Object.entries(groups)) {
      if (groupHeaders.length > 0) {
        output.push(`\n### ${groupName}`);
        groupHeaders.forEach((h) => {
          // Truncate very long values
          const value =
            h.value.length > 500 ? h.value.substring(0, 500) + '...' : h.value;
          output.push(`**${h.name}**: \`${value}\``);
        });
      }
    }
  } else {
    // Simple list format
    const importantSet = new Set(IMPORTANT_HEADERS);
    const importantHeaders = [];
    const otherHeaders = [];

    headers.forEach((h) => {
      if (importantSet.has(h.name)) {
        importantHeaders.push(h);
      } else {
        otherHeaders.push(h);
      }
    });

    if (importantHeaders.length > 0) {
      output.push('## Key Headers\n');
      importantHeaders.forEach((h) => {
        const value =
          h.value.length > 300 ? h.value.substring(0, 300) + '...' : h.value;
        output.push(`**${h.name}**:`);
        output.push('```');
        output.push(value);
        output.push('```\n');
      });
    }

    if (includeAll && otherHeaders.length > 0) {
      output.push('\n## All Other Headers\n');
      otherHeaders.forEach((h) => {
        const value =
          h.value.length > 200 ? h.value.substring(0, 200) + '...' : h.value;
        output.push(`- **${h.name}**: \`${value}\``);
      });
    }
  }

  return output.join('\n');
}

/**
 * Get email headers handler
 * @param {object} args - Tool arguments
 * @param {string} args.id - Email ID (required)
 * @param {boolean} [args.groupByType] - Group headers by category (default: false)
 * @param {boolean} [args.importantOnly] - Show only important headers (default: false)
 * @param {boolean} [args.raw] - Return raw JSON instead of formatted (default: false)
 * @returns {object} - MCP response with headers
 */
async function handleGetEmailHeaders(args) {
  const emailId = args.id;
  const groupByType = args.groupByType || false;
  const importantOnly = args.importantOnly || false;
  const raw = args.raw || false;

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

    // Request headers plus threading metadata
    const selectFields = [
      'id',
      'subject',
      'from',
      'internetMessageHeaders',
      'internetMessageId',
      'conversationId',
      'conversationIndex',
      'receivedDateTime',
      'sentDateTime',
    ].join(',');

    const endpoint = `me/messages/${emailId}`;
    const queryParams = {
      $select: selectFields,
    };

    try {
      const email = await callGraphAPI(
        accessToken,
        'GET',
        endpoint,
        null,
        queryParams
      );

      if (!email) {
        return {
          content: [
            {
              type: 'text',
              text: `Email with ID ${emailId} not found.`,
            },
          ],
        };
      }

      const headers = email.internetMessageHeaders || [];

      // Filter to important headers if requested
      let filteredHeaders = headers;
      if (importantOnly) {
        const importantSet = new Set(IMPORTANT_HEADERS);
        filteredHeaders = headers.filter((h) => importantSet.has(h.name));
      }

      // Return raw JSON if requested
      if (raw) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: email.id,
                  subject: email.subject,
                  internetMessageId: email.internetMessageId,
                  conversationId: email.conversationId,
                  headers: filteredHeaders,
                },
                null,
                2
              ),
            },
          ],
          _meta: {
            emailId: email.id,
            headerCount: filteredHeaders.length,
            format: 'json',
          },
        };
      }

      // Build formatted output
      let output = [];
      output.push(`# Email Headers\n`);
      output.push(`**Subject**: ${email.subject || '(no subject)'}`);
      output.push(
        `**From**: ${email.from?.emailAddress?.address || 'unknown'}`
      );
      output.push(`**Received**: ${email.receivedDateTime || 'unknown'}`);
      output.push(
        `**Message-ID**: \`${email.internetMessageId || 'not available'}\``
      );
      output.push(
        `**Conversation-ID**: \`${email.conversationId || 'not available'}\``
      );
      output.push(`\n---\n`);
      output.push(`**Total Headers**: ${headers.length}`);
      if (importantOnly) {
        output.push(` (showing ${filteredHeaders.length} important headers)`);
      }
      output.push('\n');

      output.push(
        formatHeaders(filteredHeaders, {
          groupByType: groupByType,
          includeAll: !importantOnly,
        })
      );

      return {
        content: [
          {
            type: 'text',
            text: output.join('\n'),
          },
        ],
        _meta: {
          emailId: email.id,
          internetMessageId: email.internetMessageId,
          conversationId: email.conversationId,
          headerCount: headers.length,
          displayedHeaders: filteredHeaders.length,
        },
      };
    } catch (error) {
      console.error(`Error getting email headers: ${error.message}`);

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
            text: `Failed to get email headers: ${error.message}`,
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
  handleGetEmailHeaders,
  formatHeaders,
  IMPORTANT_HEADERS,
};
