/**
 * Cancel event functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { toolError, authRequiredError } = require('../utils/tool-error');
const { previewCancelEvent } = require('./preview');

/**
 * Cancel event handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleCancelEvent(args) {
  const { eventId, comment, dryRun = false } = args;

  if (!eventId) {
    return toolError('Event ID is required to cancel an event.');
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // dryRun: read the event and say who would be emailed; send nothing.
    if (dryRun) return await previewCancelEvent(accessToken, args);

    // Build API endpoint
    const endpoint = `me/events/${eventId}/cancel`;

    // Only send a comment the caller gave; no placeholder text.
    const body = {};
    if (typeof comment === 'string' && comment.trim() !== '') {
      body.comment = comment;
    }

    // Make API call
    await callGraphAPI(accessToken, 'POST', endpoint, body);

    return {
      content: [
        {
          type: 'text',
          text: `Event with ID ${eventId} has been successfully cancelled.`,
        },
      ],
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    return toolError(`Error cancelling event: ${error.message}`);
  }
}

module.exports = handleCancelEvent;
