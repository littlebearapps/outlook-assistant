/**
 * Email rules management module for Outlook MCP server
 */
const { handleListRules, getInboxRules } = require('./list');
const handleCreateRule = require('./create');
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

/**
 * Edit rule sequence handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleEditRuleSequence(args) {
  const { ruleName, sequence } = args;

  if (!ruleName) {
    return {
      content: [
        {
          type: 'text',
          text: 'Rule name is required. Please specify the exact name of an existing rule.',
        },
      ],
    };
  }

  if (!sequence || isNaN(sequence) || sequence < 1) {
    return {
      content: [
        {
          type: 'text',
          text: 'A positive sequence number is required. Lower numbers run first (higher priority).',
        },
      ],
    };
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Get all rules
    const rules = await getInboxRules(accessToken);

    // Find the rule by name
    const rule = rules.find((r) => r.displayName === ruleName);
    if (!rule) {
      return {
        content: [
          {
            type: 'text',
            text: `Rule with name "${ruleName}" not found.`,
          },
        ],
      };
    }

    // Update the rule sequence
    const _updateResult = await callGraphAPI(
      accessToken,
      'PATCH',
      `me/mailFolders/inbox/messageRules/${rule.id}`,
      {
        sequence: sequence,
      }
    );

    return {
      content: [
        {
          type: 'text',
          text: `Successfully updated the sequence of rule "${ruleName}" to ${sequence}.`,
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
          text: `Error updating rule sequence: ${error.message}`,
        },
      ],
    };
  }
}

// Consolidated rules tool definition
const rulesTools = [
  {
    name: 'manage-rules',
    description:
      'Manage inbox rules. action=list (default) lists rules. action=create creates a new rule. action=reorder changes rule execution priority.',
    annotations: {
      title: 'Inbox Rules',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'reorder'],
          description: 'Action to perform (default: list)',
        },
        // list params
        includeDetails: {
          type: 'boolean',
          description:
            'Include detailed rule conditions and actions (action=list)',
        },
        // create params
        name: {
          type: 'string',
          description: 'Name of the rule to create (action=create, required)',
        },
        fromAddresses: {
          type: 'string',
          description: 'Comma-separated sender email addresses (action=create)',
        },
        containsSubject: {
          type: 'string',
          description: 'Subject text the email must contain (action=create)',
        },
        hasAttachments: {
          type: 'boolean',
          description: 'Apply to emails with attachments (action=create)',
        },
        moveToFolder: {
          type: 'string',
          description: 'Folder to move matching emails to (action=create)',
        },
        markAsRead: {
          type: 'boolean',
          description: 'Mark matching emails as read (action=create)',
        },
        isEnabled: {
          type: 'boolean',
          description:
            'Enable rule after creation, default: true (action=create)',
        },
        sequence: {
          type: 'number',
          description:
            'Execution order, lower numbers run first (action=create default: 100, action=reorder required)',
        },
        // reorder params
        ruleName: {
          type: 'string',
          description: 'Name of the rule to reorder (action=reorder, required)',
        },
      },
      required: [],
    },
    handler: async (args) => {
      const action = args.action || 'list';
      switch (action) {
        case 'create':
          return handleCreateRule(args);
        case 'reorder':
          return handleEditRuleSequence(args);
        case 'list':
        default:
          return handleListRules(args);
      }
    },
  },
];

module.exports = {
  rulesTools,
  handleListRules,
  handleCreateRule,
  handleEditRuleSequence,
};
