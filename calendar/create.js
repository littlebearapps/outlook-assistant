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

  const startDateTime = start.dateTime || start;
  const startTimeZone = start.timeZone || DEFAULT_TIMEZONE;
  const endDateTime = end.dateTime || end;
  const endTimeZone = end.timeZone || DEFAULT_TIMEZONE;
  let recurrence;

  try {
    recurrence = buildRecurrence(args, startDateTime, startTimeZone);
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error creating event: ${error.message}`,
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
        dateTime: startDateTime,
        timeZone: startTimeZone,
      },
      end: {
        dateTime: endDateTime,
        timeZone: endTimeZone,
      },
      attendees: attendees?.map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      })),
      body: { contentType: 'HTML', content: body || '' },
    };
    if (recurrence) {
      bodyContent.recurrence = recurrence;
    }

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
    if (bodyContent.recurrence) {
      output.push(`**Recurrence**: ${bodyContent.recurrence.pattern.type}`);
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
        recurrence: response.recurrence || bodyContent.recurrence,
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

function buildRecurrence(args, startDateTime, timeZone) {
  const {
    recurrence,
    recurrenceRaw,
    recurrenceType,
    recurrenceInterval,
    recurrenceDaysOfWeek,
    recurrenceEndDate,
    recurrenceCount,
  } = args;
  const rawRecurrence = recurrenceRaw || recurrence;
  const hasSimplifiedRecurrence =
    recurrenceType ||
    recurrenceInterval !== undefined ||
    recurrenceDaysOfWeek !== undefined ||
    recurrenceEndDate ||
    recurrenceCount !== undefined;

  if (rawRecurrence && hasSimplifiedRecurrence) {
    throw new Error(
      'Use either recurrenceRaw/recurrence or simplified recurrence parameters, not both.'
    );
  }

  if (rawRecurrence) {
    return normaliseRawRecurrence(rawRecurrence, timeZone);
  }

  if (!hasSimplifiedRecurrence) {
    return undefined;
  }

  if (!recurrenceType) {
    throw new Error(
      'recurrenceType is required when using recurrence options.'
    );
  }

  const interval = recurrenceInterval === undefined ? 1 : recurrenceInterval;
  if (!Number.isInteger(interval) || interval < 1) {
    throw new Error('recurrenceInterval must be a positive integer.');
  }

  if (recurrenceEndDate && recurrenceCount !== undefined) {
    throw new Error('Use recurrenceEndDate or recurrenceCount, not both.');
  }

  if (recurrenceCount !== undefined) {
    if (!Number.isInteger(recurrenceCount) || recurrenceCount < 1) {
      throw new Error('recurrenceCount must be a positive integer.');
    }
  }

  if (recurrenceDaysOfWeek !== undefined && recurrenceType !== 'weekly') {
    throw new Error(
      'recurrenceDaysOfWeek can only be used with recurrenceType=weekly.'
    );
  }

  const startDate = extractDate(startDateTime);
  const pattern = buildRecurrencePattern({
    recurrenceType,
    interval,
    recurrenceDaysOfWeek,
    startDate,
  });
  const range = buildRecurrenceRange({
    startDate,
    recurrenceEndDate,
    recurrenceCount,
    timeZone,
  });

  return { pattern, range };
}

function normaliseRawRecurrence(rawRecurrence, timeZone) {
  if (!rawRecurrence.pattern || !rawRecurrence.range) {
    throw new Error('recurrenceRaw must include pattern and range objects.');
  }

  return {
    pattern: { ...rawRecurrence.pattern },
    range: {
      ...rawRecurrence.range,
      recurrenceTimeZone: rawRecurrence.range.recurrenceTimeZone || timeZone,
    },
  };
}

function buildRecurrencePattern({
  recurrenceType,
  interval,
  recurrenceDaysOfWeek,
  startDate,
}) {
  switch (recurrenceType) {
    case 'daily':
      return { type: 'daily', interval };
    case 'weekly':
      return {
        type: 'weekly',
        interval,
        daysOfWeek:
          recurrenceDaysOfWeek && recurrenceDaysOfWeek.length > 0
            ? recurrenceDaysOfWeek
            : [dayOfWeekForDate(startDate)],
        firstDayOfWeek: 'sunday',
      };
    case 'monthly':
      return {
        type: 'absoluteMonthly',
        interval,
        dayOfMonth: dayOfMonthForDate(startDate),
      };
    case 'yearly':
      return {
        type: 'absoluteYearly',
        interval,
        dayOfMonth: dayOfMonthForDate(startDate),
        month: monthForDate(startDate),
      };
    default:
      throw new Error(
        "recurrenceType must be one of 'daily', 'weekly', 'monthly', or 'yearly'."
      );
  }
}

function buildRecurrenceRange({
  startDate,
  recurrenceEndDate,
  recurrenceCount,
  timeZone,
}) {
  if (recurrenceCount !== undefined) {
    return {
      type: 'numbered',
      startDate,
      numberOfOccurrences: recurrenceCount,
      recurrenceTimeZone: timeZone,
    };
  }

  if (recurrenceEndDate) {
    return {
      type: 'endDate',
      startDate,
      endDate: recurrenceEndDate,
      recurrenceTimeZone: timeZone,
    };
  }

  return {
    type: 'noEnd',
    startDate,
    recurrenceTimeZone: timeZone,
  };
}

function extractDate(dateTime) {
  const date = String(dateTime).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('recurrence start date requires an ISO dateTime value.');
  }
  return date;
}

function dayOfWeekForDate(date) {
  const days = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  return days[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function dayOfMonthForDate(date) {
  return Number(date.slice(8, 10));
}

function monthForDate(date) {
  return Number(date.slice(5, 7));
}

module.exports = handleCreateEvent;
module.exports.buildRecurrence = buildRecurrence;
