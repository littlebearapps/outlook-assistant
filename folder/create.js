/**
 * Create folder functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { resolveFolder, listChildFolders } = require('./resolve');
const { buildMailboxPrefix } = require('../utils/mailbox');

/**
 * Create folder handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleCreateFolder(args) {
  const folderName = (args.name || '').trim();
  const parentFolder = args.parentFolder || '';
  const parentFolderId = args.parentFolderId || '';
  const sharedMailbox = args.sharedMailbox || args.email || null;

  if (!folderName) {
    return {
      content: [
        {
          type: 'text',
          text: 'Folder name is required.',
        },
      ],
    };
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Create folder with appropriate parent
    const result = await createMailFolder(accessToken, folderName, {
      name: parentFolder,
      id: parentFolderId,
      mailbox: sharedMailbox,
    });

    return {
      content: [
        {
          type: 'text',
          text: result.message,
        },
      ],
      // F-31: surface the folder ID in _meta so callers can chain
      // create→move→stats without an extra `folders list` round-trip.
      ...(result.folderId && { _meta: { folderId: result.folderId } }),
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
          text: `Error creating folder: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Create a new mail folder
 * @param {string} accessToken - Access token
 * @param {string} folderName - Name of the folder to create
 * @param {{name?: string, id?: string, mailbox?: string|null}} parentSpec - Parent folder name/path or ID, plus optional shared mailbox
 * @returns {Promise<object>} - Result object with status and message
 */
async function createMailFolder(accessToken, folderName, parentSpec) {
  const mailbox = parentSpec.mailbox || null;
  const prefix = buildMailboxPrefix(mailbox);
  try {
    // Resolve the parent folder if one was specified (supports "Parent/Child"
    // paths and explicit IDs). Leaf name (folderName) is created, not
    // resolved. (#216)
    let parent = null;
    if (parentSpec.name || parentSpec.id) {
      try {
        parent = await resolveFolder(accessToken, parentSpec);
      } catch (resolveError) {
        return {
          success: false,
          message: `Parent folder could not be resolved: ${resolveError.message}`,
        };
      }
    }

    // Duplicate check scoped to the TARGET parent (or the root), not the whole
    // mailbox — a name may legitimately exist under a different parent. (#216)
    const siblings = await listChildFolders(
      accessToken,
      parent ? parent.id : null,
      undefined,
      mailbox
    );
    const lower = folderName.toLowerCase();
    if (siblings.some((f) => f.displayName.toLowerCase() === lower)) {
      return {
        success: false,
        message: `A folder named "${folderName}" already exists ${
          parent ? `under "${parent.path}"` : 'at the root level'
        }.`,
      };
    }

    const endpoint = parent
      ? `${prefix}/mailFolders/${parent.id}/childFolders`
      : `${prefix}/mailFolders`;

    // Create the folder
    const folderData = {
      displayName: folderName,
    };

    const response = await callGraphAPI(
      accessToken,
      'POST',
      endpoint,
      folderData
    );

    if (response && response.id) {
      const locationInfo = parent
        ? `inside "${parent.path}"`
        : 'at the root level';

      return {
        success: true,
        // F-31: include the ID in the human-readable message too so it
        // shows up for AI agents that don't read _meta.
        message: `Successfully created folder "${folderName}" ${locationInfo}.\n\n**ID**: ${response.id}`,
        folderId: response.id,
      };
    } else {
      return {
        success: false,
        message:
          "Failed to create folder. The server didn't return a folder ID.",
      };
    }
  } catch (error) {
    console.error(`Error creating folder "${folderName}": ${error.message}`);
    throw error;
  }
}

module.exports = handleCreateFolder;
