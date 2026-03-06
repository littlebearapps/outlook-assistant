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
      'Manage mail folders. action=list (default) lists folders. action=create creates a folder. action=move moves emails between folders. action=stats gets folder counts for pagination planning. action=delete removes a folder.',
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
        // create params
        name: {
          type: 'string',
          description: 'Name of the folder to create (action=create, required)',
        },
        parentFolder: {
          type: 'string',
          description: 'Parent folder name, default is root (action=create)',
        },
        // move params
        emailIds: {
          type: 'string',
          description:
            'Comma-separated list of email IDs to move (action=move, required)',
        },
        targetFolder: {
          type: 'string',
          description: 'Folder name to move emails to (action=move, required)',
        },
        sourceFolder: {
          type: 'string',
          description: 'Source folder name, default is inbox (action=move)',
        },
        // stats params
        folder: {
          type: 'string',
          description:
            'Folder name (inbox, sent, drafts, etc.). Default: inbox (action=stats)',
        },
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description: 'Output detail level (action=stats, default: standard)',
        },
        // delete params
        folderId: {
          type: 'string',
          description: 'Folder ID to delete (action=delete)',
        },
        folderName: {
          type: 'string',
          description:
            'Folder name to delete — resolved to ID (action=delete). Cannot delete protected folders (Inbox, Drafts, Sent, etc.)',
        },
      },
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
        default:
          return handleListFolders(args);
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
