/**
 * Create folder functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { getFolderIdByName } = require('../email/folder-utils');

/**
 * Create folder handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleCreateFolder(args) {
  const folderName = args.name;
  const parentFolder = args.parentFolder || '';

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
    const result = await createMailFolder(
      accessToken,
      folderName,
      parentFolder
    );

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
 * @param {string} parentFolderName - Name of the parent folder (optional)
 * @returns {Promise<object>} - Result object with status and message
 */
async function createMailFolder(accessToken, folderName, parentFolderName) {
  try {
    // Check if a folder with this name already exists
    const existingFolder = await getFolderIdByName(accessToken, folderName);
    if (existingFolder) {
      return {
        success: false,
        message: `A folder named "${folderName}" already exists.`,
      };
    }

    // If parent folder specified, find its ID
    let endpoint = 'me/mailFolders';
    if (parentFolderName) {
      const parentId = await getFolderIdByName(accessToken, parentFolderName);
      if (!parentId) {
        return {
          success: false,
          message: `Parent folder "${parentFolderName}" not found. Please specify a valid parent folder or leave it blank to create at the root level.`,
        };
      }

      endpoint = `me/mailFolders/${parentId}/childFolders`;
    }

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
      const locationInfo = parentFolderName
        ? `inside "${parentFolderName}"`
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
