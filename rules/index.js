/**
 * Email rules management module for Outlook Assistant server
 */
const { handleListRules, getInboxRules } = require('./list');
const handleCreateRule = require('./create');
const handleUpdateRule = require('./update');
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { checkRateLimit } = require('../utils/safety');

/**
 * Delete rule handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleDeleteRule(args) {
  const { ruleName, ruleId } = args;

  // Rate limit
  const rateLimitError = checkRateLimit('manage-rules');
  if (rateLimitError) return rateLimitError;

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
    const accessToken = await ensureAuthenticated();
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

    await callGraphAPI(
      accessToken,
      'PATCH',
      `me/mailFolders/inbox/messageRules/${rule.id}`,
      { sequence }
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
      'Manage inbox rules. action=list (default) lists rules. action=create creates a new rule with conditions, actions, and optional exceptions. action=update modifies an existing rule. action=reorder changes rule execution priority. action=delete removes a rule.',
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
          enum: ['list', 'create', 'update', 'reorder', 'delete'],
          description: 'Action to perform (default: list)',
        },

        // === List params ===
        includeDetails: {
          type: 'boolean',
          description:
            'Include detailed conditions, actions, and exceptions (action=list)',
        },

        // === Create + Update shared params ===
        name: {
          type: 'string',
          description:
            'Rule name (action=create required, action=update to rename)',
        },
        dryRun: {
          type: 'boolean',
          description:
            'Preview rule without creating/updating (action=create, action=update)',
        },
        isEnabled: {
          type: 'boolean',
          description:
            'Enable/disable rule (action=create default: true, action=update)',
        },
        sequence: {
          type: 'number',
          description:
            'Execution order, lower = higher priority (action=create default: auto, action=reorder required)',
        },

        // --- Conditions (comma-separated strings become OR arrays) ---
        fromAddresses: {
          type: 'string',
          description:
            'Comma-separated sender emails to match (action=create/update)',
        },
        containsSubject: {
          type: 'string',
          description:
            'Comma-separated subject keywords (OR logic). e.g. "invoice, receipt, payment" (action=create/update)',
        },
        bodyContains: {
          type: 'string',
          description:
            'Comma-separated body text keywords (OR logic) (action=create/update)',
        },
        bodyOrSubjectContains: {
          type: 'string',
          description:
            'Comma-separated keywords matching body OR subject (OR logic) (action=create/update)',
        },
        senderContains: {
          type: 'string',
          description:
            'Comma-separated partial sender matches (action=create/update)',
        },
        recipientContains: {
          type: 'string',
          description:
            'Comma-separated partial recipient matches (action=create/update)',
        },
        sentToAddresses: {
          type: 'string',
          description:
            'Comma-separated recipient emails to match (action=create/update)',
        },
        hasAttachments: {
          type: 'boolean',
          description: 'Match emails with attachments (action=create/update)',
        },
        importance: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description:
            'Match emails with this importance (action=create/update)',
        },
        sensitivity: {
          type: 'string',
          enum: ['normal', 'personal', 'private', 'confidential'],
          description:
            'Match emails with this sensitivity (action=create/update)',
        },
        sentToMe: {
          type: 'boolean',
          description: 'Match emails sent to me (action=create/update)',
        },
        sentOnlyToMe: {
          type: 'boolean',
          description:
            'Match emails where I am the only recipient (action=create/update)',
        },
        sentCcMe: {
          type: 'boolean',
          description: 'Match emails where I am in CC (action=create/update)',
        },
        isAutomaticReply: {
          type: 'boolean',
          description: 'Match automatic reply emails (action=create/update)',
        },

        // --- Actions ---
        moveToFolder: {
          type: 'string',
          description:
            'Folder name to move matching emails to (action=create/update)',
        },
        copyToFolder: {
          type: 'string',
          description:
            'Folder name to copy matching emails to (action=create/update)',
        },
        markAsRead: {
          type: 'boolean',
          description: 'Mark matching emails as read (action=create/update)',
        },
        markImportance: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description:
            'Set importance on matching emails (action=create/update)',
        },
        forwardTo: {
          type: 'string',
          description:
            'Comma-separated emails to forward matching messages to (action=create/update)',
        },
        redirectTo: {
          type: 'string',
          description:
            'Comma-separated emails to redirect matching messages to (action=create/update)',
        },
        assignCategories: {
          type: 'string',
          description:
            'Comma-separated Outlook categories to assign (action=create/update)',
        },
        stopProcessingRules: {
          type: 'boolean',
          description:
            'Stop evaluating subsequent rules (action=create/update)',
        },
        deleteMessage: {
          type: 'boolean',
          description:
            'Move matching emails to Deleted Items (action=create/update)',
        },

        // --- Exceptions (rule skipped when these match) ---
        exceptFromAddresses: {
          type: 'string',
          description:
            'Comma-separated sender emails to exclude (action=create/update)',
        },
        exceptSubjectContains: {
          type: 'string',
          description:
            'Comma-separated subject keywords to exclude (action=create/update)',
        },
        exceptSenderContains: {
          type: 'string',
          description:
            'Comma-separated partial sender matches to exclude (action=create/update)',
        },
        exceptBodyContains: {
          type: 'string',
          description:
            'Comma-separated body keywords to exclude (action=create/update)',
        },
        exceptHasAttachments: {
          type: 'boolean',
          description: 'Exclude emails with attachments (action=create/update)',
        },

        // === Update + Reorder + Delete params ===
        ruleName: {
          type: 'string',
          description: 'Name of existing rule (action=update/reorder/delete)',
        },
        ruleId: {
          type: 'string',
          description: 'ID of existing rule (action=update/delete)',
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: async (args) => {
      const action = args.action || 'list';
      switch (action) {
        case 'create':
          return handleCreateRule(args);
        case 'update':
          return handleUpdateRule(args);
        case 'reorder':
          return handleEditRuleSequence(args);
        case 'delete':
          return handleDeleteRule(args);
        case 'list':
          return handleListRules(args);
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown action '${action}'. Valid actions: list, create, update, reorder, delete.`,
              },
            ],
          };
      }
    },
  },
];

module.exports = {
  rulesTools,
  handleListRules,
  handleCreateRule,
  handleUpdateRule,
  handleEditRuleSequence,
  handleDeleteRule,
};
