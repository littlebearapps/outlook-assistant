/**
 * Decline event functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { toolError, authRequiredError } = require('../utils/tool-error');
const { previewDeclineEvent } = require('./preview');

/**
 * Decline event handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleDeclineEvent(args) {
  const { eventId, comment, sendResponse, dryRun = false } = args;

  if (!eventId) {
    return toolError('Event ID is required to decline an event.');
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // dryRun: read the event and say whether the organiser would be
    // emailed; send nothing.
    if (dryRun) return await previewDeclineEvent(accessToken, args);

    // Build API endpoint
    const endpoint = `me/events/${eventId}/decline`;

    // Only send what the caller gave: no placeholder comment, and Graph's
    // own default (notify the organiser) unless sendResponse is set.
    const body = {};
    if (typeof comment === 'string' && comment.trim() !== '') {
      body.comment = comment;
    }
    if (typeof sendResponse === 'boolean') {
      body.sendResponse = sendResponse;
    }

    // Make API call
    await callGraphAPI(accessToken, 'POST', endpoint, body);

    return {
      content: [
        {
          type: 'text',
          text: `Event with ID ${eventId} has been successfully declined.`,
        },
      ],
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    return toolError(`Error declining event: ${error.message}`);
  }
}

module.exports = handleDeclineEvent;
