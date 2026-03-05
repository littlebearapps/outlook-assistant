/**
 * List events functionality
 */
const config = require('../config');
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

/**
 * List events handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleListEvents(args) {
  const count = Math.min(args.count || 10, config.MAX_RESULT_COUNT);

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Build API endpoint
    let endpoint = 'me/events';

    // Add query parameters
    const queryParams = {
      $top: count,
      $orderby: 'start/dateTime',
      $filter: `start/dateTime ge '${new Date().toISOString()}'`,
      $select: config.CALENDAR_SELECT_FIELDS,
    };

    // Make API call
    const response = await callGraphAPI(
      accessToken,
      'GET',
      endpoint,
      null,
      queryParams
    );

    if (!response.value || response.value.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No calendar events found.',
          },
        ],
      };
    }

    // Format results
    const tz = config.DEFAULT_TIMEZONE;
    const eventList = response.value
      .map((event, index) => {
        const startDt = event.start.dateTime.endsWith('Z')
          ? event.start.dateTime
          : event.start.dateTime + 'Z';
        const endDt = event.end.dateTime.endsWith('Z')
          ? event.end.dateTime
          : event.end.dateTime + 'Z';
        const startDate = new Date(startDt).toLocaleString('en-AU', {
          timeZone: tz,
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const endDate = new Date(endDt).toLocaleString('en-AU', {
          timeZone: tz,
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const location = event.location.displayName || 'No location';

        return `${index + 1}. ${event.subject} - Location: ${location}\nStart: ${startDate}\nEnd: ${endDate}\nSummary: ${event.bodyPreview}\nID: ${event.id}\n`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${response.value.length} events:\n\n${eventList}`,
        },
      ],
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
          text: `Error listing events: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = handleListEvents;
