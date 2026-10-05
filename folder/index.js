/**
 * Folder management module for Outlook Assistant server
 */
const handleListFolders = require('./list');
const handleCreateFolder = require('./create');
const handleMoveEmails = require('./move');
const handleGetFolderStats = require('./stats');
const handleDeleteFolder = require('./delete');
const { toolMetadata } = require('../utils/risk-classes');
const { toolError } = require('../utils/tool-error');
const { dryRunUnsupported } = require('../utils/safety');

// Consolidated folder tool definition
const folderTools = [
  {
    name: 'folders',
    description:
      "Manage mail folders. Address a folder by name, by slash-separated path for nested folders (e.g. `Inbox/Clients/Acme`, case-insensitive) or by ID; a bare name matches a unique top-level folder first, then nested ones (an ambiguous name returns the candidates). action=`list` (default) returns the tree with each folder's path and id (`includeItemCounts`, `includeChildren`). action=`create` makes `name` under the root or `parentFolder`/`parentFolderId`. action=`move` moves `emailIds` into `targetFolder`/`targetFolderId`. action=`stats` returns total/unread counts for `folder` or `folderId`. action=`delete` removes a folder (`folderName`/path or `folderId`) with everything in it, subfolders included. It skips Deleted Items and Graph documents no restore path, so pass `dryRun: true` first to see what would be lost. Protected folders (Inbox, Sent Items, etc.) can't be deleted. Every action accepts `sharedMailbox` (alias `email`) to work in a shared or delegated mailbox (default: your own).",
    ...toolMetadata('folders', 'Mail Folders'),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'move', 'stats', 'delete'],
          description: 'Action to perform (default: list)',
        },
        // list params
        includeItemCounts: {
          type: 'boolean',
          description: 'Include counts of total and unread items (action=list)',
        },
        includeChildren: {
          type: 'boolean',
          description: 'Include child folders in hierarchy (action=list)',
        },
        // shared-mailbox scoping (all actions)
        sharedMailbox: {
          type: 'string',
          description:
            'Email address of a shared/delegated mailbox to target (all actions; default: the signed-in account). Requires delegate access + Mail.Read.Shared (list/stats) or Mail.ReadWrite.Shared (create/move/delete). Work/school only; needs the server opt-in setting OUTLOOK_SHARED_MAILBOX (otherwise the call is refused with setup guidance).',
        },
        email: {
          type: 'string',
          description: 'Alias for `sharedMailbox`.',
        },
        // create params
        name: {
          type: 'string',
          description: 'Name of the folder to create (action=create, required)',
        },
        parentFolder: {
          type: 'string',
          description:
            'Parent folder name or path (e.g. "Clients/Acme"); default is root (action=create)',
        },
        parentFolderId: {
          type: 'string',
          description:
            'Parent folder ID — alternative to parentFolder for unambiguous targeting (action=create)',
        },
        // move params
        emailIds: {
          type: 'string',
          description:
            'Comma-separated list of email IDs to move (action=move, required)',
        },
        targetFolder: {
          type: 'string',
          description:
            'Destination folder name or path, e.g. "Triage/Delete" (action=move; or use targetFolderId)',
        },
        targetFolderId: {
          type: 'string',
          description:
            'Destination folder ID — alternative to targetFolder for unambiguous/nested targeting (action=move)',
        },
        sourceFolder: {
          type: 'string',
          description:
            'Ignored: action=move moves each email by ID from wherever it is. Accepted for older callers.',
        },
        // stats params
        folder: {
          type: 'string',
          description:
            'Folder name or path (inbox, sent, "Triage/Delete", etc.). Default: inbox (action=stats)',
        },
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description: 'Output detail level (action=stats, default: standard)',
        },
        // delete/stats params
        folderId: {
          type: 'string',
          description: 'Folder ID (action=stats/delete)',
        },
        folderName: {
          type: 'string',
          description:
            'Folder name or path to delete — resolved to ID (action=delete). Cannot delete protected folders (Inbox, Drafts, Sent, etc.)',
        },
        dryRun: {
          type: 'boolean',
          description:
            'Preview only (action=delete): nothing is deleted. Shows the folder and how many items and subfolders would be lost. Other actions refuse dryRun and change nothing. Default false.',
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: async (args) => {
      const action = args.action || 'list';
      if (args.dryRun && action !== 'delete') {
        return dryRunUnsupported('folders', action, 'delete');
      }
      switch (action) {
        case 'create':
          return handleCreateFolder(args);
        case 'move':
          return handleMoveEmails(args);
        case 'stats':
          return handleGetFolderStats(args);
        case 'delete':
          return handleDeleteFolder(args);
        case 'list':
          return handleListFolders(args);
        default:
          return toolError(
            `Unknown action '${action}'. Valid actions: list, create, move, stats, delete.`
          );
      }
    },
  },
];

module.exports = {
  folderTools,
  handleListFolders,
  handleCreateFolder,
  handleMoveEmails,
  handleGetFolderStats,
  handleDeleteFolder,
};
