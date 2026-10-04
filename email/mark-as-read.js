/**
 * Mark email as read functionality
 */
const _config = require('../config'); // Reserved for future use
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { buildMailboxPrefix } = require('../utils/mailbox');
const { toolError, authRequiredError } = require('../utils/tool-error');
const { log } = require('../utils/logger');

/**
 * Mark email as read handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleMarkAsRead(args) {
  const emailId = args.id;
  const isRead = args.isRead !== undefined ? args.isRead : true; // Default to true
  const prefix = buildMailboxPrefix(args.sharedMailbox || args.email || null);

  if (!emailId) {
    return toolError('Email ID is required.');
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Make API call to update email read status
    const endpoint = `${prefix}/messages/${emailId}`;
    const updateData = {
      isRead: isRead,
    };

    try {
      const _result = await callGraphAPI(
        accessToken,
        'PATCH',
        endpoint,
        updateData
      );

      const status = isRead ? 'read' : 'unread';

      return {
        content: [
          {
            type: 'text',
            text: `Email successfully marked as ${status}.`,
          },
        ],
      };
    } catch (error) {
      log.debug(
        `Error marking email as ${isRead ? 'read' : 'unread'}: ${error.message}`
      );

      // Improved error handling with more specific messages
      if (error.message.includes("doesn't belong to the targeted mailbox")) {
        return toolError(
          `The email ID seems invalid or doesn't belong to your mailbox. Please try with a different email ID.`
        );
      } else if (error.message.includes('UNAUTHORIZED')) {
        return authRequiredError();
      } else {
        return toolError(
          `Failed to mark email as ${isRead ? 'read' : 'unread'}: ${error.message}`
        );
      }
    }
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    return toolError(`Error accessing email: ${error.message}`);
  }
}

module.exports = handleMarkAsRead;
