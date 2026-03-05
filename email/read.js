/**
 * Read email functionality
 *
 * Token-efficient implementation with outputVerbosity support and Markdown formatting.
 */
const _config = require('../config'); // Reserved for future use
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const {
  formatEmailContent,
  VERBOSITY,
} = require('../utils/response-formatter');
const { getEmailFields } = require('../utils/field-presets');

/**
 * Get field preset based on verbosity and options
 * @param {string} verbosity - Verbosity level
 * @param {boolean} includeHeaders - Whether headers are requested
 * @returns {string} - Field preset name
 */
function getReadFieldPreset(verbosity, includeHeaders) {
  if (includeHeaders) {
    return 'forensic'; // Includes internetMessageHeaders
  }
  switch (verbosity) {
    case VERBOSITY.MINIMAL:
      return 'read-minimal'; // Includes bodyPreview + toRecipients
    case VERBOSITY.FULL:
      return 'read'; // Full read fields
    case VERBOSITY.STANDARD:
    default:
      return 'read'; // Standard uses full read fields
  }
}

/**
 * Read email handler
 * @param {object} args - Tool arguments
 * @param {string} args.id - Email ID (required)
 * @param {string} [args.outputVerbosity] - minimal, standard, or full (default: standard)
 * @param {boolean} [args.includeHeaders] - Include email headers for legal/forensic use
 * @returns {object} - MCP response with Markdown formatted content
 */
async function handleReadEmail(args) {
  const emailId = args.id;
  const verbosity = args.outputVerbosity || VERBOSITY.STANDARD;
  const includeHeaders = args.includeHeaders || false;

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

    // Select fields based on verbosity and options
    const fieldPreset = getReadFieldPreset(verbosity, includeHeaders);
    const selectFields = getEmailFields(fieldPreset);

    // Make API call to get email details
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

      // Format using shared formatter (returns Markdown)
      const formattedOutput = formatEmailContent(email, verbosity, {
        includeHeaders: includeHeaders,
        includeAllHeaders: false, // Only important headers by default
      });

      return {
        content: [
          {
            type: 'text',
            text: formattedOutput,
          },
        ],
        _meta: {
          emailId: email.id,
          conversationId: email.conversationId,
          internetMessageId: email.internetMessageId,
          verbosity: verbosity,
        },
      };
    } catch (error) {
      console.error(`Error reading email: ${error.message}`);

      // Improved error handling with more specific messages
      if (error.message.includes("doesn't belong to the targeted mailbox")) {
        return {
          content: [
            {
              type: 'text',
              text: `The email ID seems invalid or doesn't belong to your mailbox. Please try with a different email ID.`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to read email: ${error.message}`,
            },
          ],
        };
      }
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

module.exports = handleReadEmail;
