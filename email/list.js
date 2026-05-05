/**
 * List emails functionality
 *
 * Token-efficient implementation with outputVerbosity support and Markdown formatting.
 */
const config = require('../config');
const {
  callGraphAPI: _callGraphAPI,
  callGraphAPIPaginated,
} = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { resolveFolderPath } = require('./folder-utils');
const {
  formatEmailList,
  VERBOSITY,
  DEFAULT_LIMITS,
} = require('../utils/response-formatter');
const { getEmailFields } = require('../utils/field-presets');

/**
 * Maps verbosity level to field preset
 * @param {string} verbosity - minimal, standard, or full
 * @returns {string} - field preset name
 */
function getFieldPresetForVerbosity(verbosity) {
  switch (verbosity) {
    case VERBOSITY.MINIMAL:
      return 'list'; // id, subject, from, receivedDateTime, isRead
    case VERBOSITY.FULL:
      return 'search'; // Includes toRecipients, bodyPreview, hasAttachments, importance
    case VERBOSITY.STANDARD:
    default:
      return 'list'; // Standard uses list preset but formats with more detail
  }
}

/**
 * List emails handler
 * @param {object} args - Tool arguments
 * @param {string} [args.folder] - Folder to list (default: inbox)
 * @param {number} [args.count] - Number of emails (default: 25, max: 50)
 * @param {string} [args.outputVerbosity] - minimal, standard, or full (default: standard)
 * @returns {object} - MCP response with Markdown formatted content
 */
async function handleListEmails(args) {
  const folder = args.folder || 'inbox';
  // F-17: accept `maxResults` as an alias for `count` here too. The
  // search-mode handler already does this; list-mode used `args.count`
  // only, so callers passing `maxResults=5` to a non-search list call
  // saw their override silently ignored.
  const requestedCount =
    args.count ?? args.maxResults ?? DEFAULT_LIMITS.listEmails;
  const verbosity = args.outputVerbosity || VERBOSITY.STANDARD;

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Resolve the folder path
    const endpoint = await resolveFolderPath(accessToken, folder);

    // Select fields based on verbosity level
    const fieldPreset = getFieldPresetForVerbosity(verbosity);
    const selectFields = getEmailFields(fieldPreset);

    // Add query parameters
    const queryParams = {
      $top: Math.min(config.MAX_RESULT_COUNT, requestedCount),
      $orderby: 'receivedDateTime desc',
      $select: selectFields,
    };

    // Make API call with pagination support
    const response = await callGraphAPIPaginated(
      accessToken,
      'GET',
      endpoint,
      queryParams,
      requestedCount
    );

    if (!response.value || response.value.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No emails found in ${folder}.`,
          },
        ],
      };
    }

    // Build response metadata
    const meta = {
      returned: response.value.length,
      totalAvailable: response['@odata.count'] || null,
      hasMore: Boolean(response['@odata.nextLink']),
      verbosity: verbosity,
    };

    // Format results using response-formatter (returns Markdown)
    const formattedOutput = formatEmailList(
      response.value,
      folder,
      verbosity,
      meta
    );

    return {
      content: [
        {
          type: 'text',
          text: formattedOutput,
        },
      ],
      _meta: meta,
    };
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
          text: `Error listing emails: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = handleListEmails;
