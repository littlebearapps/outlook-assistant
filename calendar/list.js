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
const { parseIsoInstant } = require('../utils/datetime');

const MAX_SUBJECT_LENGTH = 255;

/**
 * Error raised for invalid list-events arguments, so the handler can report it
 * as a tool error without touching the network.
 */
class ListEventsArgumentError extends Error {}

/**
 * Parse an ISO 8601 instant (with `Z` or a ±hh:mm offset) and return it as a
 * UTC ISO string. Events are requested in UTC, so comparing against a UTC
 * instant keeps the filter correct for offset inputs such as +10:00.
 * The schema declares `format: "date-time"` but the MCP schema-coerce layer
 * does not enforce JSON Schema `format`, so we enforce here at runtime.
 */
function toUtcIsoDateTime(value, paramName) {
  const parsed = parseIsoInstant(value);
  if (Number.isNaN(parsed)) {
    throw new ListEventsArgumentError(
      `Invalid ${paramName}: expected an ISO 8601 datetime with "Z" or a ±hh:mm offset, e.g. "2026-01-01T00:00:00Z" (got ${JSON.stringify(String(value).slice(0, 40))}).`
    );
  }
  return new Date(parsed).toISOString();
}

/**
 * Validate the subject filter: a non-empty-safe string of bounded length that
 * can be URL-encoded (a lone surrogate would make encodeURIComponent throw).
 */
function assertValidSubject(subject) {
  if (typeof subject !== 'string') {
    throw new ListEventsArgumentError('Invalid subject: expected a string.');
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new ListEventsArgumentError(
      `Invalid subject: must be at most ${MAX_SUBJECT_LENGTH} characters.`
    );
  }
  try {
    encodeURIComponent(subject);
  } catch (_e) {
    throw new ListEventsArgumentError(
      'Invalid subject: contains malformed Unicode.'
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
 * startAfter/startBefore must carry a zone and are normalised to UTC; invalid
 * values raise before any Graph call is made. Single quotes in the subject are
 * escaped via OData rules (`'` -> `''`) to prevent filter injection.
 *
 * Graph requires `$orderby` properties to lead the `$filter`, so a subject-only
 * search gets a `start/dateTime ge '1900-…'` lead clause (which matches every
 * event) to avoid an InefficientFilter error.
 *
 * @param {object} args - { startAfter?, startBefore?, subject? }
 * @returns {string} - The complete $filter expression
 */
function buildListEventsFilter(args) {
  const { startAfter, startBefore, subject } = args;
  const hasAnyFilter = Boolean(startAfter || startBefore || subject);

  const conditions = [];

  if (hasAnyFilter) {
    const after = startAfter
      ? toUtcIsoDateTime(startAfter, 'startAfter')
      : null;
    const before = startBefore
      ? toUtcIsoDateTime(startBefore, 'startBefore')
      : null;
    if (after && before && after >= before) {
      throw new ListEventsArgumentError(
        'Invalid range: startAfter must be earlier than startBefore.'
      );
    }
    if (subject) assertValidSubject(subject);

    if (after) conditions.push(`start/dateTime ge '${after}'`);
    if (before) conditions.push(`start/dateTime lt '${before}'`);
    if (!after && !before) {
      conditions.push("start/dateTime ge '1900-01-01T00:00:00.000Z'");
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
 * Sort order for list-events: oldest first for upcoming or bounded windows;
 * newest first when the search only looks backwards (an upper bound only, or a
 * subject with no dates), so `$top` returns the most recent matches rather
 * than the oldest events in the calendar.
 * @param {object} args - { startAfter?, startBefore?, subject? }
 * @returns {string} - The $orderby expression
 */
function listEventsOrderBy(args) {
  const { startAfter, startBefore, subject } = args;
  const newestFirst = !startAfter && Boolean(startBefore || subject);
  return newestFirst ? 'start/dateTime desc' : 'start/dateTime';
}

/**
 * Normalise a Graph dateTimeTimeZone value to a canonical UTC ISO-8601 string
 * (e.g. "2026-04-02T22:00:00.000Z"). This is the authoritative, unambiguous
 * value returned to consumers so an AI client never has to guess the zone. (#118)
 *
 * We request events in UTC (Prefer: outlook.timezone="UTC"), so Graph returns
 * zone-less dateTimes tagged timeZone:"UTC". We still validate defensively
 * rather than blindly appending "Z":
 *  - values already ending in "Z" or carrying an explicit numeric offset are
 *    parsed as-is (never double-suffixed);
 *  - zone-less values are treated as UTC ONLY when the accompanying timeZone is
 *    UTC (or absent); any other zone throws rather than emit a wrong instant.
 *
 * @param {{dateTime: string, timeZone?: string}} dtz - Graph start/end value
 * @returns {string} Canonical UTC ISO-8601 string
 * @throws {Error} if missing/unparseable, or zone-less in a non-UTC zone
 */
function toUtcIso(dtz) {
  if (!dtz || !dtz.dateTime) {
    throw new Error('event time missing dateTime');
  }
  const raw = String(dtz.dateTime).trim();
  const hasZ = /[zZ]$/.test(raw);
  const hasOffset = /[+-]\d{2}:?\d{2}$/.test(raw);

  let iso;
  if (hasZ || hasOffset) {
    // Already zone-aware — parse as-is, never double-suffix.
    iso = raw;
  } else {
    // Zone-less. Safe to treat as UTC only when Graph says so.
    const zone = (dtz.timeZone || 'UTC').toUpperCase();
    if (zone !== 'UTC') {
      throw new Error(
        `cannot normalise zone-less time in non-UTC zone "${dtz.timeZone}"`
      );
    }
    iso = `${raw}Z`;
  }

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid event dateTime "${dtz.dateTime}"`);
  }
  return parsed.toISOString();
}

/**
 * Render a UTC ISO instant as a human-friendly local time explicitly labelled
 * with its zone offset (e.g. "3 Apr 2026, 9:00 am GMT+11:00"), so it can never
 * be mistaken for UTC or another zone. Returns '' if unrenderable.
 *
 * NB: explicit component options are used deliberately — combining
 * `dateStyle`/`timeStyle` with `timeZoneName` throws `Invalid option` in Intl.
 *
 * @param {string} utcIso - Canonical UTC ISO-8601 instant
 * @param {string} tz - IANA display timezone
 * @returns {string}
 */
function formatLocal(utcIso, tz) {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('en-AU', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'longOffset',
    });
  } catch (_e) {
    return '';
  }
}

/**
 * List events handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleListEvents(args) {
  // Whole number in 1..MAX_RESULT_COUNT: Graph rejects $top below 1 or
  // fractional, and the schema promises the cap.
  const requested = args.count == null ? 10 : Math.floor(args.count);
  const count = Math.min(
    Math.max(Number.isFinite(requested) ? requested : 10, 1),
    config.MAX_RESULT_COUNT
  );

  // Validate arguments before authenticating, so a bad argument is reported
  // as such (and never reaches the network).
  let filter;
  try {
    filter = buildListEventsFilter(args);
  } catch (error) {
    if (error instanceof ListEventsArgumentError) {
      return {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      };
    }
    throw error;
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Build API endpoint
    const endpoint = 'me/events';

    // Add query parameters
    const queryParams = {
      $top: count,
      $orderby: listEventsOrderBy(args),
      $filter: filter,
      $select: config.CALENDAR_SELECT_FIELDS,
    };

    // Make API call. Force UTC so Graph's returned instants are unambiguous
    // regardless of mailbox/server timezone; we then emit canonical UTC ISO
    // plus a labelled local rendering. (#118)
    const response = await callGraphAPI(
      accessToken,
      'GET',
      endpoint,
      null,
      queryParams,
      { Prefer: 'outlook.timezone="UTC"' }
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

    // Format results. Each Start/End is the canonical UTC ISO-8601 instant
    // (unambiguous for machine consumers), followed by a labelled local
    // rendering in the configured display timezone for human readers. (#118)
    const tz = config.DEFAULT_TIMEZONE;
    const eventList = response.value
      .map((event, index) => {
        // Authoritative machine-readable instants. Fall back to the raw Graph
        // value if normalisation fails so one odd event can't break the list.
        let startUtc;
        let endUtc;
        try {
          startUtc = toUtcIso(event.start);
        } catch (_e) {
          startUtc = event.start?.dateTime || 'unknown';
        }
        try {
          endUtc = toUtcIso(event.end);
        } catch (_e) {
          endUtc = event.end?.dateTime || 'unknown';
        }

        const startLocal = formatLocal(startUtc, tz);
        const endLocal = formatLocal(endUtc, tz);
        const startStr = startLocal ? `${startUtc} (${startLocal})` : startUtc;
        const endStr = endLocal ? `${endUtc} (${endLocal})` : endUtc;

        const location = event.location?.displayName || 'No location';

        return `${index + 1}. ${event.subject} - Location: ${location}\nStart: ${startStr}\nEnd: ${endStr}\nSummary: ${event.bodyPreview}\nID: ${event.id}\n`;
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

// Primary export stays the handler (default import used by calendar/index.js
// and tests). Helpers are attached for unit testing without changing callers.
handleListEvents.toUtcIso = toUtcIso;
handleListEvents.formatLocal = formatLocal;

module.exports = handleListEvents;
module.exports.buildListEventsFilter = buildListEventsFilter;
module.exports.listEventsOrderBy = listEventsOrderBy;
