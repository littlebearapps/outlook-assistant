/**
 * Email folder utilities
 */
const { resolveFolder, looksLikeFolderId } = require('../folder/resolve');
const { buildMailboxPrefix } = require('../utils/mailbox');
const { log } = require('../utils/logger');

/**
 * Cache of folder information to reduce API calls
 * Format: { userId: { folderName: { id, path } } }
 */
const _folderCache = {};

/**
 * Well-known folder names and their endpoints.
 * Includes Graph API well-known names (sentitems, deleteditems, junkemail),
 * common display names (Sent Items, Deleted Items, Junk Email), and
 * short aliases (sent, deleted, junk) for consistent resolution across tools.
 */
const WELL_KNOWN_FOLDERS = {
  // Inbox
  inbox: 'me/mailFolders/inbox/messages',

  // Drafts
  drafts: 'me/mailFolders/drafts/messages',

  // Sent Items - alias, Graph API name, display name
  sent: 'me/mailFolders/sentItems/messages',
  sentitems: 'me/mailFolders/sentItems/messages',
  'sent items': 'me/mailFolders/sentItems/messages',

  // Deleted Items - alias, Graph API name, display name
  deleted: 'me/mailFolders/deletedItems/messages',
  deleteditems: 'me/mailFolders/deletedItems/messages',
  'deleted items': 'me/mailFolders/deletedItems/messages',

  // Junk Email - alias, Graph API name, display name, common alias
  junk: 'me/mailFolders/junkemail/messages',
  junkemail: 'me/mailFolders/junkemail/messages',
  'junk email': 'me/mailFolders/junkemail/messages',
  spam: 'me/mailFolders/junkemail/messages',

  // Archive
  archive: 'me/mailFolders/archive/messages',

  // Outbox
  outbox: 'me/mailFolders/outbox/messages',
};

/**
 * Re-point a `me/...` well-known endpoint at a different mailbox.
 * @param {string} endpoint - A WELL_KNOWN_FOLDERS value
 * @param {string} prefix - `me` or `users/{email}`
 * @returns {string}
 */
function scope(endpoint, prefix) {
  return prefix === 'me' ? endpoint : endpoint.replace(/^me\//, `${prefix}/`);
}

/**
 * Resolve a folder name to its endpoint path
 * @param {string} accessToken - Access token
 * @param {string} folderName - Folder name to resolve
 * @param {string|null} [mailbox] - Shared mailbox email, or null for the signed-in user
 * @returns {Promise<string>} - Resolved endpoint path
 */
async function resolveFolderPath(accessToken, folderName, mailbox = null) {
  const prefix = buildMailboxPrefix(mailbox);

  // Default to inbox if no folder specified
  if (!folderName) {
    return scope(WELL_KNOWN_FOLDERS.inbox, prefix);
  }

  // Check if it's a well-known folder (case-insensitive)
  const lowerFolderName = folderName.toLowerCase();
  if (WELL_KNOWN_FOLDERS[lowerFolderName]) {
    log.debug(`Using well-known folder path for "${folderName}"`);
    return scope(WELL_KNOWN_FOLDERS[lowerFolderName], prefix);
  }

  // A raw folder ID is used as-is, as conversations/export did before name
  // resolution was added (resolving it as a display name would fail).
  if (looksLikeFolderId(folderName)) {
    return `${prefix}/mailFolders/${folderName.trim()}/messages`;
  }

  try {
    // Path-aware resolution: supports nested folders ("Parent/Child"),
    // case-insensitive names, and reports ambiguity — the same shared resolver
    // the `folders` tool uses, so search can now scope to nested folders. (#216)
    const resolved = await resolveFolder(accessToken, {
      name: folderName,
      mailbox,
    });
    const path = `${prefix}/mailFolders/${resolved.id}/messages`;
    log.debug(`Resolved folder "${folderName}" to path: ${path}`);
    return path;
  } catch (error) {
    // Surface not-found / ambiguity messages verbatim; wrap anything else.
    if (
      error.message.includes('not found') ||
      error.message.includes('ambiguous')
    ) {
      throw error;
    }
    throw new Error(
      `Error resolving folder "${folderName}": ${error.message}. Use the folders tool (action=list) to see available folders.`,
      { cause: error }
    );
  }
}

module.exports = {
  WELL_KNOWN_FOLDERS,
  resolveFolderPath,
};
