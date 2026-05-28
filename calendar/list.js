/**
 * List events functionality
 */
const config = require('../config');
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const {
  escapeODataString,
  buildODataFilter,
} = require('../utils/odata-helpers');

/**
 * Validate that a value parses as an ISO 8601 datetime. Throws otherwise.
 * The schema declares `format: "date-time"` but the MCP schema-coerce layer
 * does not enforce JSON Schema `format`, so we enforce here at runtime.
 */
function assertIsoDateTime(value, paramName) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Invalid ${paramName}: "${value}" is not a valid ISO 8601 datetime (e.g. "2026-01-01T00:00:00Z").`
    );
  }
}

/**
 * Build the $filter clause for the list-events Graph query.
 *
 * Backward-compatible behaviour: when no search args are supplied, the filter
 * defaults to `start/dateTime ge '<now>'` so callers without parameters keep
 * seeing only upcoming events. When ANY of startAfter/startBefore/subject are
 * supplied, those replace the default and are AND-ed together.
 *
 * startAfter/startBefore are validated as ISO 8601 datetimes; invalid values
 * raise before any Graph call is made. Single quotes in user-supplied strings
 * are escaped via OData rules (`'` -> `''`) to prevent filter injection.
 *
 * @param {object} args - { startAfter?, startBefore?, subject? }
 * @returns {string} - The complete $filter expression
 */
function buildListEventsFilter(args) {
  const { startAfter, startBefore, subject } = args;
  const hasAnyFilter = Boolean(startAfter || startBefore || subject);

  const conditions = [];

  if (hasAnyFilter) {
    if (startAfter) {
      assertIsoDateTime(startAfter, 'startAfter');
      conditions.push(`start/dateTime ge '${escapeODataString(startAfter)}'`);
    }
    if (startBefore) {
      assertIsoDateTime(startBefore, 'startBefore');
      conditions.push(`start/dateTime lt '${escapeODataString(startBefore)}'`);
    }
    if (subject) {
      conditions.push(`contains(subject, '${escapeODataString(subject)}')`);
    }
  } else {
    conditions.push(`start/dateTime ge '${new Date().toISOString()}'`);
  }

  return buildODataFilter(conditions);
}

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
    const endpoint = 'me/events';

    // Add query parameters
    const queryParams = {
      $top: count,
      $orderby: 'start/dateTime',
      $filter: buildListEventsFilter(args),
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
          : `${event.start.dateTime}Z`;
        const endDt = event.end.dateTime.endsWith('Z')
          ? event.end.dateTime
          : `${event.end.dateTime}Z`;
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
module.exports.buildListEventsFilter = buildListEventsFilter;
