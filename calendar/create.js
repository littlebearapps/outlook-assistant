/**
 * Create event functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { DEFAULT_TIMEZONE } = require('../config');

/**
 * Create event handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleCreateEvent(args) {
  const { subject, start, end, attendees, body } = args;

  if (!subject || !start || !end) {
    return {
      content: [
        {
          type: 'text',
          text: 'Subject, start, and end times are required to create an event.',
        },
      ],
    };
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Build API endpoint
    const endpoint = `me/events`;

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
      attendees: attendees?.map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      })),
      body: { contentType: 'HTML', content: body || '' },
    };

    // Make API call
    const response = await callGraphAPI(
      accessToken,
      'POST',
      endpoint,
      bodyContent
    );

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
          text: `Error creating event: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = handleCreateEvent;
