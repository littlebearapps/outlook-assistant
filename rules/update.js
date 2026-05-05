/**
 * Update rule functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { checkRateLimit, formatRuleDryRunPreview } = require('../utils/safety');
const { getInboxRules } = require('./list');
const {
  buildConditions,
  buildActions,
  buildExceptions,
} = require('./rule-builder');

/**
 * Update rule handler — modify an existing rule by name or ID.
 * Conditions, actions, and exceptions use replace semantics (not merge).
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleUpdateRule(args) {
  const { ruleName, ruleId, name, isEnabled, sequence, dryRun } = args;

  // Rate limit
  const rateLimitError = checkRateLimit('manage-rules');
  if (rateLimitError) return rateLimitError;

  if (!ruleName && !ruleId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Either ruleName or ruleId is required to identify the rule to update.',
        },
      ],
    };
  }

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

  try {
    const accessToken = await ensureAuthenticated();

    // Resolve rule ID
    let resolvedId = ruleId;
    let currentRule = null;

    const rules = await getInboxRules(accessToken);

    if (resolvedId) {
      currentRule = rules.find((r) => r.id === resolvedId);
    } else {
      currentRule = rules.find((r) => r.displayName === ruleName);
      if (currentRule) resolvedId = currentRule.id;
    }

    if (!currentRule) {
      return {
        content: [
          {
            type: 'text',
            text: `Rule "${ruleName || ruleId}" not found.`,
          },
        ],
      };
    }

    // Build PATCH payload — only include fields the user provided
    const patch = {};
    const allWarnings = [];

    if (name) patch.displayName = name;
    if (isEnabled !== undefined) patch.isEnabled = isEnabled;
    if (sequence) patch.sequence = Math.max(1, Math.floor(sequence));

    // Build conditions if any condition param was provided
    const { conditions, warnings: condWarnings } = buildConditions(args);
    if (Object.keys(conditions).length > 0) {
      patch.conditions = conditions;
      allWarnings.push(
        'Conditions replaced (not merged). Use dryRun=true to preview before updating.'
      );
    }
    allWarnings.push(...condWarnings);

    // Build actions if any action param was provided
    const { actions, warnings: actWarnings } = await buildActions(
      args,
      accessToken
    );
    if (Object.keys(actions).length > 0) {
      patch.actions = actions;
      allWarnings.push(
        'Actions replaced (not merged). Use dryRun=true to preview before updating.'
      );
    }
    allWarnings.push(...actWarnings);

    // Check for fatal folder-not-found
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

    // Build exceptions if any except* param was provided
    const { exceptions, warnings: excWarnings } = buildExceptions(args);
    if (Object.keys(exceptions).length > 0) {
      patch.exceptions = exceptions;
    }
    allWarnings.push(...excWarnings);

    // Check that something is actually being changed
    if (Object.keys(patch).length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No changes specified for rule "${currentRule.displayName}". Provide at least one parameter to update (name, isEnabled, sequence, conditions, actions, or exceptions).`,
          },
        ],
      };
    }

    // Dry-run: show before/after preview
    if (dryRun) {
      const updatedRule = { ...currentRule, ...patch };
      const currentPreview = formatRuleDryRunPreview(currentRule);
      const updatedPreview = formatRuleDryRunPreview(updatedRule);

      let text = `DRY RUN — Update preview for "${currentRule.displayName}" (not applied):\n\n`;
      text += `CURRENT:\n${currentPreview}\n\n`;
      text += `AFTER UPDATE:\n${updatedPreview}`;
      if (allWarnings.length > 0) {
        text += `\n\nWarnings:\n${allWarnings.map((w) => `- ${w}`).join('\n')}`;
      }
      return {
        content: [{ type: 'text', text }],
      };
    }

    // Execute PATCH
    await callGraphAPI(
      accessToken,
      'PATCH',
      `me/mailFolders/inbox/messageRules/${resolvedId}`,
      patch
    );

    const changedFields = Object.keys(patch)
      .map((k) => {
        if (k === 'displayName') {
          return `name: "${currentRule.displayName}" → "${patch.displayName}"`;
        }
        if (k === 'isEnabled') {
          // Show explicit before/after to remove the F-45 ambiguity:
          // previously rendered as bare "enabled"/"disabled" with no
          // indication of direction, so callers couldn't tell whether
          // the rule was enabled or whether the action just succeeded.
          return `isEnabled: ${currentRule.isEnabled} → ${patch.isEnabled}`;
        }
        if (k === 'sequence') {
          return `sequence: ${currentRule.sequence} → ${patch.sequence}`;
        }
        if (k === 'conditions') return 'conditions updated';
        if (k === 'actions') return 'actions updated';
        if (k === 'exceptions') return 'exceptions updated';
        return k;
      })
      .join(', ');

    let text = `Successfully updated rule "${currentRule.displayName}": ${changedFields}.`;
    // Filter out the replace/merge info warnings from the response since the update is done
    const relevantWarnings = allWarnings.filter(
      (w) => !w.includes('replaced (not merged)')
    );
    if (relevantWarnings.length > 0) {
      text += `\n\nNotes:\n${relevantWarnings.map((w) => `- ${w}`).join('\n')}`;
    }

    return {
      content: [{ type: 'text', text }],
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
          text: `Error updating rule: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = handleUpdateRule;
