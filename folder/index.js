/**
 * Folder management module for Outlook Assistant server
 */
const handleListFolders = require('./list');
const handleCreateFolder = require('./create');
const handleMoveEmails = require('./move');
const handleGetFolderStats = require('./stats');
const handleDeleteFolder = require('./delete');

// Consolidated folder tool definition
const folderTools = [
  {
    name: 'folders',
    description:
      "Manage mail folders (tool-level destructiveHint=true because `delete` permanently removes a folder; `list` and `stats` are read-only sub-actions despite the annotation). Folders can be addressed by name, by a slash-separated PATH for nested folders (e.g. `Triage/Delete`, `Inbox/Clients/Acme`, case-insensitive), or by explicit ID; `list` output includes each folder's full path and `[id: …]`. A bare name resolves a unique top-level folder first, then searches nested folders (ambiguous names return the candidates — disambiguate with a path or ID). action=`list` (default) returns the folder tree (toggle `includeItemCounts` for unread/total, `includeChildren` for hierarchy). action=`create` makes a new folder under the root, or under `parentFolder` (name/path) / `parentFolderId`, and returns its id. action=`move` relocates emails (`emailIds`) into `targetFolder` (name/path) or `targetFolderId`. action=`stats` returns counts (totalItemCount/unreadItemCount) for `folder` (name/path) or `folderId`, suitable for pagination planning. action=`delete` removes a folder (by `folderName`/path or `folderId`) and its contents — on Outlook.com the folder is moved to Deleted Items (recoverable until you empty it); M365/Exchange accounts may hard-delete per retention policy. Every action accepts `sharedMailbox` (alias `email`) to target a shared/delegated mailbox instead of the signed-in account — folder names, paths, and IDs are then resolved inside that mailbox. Protected folders cannot be deleted in any mailbox.",
    annotations: {
      title: 'Mail Folders',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
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
            'Email address of a shared/delegated mailbox to target instead of the signed-in account (all actions). Requires delegate access + Mail.Read.Shared (list/stats) or Mail.ReadWrite.Shared (create/move/delete).',
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
          description: 'Source folder name, default is inbox (action=move)',
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
      },
      additionalProperties: false,
      required: [],
    },
    handler: async (args) => {
      const action = args.action || 'list';
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
          return {
            content: [
              {
                type: 'text',
                text: `Unknown action '${action}'. Valid actions: list, create, move, stats, delete.`,
              },
            ],
          };
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
