/**
 * Delete folder functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { resolveFolder, listChildFolders, WELL_KNOWN } = require('./resolve');
const { buildMailboxPrefix } = require('../utils/mailbox');
const { toolError, authRequiredError } = require('../utils/tool-error');
const { dryRunResult } = require('../utils/safety');

const COUNT_SELECT =
  'id,displayName,childFolderCount,totalItemCount,unreadItemCount';
/** Most subfolders a dry run counts before reporting "at least". */
const PREVIEW_FOLDER_LIMIT = 100;

const LOSS_NOTE =
  "It doesn't go to Deleted Items, and Graph doesn't document a way to restore it (Outlook's \"Recover deleted items\" may work for a limited time, but don't rely on it). Move out anything you need first.";

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Count every subfolder below `root`, and the items in them, breadth-first.
 * Stops after PREVIEW_FOLDER_LIMIT subfolders and flags the count partial.
 */
async function countSubfolders(accessToken, root, mailbox) {
  let subfolders = 0;
  let items = 0;
  let partial = false;
  const queue = root.childFolderCount > 0 ? [root.id] : [];
  while (queue.length > 0) {
    if (subfolders >= PREVIEW_FOLDER_LIMIT) {
      partial = true;
      break;
    }
    const children = await listChildFolders(
      accessToken,
      queue.shift(),
      COUNT_SELECT,
      mailbox
    );
    for (const child of children) {
      subfolders += 1;
      items += child.totalItemCount || 0;
      if (child.childFolderCount > 0) queue.push(child.id);
    }
  }
  return { subfolders, items, partial };
}

/**
 * dryRun preview for delete (#274): the folder, and the items and
 * subfolders that would be lost with it. Reads only.
 */
async function previewDeleteFolder(accessToken, resolved, mailbox) {
  const prefix = buildMailboxPrefix(mailbox);
  const folder = await callGraphAPI(
    accessToken,
    'GET',
    `${prefix}/mailFolders/${resolved.id}`,
    null,
    { $select: COUNT_SELECT }
  );
  const items = folder.totalItemCount || 0;
  const unread = folder.unreadItemCount || 0;
  const below = await countSubfolders(
    accessToken,
    { ...folder, id: resolved.id },
    mailbox
  );
  const where = mailbox ? ` in ${mailbox}` : '';
  const name = `'${resolved.path}'${where}`;

  let summary;
  if (items === 0 && below.subfolders === 0) {
    summary = `Deletes folder ${name}. It's empty: no items or subfolders.`;
  } else {
    const atLeast = below.partial ? 'at least ' : '';
    summary = `Deletes folder ${name} and everything in it: ${plural(items, 'item')}`;
    if (unread > 0) summary += ` (${unread} unread)`;
    if (below.subfolders > 0) {
      summary += `, plus ${atLeast}${plural(below.subfolders, 'subfolder')} holding ${atLeast}${below.items} more ${below.items === 1 ? 'item' : 'items'}`;
    }
    summary += '.';
  }

  return dryRunResult([summary, LOSS_NOTE], {
    action: 'delete',
    folderId: resolved.id,
    path: resolved.path,
    items,
    subfolders: below.subfolders,
    subfolderItems: below.items,
    partial: below.partial,
  });
}

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
  const { folderId, folderName, dryRun = false } = args;
  const sharedMailbox = args.sharedMailbox || args.email || null;
  const prefix = buildMailboxPrefix(sharedMailbox);

  if (!folderId && !folderName) {
    return toolError('Either folderId or folderName is required.');
  }

  // Name/alias guard for the common accidental case.
  if (folderName && WELL_KNOWN[folderName.toLowerCase().trim()]) {
    return toolError(
      `Cannot delete protected folder "${folderName}". Protected folders: Inbox, Drafts, Sent Items, Deleted Items, Junk Email, Archive, Outbox.`
    );
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
      return toolError(resolveError.message);
    }

    // dryRun: say what would be lost; delete nothing.
    if (dryRun) {
      return await previewDeleteFolder(accessToken, resolved, sharedMailbox);
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
      return authRequiredError();
    }
    return toolError(`Error deleting folder: ${error.message}`);
  }
}

module.exports = handleDeleteFolder;
