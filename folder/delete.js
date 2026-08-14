/**
 * Delete folder functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { resolveFolder, WELL_KNOWN } = require('./resolve');
const { buildMailboxPrefix } = require('../utils/mailbox');

/**
 * Delete folder handler
 *
 * System folders are guarded by NAME/alias below — `WELL_KNOWN` covers the
 * Graph names, display-name variants ("Sent Items", "Deleted Items") and short
 * aliases ("sent"/"junk"/"spam"). A raw `folderId` that happens to point at a
 * system folder is backstopped by Graph, which rejects deleting distinguished
 * folders (mailFolder exposes no selectable `wellKnownName`, so we can't cheaply
 * re-check protection on a resolved-by-ID folder).
 *
 * @param {object} args - Tool arguments
 * @param {string} [args.folderId] - Folder ID to delete
 * @param {string} [args.folderName] - Folder name/path to delete (resolved to ID)
 * @returns {object} - MCP response
 */
async function handleDeleteFolder(args) {
  const { folderId, folderName } = args;
  const sharedMailbox = args.sharedMailbox || args.email || null;
  const prefix = buildMailboxPrefix(sharedMailbox);

  if (!folderId && !folderName) {
    return {
      content: [
        {
          type: 'text',
          text: 'Either folderId or folderName is required.',
        },
      ],
    };
  }

  // Name/alias guard for the common accidental case.
  if (folderName && WELL_KNOWN[folderName.toLowerCase().trim()]) {
    return {
      content: [
        {
          type: 'text',
          text: `Cannot delete protected folder "${folderName}". Protected folders: Inbox, Drafts, Sent Items, Deleted Items, Junk Email, Archive, Outbox.`,
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Resolve (by name/path OR explicit ID) so nested folders are addressable
    // and the confirmation can report the full path. (#216)
    let resolved;
    try {
      resolved = await resolveFolder(accessToken, {
        id: folderId,
        name: folderName,
        mailbox: sharedMailbox,
      });
    } catch (resolveError) {
      return {
        content: [{ type: 'text', text: resolveError.message }],
      };
    }

    // Delete the folder
    await callGraphAPI(
      accessToken,
      'DELETE',
      `${prefix}/mailFolders/${resolved.id}`
    );
    return {
      content: [
        {
          type: 'text',
          text: `Folder "${resolved.path}" deleted successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error deleting folder: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = handleDeleteFolder;
