/**
 * Shared attendee builder for create-event and manage-event update (#249).
 *
 * Callers pass each attendee as a plain email string or as
 * `{ email, type }` where type is `required`, `optional` or `resource`.
 * Graph's PATCH on `attendees` replaces the whole list, so an entry
 * without a type takes the type that address already has on the event
 * (matched case-insensitively) and only falls back to `required` for a
 * new address. An explicit type always wins.
 */

const { findBlockedRecipients } = require('../utils/safety');
const { toolError } = require('../utils/tool-error');

const ATTENDEE_TYPES = ['required', 'optional', 'resource'];
const ATTENDEE_FIELDS = new Set(['email', 'type']);

function invalid(index, reason) {
  return new Error(`Invalid attendee at position ${index + 1}: ${reason}`);
}

/**
 * Validate one attendee entry.
 * @param {string|object} entry - Email string or {email, type}
 * @param {number} index - Position in the list (for error messages)
 * @returns {{email: string, type: (string|undefined)}}
 * @throws {Error} 'Invalid attendee at position N: …'
 */
function normaliseAttendeeInput(entry, index) {
  if (typeof entry === 'string') {
    const email = entry.trim();
    if (!email) throw invalid(index, 'email address is empty.');
    return { email, type: undefined };
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw invalid(
      index,
      `expected an email address or an {email, type} object, got ${JSON.stringify(entry)}.`
    );
  }

  const unknown = Object.keys(entry).find((k) => !ATTENDEE_FIELDS.has(k));
  if (unknown) {
    throw invalid(
      index,
      `unknown attendee field '${unknown}'. Use {email, type}.`
    );
  }
  if (typeof entry.email !== 'string' || !entry.email.trim()) {
    throw invalid(index, 'email address is missing or empty.');
  }

  const type = entry.type ?? undefined;
  if (type !== undefined && !ATTENDEE_TYPES.includes(type)) {
    throw invalid(
      index,
      `type '${type}' must be one of: ${ATTENDEE_TYPES.join(', ')}.`
    );
  }
  return { email: entry.email.trim(), type };
}

/**
 * Validate a whole attendee list.
 * @param {Array} list
 * @returns {Array<{email: string, type: (string|undefined)}>}
 */
function normaliseAttendees(list) {
  if (!Array.isArray(list)) {
    throw new Error(
      'Invalid attendees: expected a list of email addresses or {email, type} objects.'
    );
  }
  return list.map((entry, index) => normaliseAttendeeInput(entry, index));
}

/**
 * Build the Graph `attendees` array.
 * @param {Array} list - Email strings and/or {email, type} objects
 * @param {Array} current - The event's current Graph attendees (update only)
 * @returns {Array<{emailAddress: {address: string}, type: string}>}
 */
function buildAttendees(list, current = []) {
  const currentTypes = new Map();
  for (const attendee of current || []) {
    const address = attendee?.emailAddress?.address;
    if (typeof address === 'string' && ATTENDEE_TYPES.includes(attendee.type)) {
      currentTypes.set(address.toLowerCase(), attendee.type);
    }
  }

  return normaliseAttendees(list).map(({ email, type }) => ({
    emailAddress: { address: email },
    type: type || currentTypes.get(email.toLowerCase()) || 'required',
  }));
}

/**
 * Refuse an attendee list that OUTLOOK_ALLOWED_RECIPIENTS doesn't fully
 * allow: Graph emails every attendee (rooms and resources included) an
 * invitation or update carrying the event body. The whole call is refused,
 * never sent with the blocked attendees dropped, and a dry run reports the
 * refusal too. Needs no Graph call.
 * @param {Array<{emailAddress: {address: string}}>} attendees - Graph attendees
 * @param {{operation?: 'create'|'update', dryRun?: boolean}} [options]
 * @returns {object|null} - toolError naming the blocked addresses, or null
 */
function checkAttendeeAllowlist(
  attendees,
  { operation = 'create', dryRun = false } = {}
) {
  if (!attendees || attendees.length === 0) return null;
  const result = findBlockedRecipients(attendees);
  if (!result) return null;

  const subject = operation === 'update' ? 'Event update' : 'Event';
  const lead = dryRun
    ? `DRY RUN — ${subject.toLowerCase()} would be refused`
    : `${subject} refused`;
  const outcome = operation === 'update' ? 'changed' : 'created';
  return toolError(
    `${lead}: OUTLOOK_ALLOWED_RECIPIENTS does not allow attendee ${result.blocked.join(', ')} (allowed recipients/domains: ${result.allowed.join(', ')}). Graph emails every attendee, so nothing was ${outcome}; the call is refused whole rather than sent without them.`,
    {
      nextStep:
        'Remove those attendees and retry, or ask the user to add them to OUTLOOK_ALLOWED_RECIPIENTS in the server configuration and restart the server.',
    }
  );
}

module.exports = {
  ATTENDEE_TYPES,
  checkAttendeeAllowlist,
  normaliseAttendeeInput,
  normaliseAttendees,
  buildAttendees,
};
