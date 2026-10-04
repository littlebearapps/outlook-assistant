/**
 * List rules functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { toolError, authRequiredError } = require('../utils/tool-error');

/**
 * List rules handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleListRules(args) {
  const includeDetails = args.includeDetails === true;

  try {
    const accessToken = await ensureAuthenticated();
    const rules = await getInboxRules(accessToken);
    const formattedRules = formatRulesList(rules, includeDetails);

    return {
      content: [
        {
          type: 'text',
          text: formattedRules,
        },
      ],
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    return toolError(`Error listing rules: ${error.message}`);
  }
}

/**
 * Get all inbox rules
 * @param {string} accessToken - Access token
 * @returns {Promise<Array>} - Array of rule objects
 */
async function getInboxRules(accessToken) {
  try {
    const response = await callGraphAPI(
      accessToken,
      'GET',
      'me/mailFolders/inbox/messageRules',
      null
    );

    return response.value || [];
  } catch (error) {
    console.error(`Error getting inbox rules: ${error.message}`);
    throw error;
  }
}

/**
 * Format rules list for display
 * @param {Array} rules - Array of rule objects
 * @param {boolean} includeDetails - Whether to include detailed conditions and actions
 * @returns {string} - Formatted rules list
 */
function formatRulesList(rules, includeDetails) {
  if (!rules || rules.length === 0) {
    return 'No inbox rules found.\n\nTip: You can create rules using manage-rules with action=create. Rules are processed in order of their sequence number (lower numbers are processed first).';
  }

  const sortedRules = [...rules].sort((a, b) => {
    return (a.sequence || 9999) - (b.sequence || 9999);
  });

  if (includeDetails) {
    const detailedRules = sortedRules.map((rule) => {
      let ruleText = `[${rule.sequence || 'N/A'}] ${rule.displayName}${rule.isEnabled ? '' : ' (Disabled)'}`;

      const conditions = formatRuleConditions(rule);
      if (conditions) {
        ruleText += `\n   Conditions: ${conditions}`;
      }

      const actions = formatRuleActions(rule);
      if (actions) {
        ruleText += `\n   Actions: ${actions}`;
      }

      const exceptions = formatRuleExceptions(rule);
      if (exceptions) {
        ruleText += `\n   Exceptions: ${exceptions}`;
      }

      return ruleText;
    });

    return `Found ${rules.length} inbox rules (sorted by execution order):\n\n${detailedRules.join('\n\n')}\n\nRules are processed in order of their sequence number. You can change rule order using manage-rules with action=reorder.`;
  }

  const simpleRules = sortedRules.map((rule) => {
    return `[${rule.sequence || 'N/A'}] ${rule.displayName}${rule.isEnabled ? '' : ' (Disabled)'}`;
  });

  return `Found ${rules.length} inbox rules (sorted by execution order):\n\n${simpleRules.join('\n')}\n\nTip: Use manage-rules with includeDetails=true to see conditions, actions, and exceptions for each rule.`;
}

/**
 * Format rule conditions for display
 * @param {object} rule - Rule object
 * @returns {string} - Formatted conditions
 */
function formatRuleConditions(rule) {
  const conditions = [];
  const c = rule.conditions;
  if (!c) return '';

  // Recipient-based
  if (c.fromAddresses?.length > 0) {
    const senders = c.fromAddresses
      .map((addr) => addr.emailAddress?.address)
      .join(', ');
    conditions.push(`From: ${senders}`);
  }
  if (c.sentToAddresses?.length > 0) {
    const recipients = c.sentToAddresses
      .map((addr) => addr.emailAddress?.address)
      .join(', ');
    conditions.push(`Sent to: ${recipients}`);
  }

  // String collections
  if (c.subjectContains?.length > 0) {
    conditions.push(`Subject contains: "${c.subjectContains.join('", "')}"`);
  }
  if (c.bodyContains?.length > 0) {
    conditions.push(`Body contains: "${c.bodyContains.join('", "')}"`);
  }
  if (c.bodyOrSubjectContains?.length > 0) {
    conditions.push(
      `Body/subject contains: "${c.bodyOrSubjectContains.join('", "')}"`
    );
  }
  if (c.senderContains?.length > 0) {
    conditions.push(`Sender contains: "${c.senderContains.join('", "')}"`);
  }
  if (c.recipientContains?.length > 0) {
    conditions.push(
      `Recipient contains: "${c.recipientContains.join('", "')}"`
    );
  }
  if (c.headerContains?.length > 0) {
    conditions.push(`Header contains: "${c.headerContains.join('", "')}"`);
  }

  // Booleans
  if (c.hasAttachment === true) conditions.push('Has attachment');
  if (c.sentToMe === true) conditions.push('Sent to me');
  if (c.sentOnlyToMe === true) conditions.push('Sent only to me');
  if (c.sentCcMe === true) conditions.push('I am in CC');
  if (c.sentToOrCcMe === true) conditions.push('Sent to me or CC');
  if (c.isAutomaticReply === true) conditions.push('Is automatic reply');
  if (c.isAutomaticForward === true) conditions.push('Is automatic forward');
  if (c.isMeetingRequest === true) conditions.push('Is meeting request');
  if (c.isMeetingResponse === true) conditions.push('Is meeting response');
  if (c.isReadReceipt === true) conditions.push('Is read receipt');
  if (c.isEncrypted === true) conditions.push('Is encrypted');
  if (c.notSentToMe === true) conditions.push('Not sent to me');

  // Enums
  if (c.importance) conditions.push(`Importance: ${c.importance}`);
  if (c.sensitivity) conditions.push(`Sensitivity: ${c.sensitivity}`);
  if (c.messageActionFlag) conditions.push(`Flag: ${c.messageActionFlag}`);

  // Categories
  if (c.categories?.length > 0) {
    conditions.push(`Categories: ${c.categories.join(', ')}`);
  }

  // Size range
  if (c.withinSizeRange) {
    const min = c.withinSizeRange.minimumSize || 0;
    const max = c.withinSizeRange.maximumSize || '∞';
    conditions.push(`Size: ${min}–${max} bytes`);
  }

  return conditions.join('; ');
}

/**
 * Format rule actions for display
 * @param {object} rule - Rule object
 * @returns {string} - Formatted actions
 */
function formatRuleActions(rule) {
  const actions = [];
  const a = rule.actions;
  if (!a) return '';

  if (a.moveToFolder) actions.push(`Move to folder: ${a.moveToFolder}`);
  if (a.copyToFolder) actions.push(`Copy to folder: ${a.copyToFolder}`);
  if (a.markAsRead === true) actions.push('Mark as read');
  if (a.markImportance) actions.push(`Mark importance: ${a.markImportance}`);

  if (a.forwardTo?.length > 0) {
    const recipients = a.forwardTo
      .map((r) => r.emailAddress?.address)
      .join(', ');
    actions.push(`Forward to: ${recipients}`);
  }
  if (a.forwardAsAttachmentTo?.length > 0) {
    const recipients = a.forwardAsAttachmentTo
      .map((r) => r.emailAddress?.address)
      .join(', ');
    actions.push(`Forward as attachment to: ${recipients}`);
  }
  if (a.redirectTo?.length > 0) {
    const recipients = a.redirectTo
      .map((r) => r.emailAddress?.address)
      .join(', ');
    actions.push(`Redirect to: ${recipients}`);
  }

  if (a.assignCategories?.length > 0) {
    actions.push(`Assign categories: ${a.assignCategories.join(', ')}`);
  }
  if (a.stopProcessingRules === true) actions.push('Stop processing rules');
  if (a.delete === true) actions.push('Delete (move to Deleted Items)');
  if (a.permanentDelete === true) actions.push('Permanently delete');

  return actions.join('; ');
}

/**
 * Format rule exceptions for display
 * @param {object} rule - Rule object
 * @returns {string} - Formatted exceptions
 */
function formatRuleExceptions(rule) {
  const parts = [];
  const e = rule.exceptions;
  if (!e) return '';

  if (e.fromAddresses?.length > 0) {
    const senders = e.fromAddresses
      .map((addr) => addr.emailAddress?.address)
      .join(', ');
    parts.push(`From: ${senders}`);
  }
  if (e.sentToAddresses?.length > 0) {
    const recipients = e.sentToAddresses
      .map((addr) => addr.emailAddress?.address)
      .join(', ');
    parts.push(`Sent to: ${recipients}`);
  }
  if (e.subjectContains?.length > 0) {
    parts.push(`Subject contains: "${e.subjectContains.join('", "')}"`);
  }
  if (e.bodyContains?.length > 0) {
    parts.push(`Body contains: "${e.bodyContains.join('", "')}"`);
  }
  if (e.bodyOrSubjectContains?.length > 0) {
    parts.push(
      `Body/subject contains: "${e.bodyOrSubjectContains.join('", "')}"`
    );
  }
  if (e.senderContains?.length > 0) {
    parts.push(`Sender contains: "${e.senderContains.join('", "')}"`);
  }
  if (e.recipientContains?.length > 0) {
    parts.push(`Recipient contains: "${e.recipientContains.join('", "')}"`);
  }
  if (e.hasAttachment === true) parts.push('Has attachment');
  if (e.importance) parts.push(`Importance: ${e.importance}`);
  if (e.sensitivity) parts.push(`Sensitivity: ${e.sensitivity}`);
  if (e.sentToMe === true) parts.push('Sent to me');
  if (e.sentOnlyToMe === true) parts.push('Sent only to me');
  if (e.sentCcMe === true) parts.push('I am in CC');
  if (e.isAutomaticReply === true) parts.push('Is automatic reply');

  return parts.join('; ');
}

module.exports = {
  handleListRules,
  getInboxRules,
};
