/**
 * Mailbox scoping helper.
 *
 * Every Graph path in this server is built as `${prefix}/...`. The prefix is
 * `me` for the signed-in account, or `users/{email}` for a shared/delegated
 * mailbox. Keeping the construction in one place is what lets the shared-mailbox
 * parameter be threaded through readers, writers, and folder resolution without
 * each call site re-deciding the shape.
 */

// Pragmatic SMTP address / UPN shape — deliberately not RFC 5322. The point is
// to keep caller input inside a single Graph path segment: something@something
// .something with no whitespace and none of `/ ? # %` (path, query, fragment
// and percent-escape delimiters). The tool schemas advertise an email address
// only, so bare user GUIDs are not accepted.
const MAILBOX_PATTERN = /^[^\s/?#%@]+@[^\s/?#%@]+\.[^\s/?#%@]+$/;

const config = require('../config');

const SHARED_MAILBOX_DISABLED_MESSAGE =
  'Shared-mailbox support is turned off. It is opt-in and work/school only: ' +
  'set OUTLOOK_SHARED_MAILBOX=read (read) or OUTLOOK_SHARED_MAILBOX=true ' +
  '(read and organise) in the MCP server environment, restart the server, then ' +
  're-authenticate with `auth action=authenticate force=true` so the token ' +
  'carries the shared-mailbox scopes.';

/**
 * Validate a mailbox and build its Graph resource prefix, WITHOUT checking
 * whether shared-mailbox support is enabled. Only for paths that worked
 * before the opt-in flag existed (access-shared-mailbox's direct read).
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

module.exports = {
  buildMailboxPrefix,
  validateMailboxPrefix,
  SHARED_MAILBOX_DISABLED_MESSAGE,
};
