/**
 * Mailbox scoping helper.
 *
 * Every Graph path in this server is built as `${prefix}/...`. The prefix is
 * `me` for the signed-in account, or `users/{email}` for a shared/delegated
 * mailbox. Keeping the construction in one place is what lets the shared-mailbox
 * parameter be threaded through readers, writers, and folder resolution without
 * each call site re-deciding the shape.
 */

// Pragmatic SMTP address / UPN shape — deliberately not full RFC 5322. The
// point is to keep caller input inside a single Graph path segment, so only
// printable ASCII is accepted: RFC 5322 `atext` in the local part minus `#`
// (a URL fragment delimiter), and dot-separated letters/digits/hyphens in the
// domain. No whitespace, control characters, `/ ? # % \`, or non-ASCII
// look-alikes (full-width `／`, zero-width spaces). The tool schemas advertise
// an email address only, so bare user GUIDs are not accepted.
const MAILBOX_PATTERN =
  /^[A-Za-z0-9.!$&'*+=^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const config = require('../config');

const SHARED_MAILBOX_DISABLED_MESSAGE =
  'Shared-mailbox support is turned off. It is opt-in and work/school only: ' +
  'set OUTLOOK_SHARED_MAILBOX=read (read), OUTLOOK_SHARED_MAILBOX=true ' +
  '(read and organise) or OUTLOOK_SHARED_MAILBOX=send (also send and draft ' +
  'as the shared mailbox) in the MCP server environment, restart the server, then ' +
  're-authenticate with `auth action=authenticate force=true` so the token ' +
  'carries the shared-mailbox scopes.';

const SHARED_MAILBOX_SEND_DISABLED_MESSAGE =
  'Sending and drafting as a shared mailbox is turned off. It is opt-in and ' +
  'work/school only: set OUTLOOK_SHARED_MAILBOX=send in the MCP server ' +
  'environment, restart the server, then re-authenticate with ' +
  '`auth action=authenticate force=true` so the token carries ' +
  'Mail.Send.Shared. Your account also needs "Send As" (or "Send on Behalf") ' +
  'on the shared mailbox in Exchange, and Full Access to it for drafts.';

/**
 * Validate a mailbox and build its Graph resource prefix, WITHOUT checking
 * whether shared-mailbox support is enabled. Only use at validation sites;
 * any tool making Graph requests must call buildMailboxPrefix instead.
 * @param {string|null} [mailbox] - Shared mailbox email address, or null/empty for the signed-in user
 * @returns {string} - `me` or `users/{mailbox}`
 * @throws {Error} If `mailbox` is non-empty but not a plausible email address
 */
function validateMailboxPrefix(mailbox) {
  const trimmed = typeof mailbox === 'string' ? mailbox.trim() : mailbox;
  if (!trimmed) {
    return 'me';
  }
  if (trimmed === 'me') {
    return 'me';
  }
  if (!MAILBOX_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid mailbox "${mailbox}" — expected a shared mailbox email address (e.g. "team@contoso.com").`
    );
  }
  // Return the address raw: encoding happens exactly once, in the Graph
  // client (`callGraphAPI` / `callGraphAPIRaw` encode each path segment).
  // Pre-encoding here double-encoded addresses like `team+archive@…` into
  // `%252B`. The pattern above already confines the value to one segment.
  return `users/${trimmed}`;
}

/**
 * Build the Graph resource prefix for a mailbox. A non-`me` mailbox requires
 * shared-mailbox support to be enabled (OUTLOOK_SHARED_MAILBOX).
 * @param {string|null} [mailbox] - Shared mailbox email address, or null/empty for the signed-in user
 * @returns {string} - `me` or `users/{mailbox}`
 * @throws {Error} If `mailbox` is invalid, or shared-mailbox support is off
 */
function buildMailboxPrefix(mailbox) {
  const prefix = validateMailboxPrefix(mailbox);
  if (prefix !== 'me' && config.SHARED_MAILBOX_MODE === 'off') {
    throw new Error(SHARED_MAILBOX_DISABLED_MESSAGE);
  }
  return prefix;
}

/**
 * Build the Graph resource prefix for sending or drafting. A non-`me`
 * mailbox requires OUTLOOK_SHARED_MAILBOX=send, the only mode that requests
 * Mail.Send.Shared.
 * @param {string|null} [mailbox] - Shared mailbox email address, or null/empty for the signed-in user
 * @returns {string} - `me` or `users/{mailbox}`
 * @throws {Error} If `mailbox` is invalid, or shared sending is off
 */
function buildSendMailboxPrefix(mailbox) {
  const prefix = validateMailboxPrefix(mailbox);
  if (prefix !== 'me' && config.SHARED_MAILBOX_MODE !== 'send') {
    throw new Error(SHARED_MAILBOX_SEND_DISABLED_MESSAGE);
  }
  return prefix;
}

/**
 * The mailbox send-email/draft act as, from `sharedMailbox` (alias `email`).
 * @param {object} args - Tool arguments
 * @returns {{prefix: string, sharedMailbox: string|null}} Graph prefix, and
 *   the shared address (null for the signed-in user)
 * @throws {Error} If the address is invalid, or shared sending is off
 */
function resolveSendMailbox(args) {
  const prefix = buildSendMailboxPrefix(args.sharedMailbox || args.email);
  return {
    prefix,
    sharedMailbox: prefix === 'me' ? null : prefix.slice('users/'.length),
  };
}

/**
 * `from` for a message composed as a shared mailbox, or undefined for the
 * signed-in user. With "Send on Behalf" (no "Send As"), Exchange shows
 * "you on behalf of" this address.
 * @param {string|null} sharedMailbox
 * @returns {object|undefined}
 */
function sharedFrom(sharedMailbox) {
  return sharedMailbox
    ? { emailAddress: { address: sharedMailbox } }
    : undefined;
}

module.exports = {
  buildMailboxPrefix,
  buildSendMailboxPrefix,
  resolveSendMailbox,
  sharedFrom,
  validateMailboxPrefix,
  SHARED_MAILBOX_DISABLED_MESSAGE,
  SHARED_MAILBOX_SEND_DISABLED_MESSAGE,
};
