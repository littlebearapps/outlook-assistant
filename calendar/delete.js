/**
 * Delete event functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { toolError, authRequiredError } = require('../utils/tool-error');

/**
 * Delete event handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleDeleteEvent(args) {
  const { eventId } = args;

  if (!eventId) {
    return toolError('Event ID is required to delete an event.');
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Build API endpoint
    const endpoint = `me/events/${eventId}`;

    // Make API call
    await callGraphAPI(accessToken, 'DELETE', endpoint);

    return {
      content: [
        {
          type: 'text',
          text: `Event with ID ${eventId} has been successfully deleted.`,
        },
      ],
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    return toolError(`Error deleting event: ${error.message}`);
  }
}

module.exports = handleDeleteEvent;
