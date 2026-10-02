/**
 * List folders functionality
 */
const { ensureAuthenticated } = require('../auth');
const { listChildFolders } = require('./resolve');

/**
 * List folders handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleListFolders(args) {
  const includeItemCounts = args.includeItemCounts === true;
  const includeChildren = args.includeChildren === true;

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Get all mail folders
    const folders = await getAllFoldersHierarchy(
      accessToken,
      includeItemCounts
    );

    // If including children, format as hierarchy
    if (includeChildren) {
      return {
        content: [
          {
            type: 'text',
            text: formatFolderHierarchy(folders, includeItemCounts),
          },
        ],
      };
    } else {
      // Otherwise, format as flat list
      return {
        content: [
          {
            type: 'text',
            text: formatFolderList(folders, includeItemCounts),
          },
        ],
      };
    }
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
          text: `Error listing folders: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Get all mail folders with hierarchy information
 * @param {string} accessToken - Access token
 * @param {boolean} includeItemCounts - Include item counts in response
 * @returns {Promise<Array>} - Array of folder objects with hierarchy
 */
async function getAllFoldersHierarchy(accessToken, includeItemCounts) {
  // Determine select fields based on whether to include counts
  const selectFields = includeItemCounts
    ? 'id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount'
    : 'id,displayName,parentFolderId,childFolderCount';

  // Full recursive, paginated walk so nested folders at ANY depth appear with
  // their complete path (not just one level). (#216 review)
  const top = await listChildFolders(accessToken, null, selectFields);
  const all = [];
  const visited = new Set();
  const queue = top.map((folder) => ({
    folder,
    path: folder.displayName,
    parentPath: null,
    depth: 1,
    isTopLevel: true,
  }));

  for (let i = 0; i < queue.length; i++) {
    const { folder, path, parentPath, depth, isTopLevel } = queue[i];
    if (visited.has(folder.id)) {
      continue;
    }
    visited.add(folder.id);
    all.push({ ...folder, path, parentFolder: parentPath, isTopLevel });

    if (folder.childFolderCount > 0 && depth < 20) {
      let children;
      try {
        children = await listChildFolders(accessToken, folder.id, selectFields);
      } catch (error) {
        console.error(
          `Error getting child folders for "${folder.displayName}": ${error.message}`
        );
        continue;
      }
      for (const child of children) {
        queue.push({
          folder: child,
          path: `${path}/${child.displayName}`,
          parentPath: path,
          depth: depth + 1,
          isTopLevel: false,
        });
      }
    }
  }
  return all;
}

/**
 * Format folders as a flat list
 * @param {Array} folders - Array of folder objects
 * @param {boolean} includeItemCounts - Whether to include item counts
 * @returns {string} - Formatted list
 */
function formatFolderList(folders, includeItemCounts) {
  if (!folders || folders.length === 0) {
    return 'No folders found.';
  }

  // Sort folders alphabetically, with well-known folders first
  const wellKnownFolderNames = [
    'Inbox',
    'Drafts',
    'Sent Items',
    'Deleted Items',
    'Junk Email',
    'Archive',
  ];

  const sortedFolders = [...folders].sort((a, b) => {
    // Well-known folders come first
    const aIsWellKnown = wellKnownFolderNames.includes(a.displayName);
    const bIsWellKnown = wellKnownFolderNames.includes(b.displayName);

    if (aIsWellKnown && !bIsWellKnown) return -1;
    if (!aIsWellKnown && bIsWellKnown) return 1;

    if (aIsWellKnown && bIsWellKnown) {
      // Sort well-known folders by their index in the array
      return (
        wellKnownFolderNames.indexOf(a.displayName) -
        wellKnownFolderNames.indexOf(b.displayName)
      );
    }

    // Sort other folders alphabetically
    return a.displayName.localeCompare(b.displayName);
  });

  // Format each folder. Emit the full path and folder ID so callers can
  // address nested folders directly — `folders move targetFolder="Parent/Child"`
  // or `targetFolderId=...`. (#216)
  const folderLines = sortedFolders.map((folder) => {
    // Full path (computed during the recursive walk) so nested folders are
    // addressable directly. (#216)
    let folderInfo = folder.path || folder.displayName;

    // Add item counts if requested
    if (includeItemCounts) {
      const unreadCount = folder.unreadItemCount || 0;
      const totalCount = folder.totalItemCount || 0;
      folderInfo += ` - ${totalCount} items`;

      if (unreadCount > 0) {
        folderInfo += ` (${unreadCount} unread)`;
      }
    }

    folderInfo += ` [id: ${folder.id}]`;

    return folderInfo;
  });

  return `Found ${folders.length} folders:\n\n${folderLines.join('\n')}`;
}

/**
 * Format folders as a hierarchical tree
 * @param {Array} folders - Array of folder objects
 * @param {boolean} includeItemCounts - Whether to include item counts
 * @returns {string} - Formatted hierarchy
 */
function formatFolderHierarchy(folders, includeItemCounts) {
  if (!folders || folders.length === 0) {
    return 'No folders found.';
  }

  // Build folder hierarchy
  const folderMap = new Map();
  const rootFolders = [];

  // First pass: create map of all folders
  folders.forEach((folder) => {
    folderMap.set(folder.id, {
      ...folder,
      children: [],
    });

    if (folder.isTopLevel) {
      rootFolders.push(folder.id);
    }
  });

  // Second pass: build hierarchy
  folders.forEach((folder) => {
    if (!folder.isTopLevel && folder.parentFolderId) {
      const parent = folderMap.get(folder.parentFolderId);
      if (parent) {
        parent.children.push(folder.id);
      } else {
        // Fallback for orphaned folders
        rootFolders.push(folder.id);
      }
    }
  });

  // Format hierarchy recursively
  function formatSubtree(folderId, level = 0) {
    const folder = folderMap.get(folderId);
    if (!folder) return '';

    const indent = '  '.repeat(level);
    let line = `${indent}${folder.displayName}`;

    // Add item counts if requested
    if (includeItemCounts) {
      const unreadCount = folder.unreadItemCount || 0;
      const totalCount = folder.totalItemCount || 0;
      line += ` - ${totalCount} items`;

      if (unreadCount > 0) {
        line += ` (${unreadCount} unread)`;
      }
    }

    // Surface the folder ID so callers can address it directly. (#216)
    line += ` [id: ${folder.id}]`;

    // Add children
    const childLines = folder.children
      .map((childId) => formatSubtree(childId, level + 1))
      .filter((childLine) => childLine.length > 0)
      .join('\n');

    return childLines.length > 0 ? `${line}\n${childLines}` : line;
  }

  // Format all root folders
  const formattedHierarchy = rootFolders
    .map((folderId) => formatSubtree(folderId))
    .join('\n');

  return `Folder Hierarchy:\n\n${formattedHierarchy}`;
}

module.exports = handleListFolders;
