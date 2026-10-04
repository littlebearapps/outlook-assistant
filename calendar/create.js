/**
 * Create event functionality
 */
const { randomUUID } = require('crypto');
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { DEFAULT_TIMEZONE } = require('../config');
const { buildAttendees, checkAttendeeAllowlist } = require('./attendees');
const { checkRateLimit } = require('../utils/safety');
const { toolError, authRequiredError } = require('../utils/tool-error');
const { previewCreateEvent } = require('./preview');

/**
 * Create event handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleCreateEvent(args) {
  const { subject, start, end, attendees, body, dryRun = false } = args;

  if (!subject || !start || !end) {
    return toolError(
      'Subject, start, and end times are required to create an event.'
    );
  }

  // Plain strings are required attendees; {email, type} sets the type (#249).
  let graphAttendees;
  if (attendees) {
    try {
      graphAttendees = buildAttendees(attendees);
    } catch (error) {
      return {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      };
    }
    const allowlistError = checkAttendeeAllowlist(graphAttendees, { dryRun });
    if (allowlistError) return allowlistError;
  }

  // Request body
  const bodyContent = {
    subject,
    start: {
      dateTime: start.dateTime || start,
      timeZone: start.timeZone || DEFAULT_TIMEZONE,
    },
    end: {
      dateTime: end.dateTime || end,
      timeZone: end.timeZone || DEFAULT_TIMEZONE,
    },
    attendees: graphAttendees,
    body: { contentType: 'HTML', content: body || '' },
  };

  try {
    // dryRun: say who would be invited; create nothing (#274).
    if (dryRun) return await previewCreateEvent(bodyContent);

    // Counts real creates only; unlimited unless a limit is configured.
    const rateLimitError = checkRateLimit('create-event');
    if (rateLimitError) return rateLimitError;

    // Get access token
    const accessToken = await ensureAuthenticated();

    // Build API endpoint
    const endpoint = `me/events`;

    // A fresh transactionId per call (#280): Graph treats POSTs that share
    // one as the same event, so a 429 retry in utils/graph-api.js (which
    // re-sends this exact body) can't book the meeting twice.
    const response = await callGraphAPI(accessToken, 'POST', endpoint, {
      ...bodyContent,
      transactionId: randomUUID(),
    });

    const output = [`Event '${subject}' has been successfully created.`];
    if (response.id) {
      output.push(`**ID**: \`${response.id}\``);
    }
    if (response.start) {
      output.push(
        `**Start**: ${response.start.dateTime} (${response.start.timeZone})`
      );
    }
    if (response.end) {
      output.push(
        `**End**: ${response.end.dateTime} (${response.end.timeZone})`
      );
    }
    if (response.webLink) {
      output.push(`**Link**: ${response.webLink}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        eventId: response.id,
        subject: response.subject,
        start: response.start,
        end: response.end,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    return toolError(`Error creating event: ${error.message}`);
  }
}

module.exports = handleCreateEvent;
