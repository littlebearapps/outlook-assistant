/**
 * Create rule functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { checkRateLimit } = require('../utils/safety');
const { formatRuleDryRunPreview } = require('../utils/safety');
const { getInboxRules } = require('./list');
const {
  buildConditions,
  buildActions,
  buildExceptions,
  hasAnyCondition,
  hasAnyAction,
} = require('./rule-builder');

/**
 * Create rule handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleCreateRule(args) {
  const { name, isEnabled = true, sequence, dryRun } = args;

  // Rate limit rule creation
  const rateLimitError = checkRateLimit('manage-rules');
  if (rateLimitError) return rateLimitError;

  // Validate sequence parameter
  if (sequence !== undefined && (isNaN(sequence) || sequence < 1)) {
    return {
      content: [
        {
          type: 'text',
          text: 'Sequence must be a positive number greater than zero.',
        },
      ],
    };
  }

  if (!name) {
    return {
      content: [
        {
          type: 'text',
          text: 'Rule name is required.',
        },
      ],
    };
  }

  if (!hasAnyCondition(args)) {
    return {
      content: [
        {
          type: 'text',
          text: 'At least one condition is required. Available conditions: fromAddresses, containsSubject, bodyContains, bodyOrSubjectContains, senderContains, recipientContains, sentToAddresses, hasAttachments, importance, sensitivity, sentToMe, sentOnlyToMe, sentCcMe, isAutomaticReply.',
        },
      ],
    };
  }

  if (!hasAnyAction(args)) {
    return {
      content: [
        {
          type: 'text',
          text: 'At least one action is required. Available actions: moveToFolder, copyToFolder, markAsRead, markImportance, forwardTo, redirectTo, assignCategories, stopProcessingRules, deleteMessage.',
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Build rule components
    const { conditions, warnings: condWarnings } = buildConditions(args);
    const { actions, warnings: actWarnings } = await buildActions(
      args,
      accessToken
    );
    const { exceptions, warnings: excWarnings } = buildExceptions(args);

    const allWarnings = [...condWarnings, ...actWarnings, ...excWarnings];

    // Check for fatal warnings (folder not found = no valid action)
    const folderNotFound = actWarnings.some((w) => w.includes('not found'));
    if (folderNotFound && Object.keys(actions).length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: actWarnings.filter((w) => w.includes('not found')).join('\n'),
          },
        ],
      };
    }

    // Determine sequence
    let ruleSequence = sequence;
    if (!ruleSequence) {
      ruleSequence = 100;
      try {
        const existingRules = await getInboxRules(accessToken);
        if (existingRules && existingRules.length > 0) {
          const highestSequence = Math.max(
            ...existingRules.map((r) => r.sequence || 0)
          );
          ruleSequence = Math.max(highestSequence + 1, 100);
        }
      } catch (_sequenceError) {
        ruleSequence = 100;
      }
    }
    ruleSequence = Math.max(1, Math.floor(ruleSequence));

    // Build the rule object
    const rule = {
      displayName: name,
      isEnabled: isEnabled === true,
      sequence: ruleSequence,
      conditions,
      actions,
    };

    // Add exceptions if any were specified
    if (Object.keys(exceptions).length > 0) {
      rule.exceptions = exceptions;
    }

    // Dry-run: preview without creating
    if (dryRun) {
      const preview = formatRuleDryRunPreview(rule);
      let text = `DRY RUN — Rule preview (not created):\n\n${preview}`;
      if (allWarnings.length > 0) {
        text += `\n\nWarnings:\n${allWarnings.map((w) => `- ${w}`).join('\n')}`;
      }
      return {
        content: [{ type: 'text', text }],
      };
    }

    // Create the rule
    const response = await callGraphAPI(
      accessToken,
      'POST',
      'me/mailFolders/inbox/messageRules',
      rule
    );

    if (response && response.id) {
      // F-43: include the rule ID. update/delete accept ruleName so this
      // is workable, but ID is more reliable when names contain unicode
      // or duplicates exist.
      let text = `Successfully created rule "${name}" with sequence ${ruleSequence}.\n\n**ID**: ${response.id}`;
      if (allWarnings.length > 0) {
        text += `\n\nNotes:\n${allWarnings.map((w) => `- ${w}`).join('\n')}`;
      }
      if (!sequence) {
        text +=
          "\n\nTip: You can specify a 'sequence' parameter when creating rules to control their execution order. Lower sequence numbers run first.";
      }
      return {
        content: [{ type: 'text', text }],
        _meta: { ruleId: response.id },
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: "Failed to create rule. The server didn't return a rule ID.",
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
          text: `Error creating rule: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = handleCreateRule;
