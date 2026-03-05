/**
 * Delete folder functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { getFolderIdByName } = require('../email/folder-utils');

/**
 * Protected folder names that cannot be deleted
 */
const PROTECTED_FOLDERS = [
  'inbox',
  'drafts',
  'sentitems',
  'deleteditems',
  'junkemail',
  'archive',
  'outbox',
];

/**
 * Delete folder handler
 * @param {object} args - Tool arguments
 * @param {string} [args.folderId] - Folder ID to delete
 * @param {string} [args.folderName] - Folder name to delete (resolved to ID)
 * @returns {object} - MCP response
 */
async function handleDeleteFolder(args) {
  const { folderId, folderName } = args;

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

  // Guard against deleting protected folders
  if (folderName && PROTECTED_FOLDERS.includes(folderName.toLowerCase())) {
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

    let resolvedId = folderId;

    // Resolve folder name to ID if needed
    if (!resolvedId && folderName) {
      resolvedId = await getFolderIdByName(accessToken, folderName);
      if (!resolvedId) {
        return {
          content: [
            {
              type: 'text',
              text: `Folder "${folderName}" not found. Use folders (action=list) to see available folders.`,
            },
          ],
        };
      }
    }

    // Delete the folder
    await callGraphAPI(accessToken, 'DELETE', `me/mailFolders/${resolvedId}`);

    const displayName = folderName || resolvedId;
    return {
      content: [
        {
          type: 'text',
          text: `Folder "${displayName}" deleted successfully.`,
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
