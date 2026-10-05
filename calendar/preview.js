/**
 * dryRun previews for calendar actions that email other people (#274):
 * create-event and manage-event cancel/decline/delete.
 *
 * A preview may read (the event, the signed-in address) but never writes,
 * and says exactly who would be emailed. "External" means an address whose
 * domain differs from the signed-in user's. That address comes from GET /me;
 * if that read fails, the organiser's address stands in on an event you
 * organised. Otherwise the external count is reported as unknown, never
 * guessed.
 */
const config = require('../config');
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { dryRunResult } = require('../utils/safety');
const handleListEvents = require('./list');

const { toUtcIso, formatLocal } = handleListEvents;

/** Most attendees listed by address; the rest are summarised. */
const MAX_LISTED = 25;

const RESTORE_NOTE =
  "Graph doesn't document a guaranteed way to restore a deleted event, so don't count on getting it back.";

/** Lower-cased domain of an email address, or null. */
function emailDomain(address) {
  if (typeof address !== 'string') return null;
  const at = address.lastIndexOf('@');
  return at > 0
    ? address
        .slice(at + 1)
        .trim()
        .toLowerCase() || null
    : null;
}

/** The signed-in user's address from GET /me, or null if it can't be read. */
async function getOwnAddress(accessToken) {
  try {
    const me = await callGraphAPI(accessToken, 'GET', 'me', null, {
      $select: 'mail,userPrincipalName',
    });
    return me?.mail || me?.userPrincipalName || null;
  } catch (_error) {
    return null;
  }
}

/** Own address, falling back to the organiser on an event you organised. */
async function ownAddressFor(accessToken, event) {
  const own = await getOwnAddress(accessToken);
  if (own) return own;
  return event.isOrganizer ? event.organizer?.emailAddress?.address : null;
}

/**
 * Split Graph attendees into people and rooms/resources, leaving out the
 * signed-in user, and mark each person external or not.
 * @returns {{people: Array<{address: string, external: (boolean|null)}>, resources: string[], external: (number|null)}}
 */
function summariseAttendees(attendees, ownAddress) {
  const own = ownAddress ? ownAddress.toLowerCase() : null;
  const ownDomain = emailDomain(own);
  const people = [];
  const resources = [];
  for (const attendee of attendees || []) {
    const address = attendee?.emailAddress?.address;
    if (!address || address.toLowerCase() === own) continue;
    if (attendee.type === 'resource') {
      resources.push(address);
    } else {
      people.push({
        address,
        external: ownDomain ? emailDomain(address) !== ownDomain : null,
      });
    }
  }
  const external = ownDomain ? people.filter((p) => p.external).length : null;
  return { people, resources, external };
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "6 attendees (2 external)" */
function countPhrase({ people, external }) {
  const ext =
    external === null ? 'external count unknown' : `${external} external`;
  return `${plural(people.length, 'attendee')} (${ext})`;
}

/** Who would be emailed, by address (capped). */
function recipientLines({ people, resources }) {
  const lines = [];
  if (people.length > 0) {
    lines.push('', 'Attendees:');
    for (const person of people.slice(0, MAX_LISTED)) {
      lines.push(`- ${person.address}${person.external ? ' (external)' : ''}`);
    }
    if (people.length > MAX_LISTED) {
      lines.push(`- …and ${people.length - MAX_LISTED} more`);
    }
  }
  if (resources.length > 0) {
    lines.push(
      '',
      `Rooms and resources also notified: ${resources.join(', ')}`
    );
  }
  return lines;
}

function messageLine(comment) {
  return typeof comment === 'string' && comment.trim() !== ''
    ? `Message: "${comment}"`
    : 'No message (no `comment` given).';
}

/** "on 3 Apr 2026, 9:00 am GMT+11:00" for an event read in UTC. */
function eventWhen(event) {
  try {
    const local = formatLocal(toUtcIso(event.start), config.DEFAULT_TIMEZONE);
    if (local) return `on ${local}`;
  } catch (_error) {
    // Fall through to the raw value.
  }
  const start = event.start || {};
  return start.dateTime
    ? `on ${start.dateTime} (${start.timeZone || 'UTC'})`
    : 'at an unknown time';
}

/** The organiser's name and address, or null if Graph gave neither. */
function organiserLabel(event) {
  const organiser = event.organizer?.emailAddress || {};
  if (organiser.name && organiser.address) {
    return `${organiser.name} <${organiser.address}>`;
  }
  return organiser.address || organiser.name || null;
}

/** "the organiser, Name <address>", or just "the organiser" if unknown. */
function theOrganiser(event) {
  const label = organiserLabel(event);
  return label ? `the organiser, ${label}` : 'the organiser';
}

/** "'Subject' on …", with a fallback for an event that has no subject. */
function eventTitle(event) {
  const subject = event.subject ? `'${event.subject}'` : '(no subject)';
  return `${subject} ${eventWhen(event)}`;
}

/** Read the fields a preview needs, with times in UTC. */
function fetchEvent(accessToken, eventId) {
  return callGraphAPI(
    accessToken,
    'GET',
    `me/events/${eventId}`,
    null,
    {
      $select: 'subject,start,end,isOrganizer,isCancelled,organizer,attendees',
    },
    { Prefer: 'outlook.timezone="UTC"' }
  );
}

/**
 * Preview create-event: who would be invited.
 * @param {object} event - The POST body create-event would send
 */
async function previewCreateEvent(event) {
  const { subject, start, end } = event;
  const attendees = event.attendees || [];
  const own =
    attendees.length > 0
      ? await getOwnAddress(await ensureAuthenticated())
      : null;
  const summary = summariseAttendees(attendees, own);

  const when =
    start.timeZone === end.timeZone
      ? `on ${start.dateTime} to ${end.dateTime} (${start.timeZone})`
      : `on ${start.dateTime} (${start.timeZone}) to ${end.dateTime} (${end.timeZone})`;
  const head = `Creates '${subject}' ${when} in your calendar`;
  let lines;
  if (summary.people.length > 0) {
    lines = [`${head} and emails invitations to ${countPhrase(summary)}.`];
  } else if (summary.resources.length > 0) {
    lines = [`${head}. No people are invited.`];
  } else {
    lines = [`${head}. No attendees, so no invitations are sent.`];
  }

  return dryRunResult([...lines, ...recipientLines(summary)], {
    action: 'create',
    subject,
    notified: summary.people.length,
    external: summary.external,
    event,
  });
}

/** Preview manage-event cancel: who gets the cancellation. */
async function previewCancelEvent(accessToken, { eventId, comment }) {
  const event = await fetchEvent(accessToken, eventId);
  const meta = { action: 'cancel', eventId };
  const title = eventTitle(event);

  if (!event.isOrganizer) {
    return dryRunResult(
      [
        `You aren't the organiser of ${title}, so Graph will refuse to cancel it and nobody is emailed.`,
        'Use action=decline to tell the organiser, or action=delete to remove it from your calendar.',
      ],
      { ...meta, notified: 0 }
    );
  }

  const summary = summariseAttendees(
    event.attendees,
    await ownAddressFor(accessToken, event)
  );
  const lines =
    summary.people.length > 0
      ? [
          `Cancels ${title} and emails a cancellation to ${countPhrase(summary)}.`,
          messageLine(comment),
        ]
      : [`Cancels ${title}. It has no attendees, so nobody is emailed.`];

  return dryRunResult([...lines, ...recipientLines(summary)], {
    ...meta,
    notified: summary.people.length,
    external: summary.external,
  });
}

/** Preview manage-event decline: whether the organiser is emailed. */
async function previewDeclineEvent(
  accessToken,
  { eventId, comment, sendResponse }
) {
  const event = await fetchEvent(accessToken, eventId);
  const meta = { action: 'decline', eventId };
  const title = eventTitle(event);
  const organiser = theOrganiser(event);

  if (event.isOrganizer) {
    return dryRunResult(
      [
        `You organised this event (${title}), so Graph will refuse to decline it and nobody is emailed.`,
        'Use action=cancel to cancel it for everyone, or action=delete to remove it.',
      ],
      { ...meta, notified: 0 }
    );
  }

  if (sendResponse === false) {
    return dryRunResult(
      `Declines ${title} without notifying ${organiser} (sendResponse=false).`,
      { ...meta, notified: 0 }
    );
  }

  const ownDomain = emailDomain(await ownAddressFor(accessToken, event));
  const organiserDomain = emailDomain(event.organizer?.emailAddress?.address);
  let status = ' (external status unknown)';
  if (ownDomain && organiserDomain) {
    status = organiserDomain === ownDomain ? ' (internal)' : ' (external)';
  }

  return dryRunResult(
    [
      `Declines ${title} and emails your response to ${organiser}${status}.`,
      messageLine(comment),
    ],
    { ...meta, notified: 1 }
  );
}

/** Preview manage-event delete: who (if anyone) gets a cancellation. */
async function previewDeleteEvent(accessToken, { eventId }) {
  const event = await fetchEvent(accessToken, eventId);
  const meta = { action: 'delete', eventId };
  const head = `Deletes ${eventTitle(event)} from your calendar`;

  if (!event.isOrganizer) {
    const organiser = organiserLabel(event)
      ? `${theOrganiser(event)},`
      : theOrganiser(event);
    return dryRunResult(
      [
        `${head}. Nobody is emailed: ${organiser} isn't told you won't attend (use action=decline for that).`,
        RESTORE_NOTE,
      ],
      { ...meta, notified: 0 }
    );
  }

  const summary = summariseAttendees(
    event.attendees,
    await ownAddressFor(accessToken, event)
  );
  if (event.isCancelled || summary.people.length === 0) {
    const why = event.isCancelled
      ? "it's already cancelled"
      : 'it has no attendees';
    return dryRunResult([`${head}. Nobody is emailed: ${why}.`, RESTORE_NOTE], {
      ...meta,
      notified: 0,
    });
  }

  return dryRunResult(
    [
      `${head} and emails a cancellation to ${countPhrase(summary)}.`,
      'To word that cancellation yourself, use action=cancel with a `comment` instead.',
      RESTORE_NOTE,
      ...recipientLines(summary),
    ],
    { ...meta, notified: summary.people.length, external: summary.external }
  );
}

/**
 * Fields that are the signed-in user's own view of the event. Changing
 * only these doesn't send attendees a meeting update.
 */
const PERSONAL_FIELDS = new Set([
  'categories',
  'reminderMinutesBeforeStart',
  'showAs',
]);

/**
 * Who a manage-event update would email (#303): the attendees of an event
 * you organise, plus who is added or removed when `attendees` is replaced.
 * @param {string} accessToken
 * @param {{eventId: string, patch: object}} options - the PATCH body
 * @returns {Promise<{lines: string[], notified: number, external: (number|null)}>}
 */
async function describeUpdateRecipients(accessToken, { eventId, patch }) {
  let event = null;
  try {
    event = await fetchEvent(accessToken, eventId);
  } catch (_error) {
    // Fall through to the cautious wording below.
  }
  if (!event || typeof event !== 'object') {
    return {
      lines: [
        "Couldn't read the event to check who would be emailed. If you organise it and it has attendees, saving this emails them an update.",
      ],
      notified: null,
      external: null,
    };
  }
  const title = eventTitle(event);
  const fields = Object.keys(patch);

  if (!event.isOrganizer) {
    return {
      lines: [
        `Updates ${title}. You aren't the organiser, so this changes only your copy and nobody is emailed.`,
      ],
      notified: 0,
      external: 0,
    };
  }

  const own = await ownAddressFor(accessToken, event);
  const before = summariseAttendees(event.attendees, own);
  const after = patch.attendees
    ? summariseAttendees(patch.attendees, own)
    : before;

  const lines = [];
  if (fields.every((field) => PERSONAL_FIELDS.has(field))) {
    lines.push(
      `Updates ${title}. Only your own settings change (${fields.join(', ')}), so attendees aren't sent an update.`
    );
    return { lines, notified: 0, external: 0 };
  }

  const empty = (summary) =>
    summary.people.length === 0 && summary.resources.length === 0;
  if (empty(before) && empty(after)) {
    lines.push(`Updates ${title}. It has no attendees, so nobody is emailed.`);
    return { lines, notified: 0, external: 0 };
  }

  const key = (address) => address.toLowerCase();
  const beforeSet = new Set(before.people.map((p) => key(p.address)));
  const afterSet = new Set(after.people.map((p) => key(p.address)));
  const added = after.people.filter((p) => !beforeSet.has(key(p.address)));
  const removed = before.people.filter((p) => !afterSet.has(key(p.address)));
  const changeLines = [];
  if (added.length > 0) {
    changeLines.push(
      `Added (sent an invitation): ${added.map((p) => p.address).join(', ')}`
    );
  }
  if (removed.length > 0) {
    changeLines.push(
      `Removed (sent a cancellation): ${removed.map((p) => p.address).join(', ')}`
    );
  }

  // Graph emails only the attendees whose status changed when the PATCH
  // carries nothing but `attendees` (except removing a distribution-list
  // member, which updates everyone): event-update docs.
  if (fields.length === 1 && fields[0] === 'attendees') {
    const changed = [...added, ...removed];
    if (changed.length === 0) {
      lines.push(
        `Updates ${title}. No attendee is added or removed, so nobody is emailed.`
      );
      return { lines, notified: 0, external: 0 };
    }
    lines.push(
      `Updates the attendees of ${title}. Only the people added or removed are emailed; the others aren't (unless a removed address is a distribution list, when Graph emails every attendee).`,
      ...changeLines
    );
    const external =
      after.external === null && before.external === null
        ? null
        : changed.filter((p) => p.external).length;
    return { lines, notified: changed.length, external };
  }

  if (after.people.length > 0) {
    lines.push(
      `Updates ${title} and emails an update to ${countPhrase(after)}.`
    );
  } else if (after.resources.length > 0) {
    lines.push(
      `Updates ${title}. It has no people attendees; its rooms or resources are sent the update.`
    );
  } else {
    lines.push(`Updates ${title} and removes every attendee.`);
  }
  lines.push(...changeLines, ...recipientLines(after));
  return {
    lines,
    notified: after.people.length + after.resources.length,
    external: after.external,
  };
}

module.exports = {
  emailDomain,
  summariseAttendees,
  describeUpdateRecipients,
  previewCreateEvent,
  previewCancelEvent,
  previewDeclineEvent,
  previewDeleteEvent,
};
