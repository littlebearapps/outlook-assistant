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
  DEFAULT_LIMITS,
} = require('../utils/response-formatter');
const { getEmailFields } = require('../utils/field-presets');
const { buildMailboxPrefix } = require('../utils/mailbox');
const { toolError, authRequiredError } = require('../utils/tool-error');
const { log } = require('../utils/logger');

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
  // Message IDs are mailbox-scoped: an ID issued by a shared/delegated mailbox
  // is not resolvable under /me. Route to /users/{mailbox} when supplied.
  const sharedMailbox = args.sharedMailbox || args.email || null;
  const prefix = buildMailboxPrefix(sharedMailbox);

  if (!emailId) {
    return toolError('Email ID is required.');
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Select fields based on verbosity and options
    const fieldPreset = getReadFieldPreset(verbosity, includeHeaders);
    const selectFields = getEmailFields(fieldPreset);

    // Make API call to get email details
    const endpoint = `${prefix}/messages/${emailId}`;
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
        return toolError(`Email with ID ${emailId} not found.`);
      }

      // Format using shared formatter (returns Markdown)
      const formattedOutput = formatEmailContent(email, verbosity, {
        includeHeaders: includeHeaders,
        includeAllHeaders: false, // Only important headers by default
        sharedMailbox,
        maxFullBodyChars: DEFAULT_LIMITS.maxFullBodyChars,
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
      log.debug(`Error reading email: ${error.message}`);

      // Improved error handling with more specific messages
      if (error.message.includes("doesn't belong to the targeted mailbox")) {
        return toolError(
          `The email ID seems invalid or doesn't belong to your mailbox. Please try with a different email ID.`
        );
      } else {
        return toolError(`Failed to read email: ${error.message}`);
      }
    }
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    return toolError(`Error accessing email: ${error.message}`);
  }
}

module.exports = handleReadEmail;
