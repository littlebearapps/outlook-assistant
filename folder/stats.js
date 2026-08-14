/**
 * Get folder statistics functionality
 *
 * Returns folder item counts and metadata for pagination planning.
 * Supports outputVerbosity for token-efficient responses.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { resolveFolder } = require('./resolve');
const { buildMailboxPrefix } = require('../utils/mailbox');
const config = require('../config');

const { VERBOSITY, DEFAULT_LIMITS } = config;

/**
 * Get folder stats handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleGetFolderStats(args) {
  const folderName = args.folder || 'inbox';
  const folderIdArg = args.folderId || '';
  const verbosity = args.outputVerbosity || VERBOSITY.STANDARD;
  const sharedMailbox = args.sharedMailbox || args.email || null;
  const prefix = buildMailboxPrefix(sharedMailbox);

  try {
    const accessToken = await ensureAuthenticated();

    // Resolve folder (name/path/alias/ID → concrete folder). (#216)
    let resolved;
    try {
      resolved = await resolveFolder(accessToken, {
        name: folderName,
        id: folderIdArg,
        mailbox: sharedMailbox,
      });
    } catch (resolveError) {
      return {
        content: [{ type: 'text', text: resolveError.message }],
      };
    }
    const folderId = resolved.id;

    // Get folder details with full stats
    const folder = await callGraphAPI(
      accessToken,
      'GET',
      `${prefix}/mailFolders/${folderId}`,
      null,
      {
        // Note: sizeInBytes is NOT available on mailFolder resource type
        $select:
          'id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount,isHidden',
      }
    );

    // Get recent email dates for context
    let dateRange = null;
    if (verbosity !== VERBOSITY.MINIMAL && folder.totalItemCount > 0) {
      dateRange = await getEmailDateRange(accessToken, folderId, sharedMailbox);
    }

    // Format response based on verbosity
    const formatted = formatFolderStats(folder, dateRange, verbosity);

    return {
      content: [
        {
          type: 'text',
          text: formatted.text,
        },
      ],
      _meta: formatted.meta,
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
          text: `Error getting folder stats: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Get date range of emails in folder
 * @param {string} accessToken - Access token
 * @param {string} folderId - Folder ID
 * @param {string|null} [mailbox] - Shared mailbox email, or null for the signed-in user
 * @returns {Promise<object|null>} - { oldest, newest } dates or null
 */
async function getEmailDateRange(accessToken, folderId, mailbox = null) {
  const prefix = buildMailboxPrefix(mailbox);
  try {
    // Get newest email
    const newestResponse = await callGraphAPI(
      accessToken,
      'GET',
      `${prefix}/mailFolders/${folderId}/messages`,
      null,
      {
        $select: 'receivedDateTime',
        $orderby: 'receivedDateTime desc',
        $top: 1,
      }
    );

    // Get oldest email
    const oldestResponse = await callGraphAPI(
      accessToken,
      'GET',
      `${prefix}/mailFolders/${folderId}/messages`,
      null,
      {
        $select: 'receivedDateTime',
        $orderby: 'receivedDateTime asc',
        $top: 1,
      }
    );

    const newest = newestResponse.value?.[0]?.receivedDateTime;
    const oldest = oldestResponse.value?.[0]?.receivedDateTime;

    if (newest && oldest) {
      return { newest, oldest };
    }
  } catch (error) {
    console.error(`Error getting date range: ${error.message}`);
  }

  return null;
}

/**
 * Format folder stats based on verbosity
 * @param {object} folder - Folder object from Graph API
 * @param {object|null} dateRange - Date range object
 * @param {string} verbosity - Verbosity level
 * @returns {object} - { text, meta }
 */
function formatFolderStats(folder, dateRange, verbosity) {
  const totalItems = folder.totalItemCount || 0;
  const unreadItems = folder.unreadItemCount || 0;

  // Calculate pagination info
  const pageSize = DEFAULT_LIMITS.listEmails;
  const totalPages = Math.ceil(totalItems / pageSize);

  // Build meta object
  const meta = {
    folderId: folder.id,
    folderName: folder.displayName,
    totalItems,
    unreadItems,
    pageSize,
    totalPages,
    verbosity,
  };

  // Minimal: Just key numbers
  if (verbosity === VERBOSITY.MINIMAL) {
    return {
      text: `${folder.displayName}: ${totalItems} items (${unreadItems} unread)`,
      meta,
    };
  }

  // Standard: Markdown table with key stats
  if (verbosity === VERBOSITY.STANDARD) {
    let text = `## ${folder.displayName} Statistics\n\n`;
    text += `| Metric | Value |\n`;
    text += `|--------|-------|\n`;
    text += `| Total Items | ${totalItems.toLocaleString()} |\n`;
    text += `| Unread Items | ${unreadItems.toLocaleString()} |\n`;
    text += `| Pages (${pageSize}/page) | ${totalPages} |\n`;

    if (dateRange) {
      const newest = new Date(dateRange.newest).toLocaleDateString('en-AU');
      const oldest = new Date(dateRange.oldest).toLocaleDateString('en-AU');
      text += `| Date Range | ${oldest} to ${newest} |\n`;
    }

    if (totalItems > 100) {
      text += `\n_Hint: Use list-emails-delta for efficient incremental sync of large folders._`;
    }

    return { text, meta };
  }

  // Full: All available information
  let text = `# ${folder.displayName} - Full Statistics\n\n`;

  text += `## Overview\n\n`;
  text += `| Metric | Value |\n`;
  text += `|--------|-------|\n`;
  text += `| Folder ID | \`${folder.id}\` |\n`;
  text += `| Display Name | ${folder.displayName} |\n`;
  text += `| Total Items | ${totalItems.toLocaleString()} |\n`;
  text += `| Unread Items | ${unreadItems.toLocaleString()} |\n`;
  text += `| Read Items | ${(totalItems - unreadItems).toLocaleString()} |\n`;
  text += `| Child Folders | ${folder.childFolderCount || 0} |\n`;
  text += `| Hidden | ${folder.isHidden ? 'Yes' : 'No'} |\n`;

  if (folder.parentFolderId) {
    text += `| Parent Folder ID | \`${folder.parentFolderId}\` |\n`;
  }

  text += `\n## Pagination Planning\n\n`;
  text += `| Setting | Value |\n`;
  text += `|---------|-------|\n`;
  text += `| Page Size | ${pageSize} emails |\n`;
  text += `| Total Pages | ${totalPages} |\n`;
  text += `| Estimated API Calls | ${totalPages} (list-emails) |\n`;

  if (dateRange) {
    const newestDate = new Date(dateRange.newest);
    const oldestDate = new Date(dateRange.oldest);
    const daysDiff = Math.ceil(
      (newestDate - oldestDate) / (1000 * 60 * 60 * 24)
    );

    text += `\n## Date Range\n\n`;
    text += `| Boundary | Date |\n`;
    text += `|----------|------|\n`;
    text += `| Newest | ${newestDate.toLocaleString('en-AU')} |\n`;
    text += `| Oldest | ${oldestDate.toLocaleString('en-AU')} |\n`;
    text += `| Span | ${daysDiff} days |\n`;

    meta.dateRange = dateRange;
    meta.spanDays = daysDiff;
  }

  text += `\n## Recommendations\n\n`;

  if (totalItems > 1000) {
    text += `- **Large folder**: Use \`list-emails-delta\` for incremental sync\n`;
    text += `- **Use date filters**: \`receivedAfter\` and \`receivedBefore\` to narrow scope\n`;
  } else if (totalItems > 100) {
    text += `- **Medium folder**: Consider using \`list-emails-delta\` for efficient updates\n`;
  } else {
    text += `- **Small folder**: \`list-emails\` with default pagination is efficient\n`;
  }

  if (unreadItems > 50) {
    text += `- **Many unread**: Use \`unreadOnly: true\` filter to reduce results\n`;
  }

  return { text, meta };
}

module.exports = handleGetFolderStats;
