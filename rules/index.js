/**
 * Email rules management module for Outlook Assistant server
 */
const { handleListRules, getInboxRules } = require('./list');
const handleCreateRule = require('./create');
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

/**
 * Delete rule handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleDeleteRule(args) {
  const { ruleName, ruleId } = args;

  if (!ruleName && !ruleId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Either ruleName or ruleId is required.',
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    let resolvedId = ruleId;
    let displayName = ruleId;

    // Resolve name to ID if needed
    if (!resolvedId && ruleName) {
      const rules = await getInboxRules(accessToken);
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
      resolvedId = rule.id;
      displayName = ruleName;
    }

    await callGraphAPI(
      accessToken,
      'DELETE',
      `me/mailFolders/inbox/messageRules/${resolvedId}`
    );

    return {
      content: [
        {
          type: 'text',
          text: `Successfully deleted rule "${displayName}".`,
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
          text: `Error deleting rule: ${error.message}`,
        },
      ],
    };
  }
}

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
      'Manage inbox rules. action=list (default) lists rules. action=create creates a new rule. action=reorder changes rule execution priority. action=delete removes a rule.',
    annotations: {
      title: 'Inbox Rules',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'reorder', 'delete'],
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
          description:
            'Name of the rule (action=reorder required, action=delete alternative to ruleId)',
        },
        ruleId: {
          type: 'string',
          description: 'ID of the rule to delete (action=delete)',
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
        case 'delete':
          return handleDeleteRule(args);
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
  handleDeleteRule,
};
