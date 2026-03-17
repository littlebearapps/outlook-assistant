/**
 * Mail tips functionality — pre-send validation via Graph API
 *
 * Checks recipients for out-of-office, mailbox full, external,
 * delivery restrictions, and more before sending.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

/**
 * All available mail tip types from Microsoft Graph API
 */
const MAIL_TIP_TYPES = [
  'automaticReplies',
  'mailboxFullStatus',
  'customMailTip',
  'externalMemberCount',
  'totalMemberCount',
  'maxMessageSize',
  'deliveryRestriction',
  'moderationStatus',
  'recipientScope',
  'recipientSuggestions',
];

/**
 * Format mail tips into readable markdown
 * @param {Array} mailTips - Array of mail tip objects from Graph API
 * @returns {string} - Formatted markdown output
 */
function formatMailTips(mailTips) {
  const lines = [];
  let warningCount = 0;

  for (const tip of mailTips) {
    const email = tip.emailAddress?.address || 'Unknown';
    const tipLines = [];
    const warnings = [];

    // Out-of-office / automatic replies
    if (
      tip.automaticReplies?.message &&
      tip.automaticReplies.message.trim() !== ''
    ) {
      warnings.push('Out of Office');
      const reply = tip.automaticReplies;
      tipLines.push(
        `  **Out of Office**: ${reply.message.replace(/\n/g, ' ').substring(0, 200)}`
      );
      if (reply.scheduledStartTime || reply.scheduledEndTime) {
        const start = reply.scheduledStartTime?.dateTime || '';
        const end = reply.scheduledEndTime?.dateTime || '';
        if (start || end) {
          tipLines.push(`  *Schedule*: ${start} → ${end}`);
        }
      }
    }

    // Mailbox full
    if (tip.mailboxFullStatus) {
      warnings.push('Mailbox Full');
      tipLines.push(
        `  **Mailbox Full**: Recipient's mailbox is full — delivery may fail`
      );
    }

    // Custom mail tip (admin-configured)
    if (tip.customMailTip) {
      warnings.push('Custom Tip');
      tipLines.push(`  **Notice**: ${tip.customMailTip}`);
    }

    // Delivery restriction
    if (tip.deliveryRestriction) {
      const restriction = tip.deliveryRestriction;
      if (restriction.isDeliveryRestricted) {
        warnings.push('Delivery Restricted');
        tipLines.push(
          `  **Delivery Restricted**: ${restriction.message || 'Cannot deliver to this recipient'}`
        );
      }
    }

    // Moderation status
    if (tip.moderationStatus && tip.moderationStatus !== 'notModerated') {
      warnings.push('Moderated');
      tipLines.push(
        `  **Moderated**: Messages to this recipient require approval`
      );
    }

    // Recipient scope (external)
    if (tip.recipientScope === 'external') {
      tipLines.push(`  **External**: Recipient is outside your organisation`);
    }

    // Max message size
    if (tip.maxMessageSize && tip.maxMessageSize > 0) {
      const sizeMB = (tip.maxMessageSize / (1024 * 1024)).toFixed(1);
      tipLines.push(`  *Max message size*: ${sizeMB} MB`);
    }

    // Group member counts
    if (tip.totalMemberCount > 0) {
      tipLines.push(
        `  *Group members*: ${tip.totalMemberCount} total (${tip.externalMemberCount || 0} external)`
      );
    }

    // Build section for this recipient
    const statusIcon = warnings.length > 0 ? '⚠' : '✓';
    lines.push(`### ${statusIcon} ${email}`);

    if (warnings.length > 0) {
      lines.push(`**Warnings**: ${warnings.join(', ')}`);
      warningCount += warnings.length;
    }

    if (tipLines.length > 0) {
      lines.push(tipLines.join('\n'));
    } else {
      lines.push('  No issues detected');
    }
    lines.push('');
  }

  return { formatted: lines.join('\n'), warningCount };
}

/**
 * Get mail tips for specified recipients
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleGetMailTips(args) {
  const { recipients, tipTypes } = args;

  if (!recipients || recipients.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'At least one recipient email address is required.',
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    const requestBody = {
      EmailAddresses: Array.isArray(recipients)
        ? recipients
        : recipients.split(',').map((e) => e.trim()),
      MailTipsOptions: tipTypes || MAIL_TIP_TYPES.join(','),
    };

    const response = await callGraphAPI(
      accessToken,
      'POST',
      'me/getMailTips',
      requestBody
    );

    const mailTips = response.value || [];

    if (mailTips.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No mail tips returned for the specified recipients.',
          },
        ],
      };
    }

    const { formatted, warningCount } = formatMailTips(mailTips);

    let header = `# Mail Tips\n\n`;
    header += `**Recipients checked**: ${mailTips.length}\n`;
    header += `**Warnings**: ${warningCount}\n\n`;

    return {
      content: [{ type: 'text', text: header + formatted }],
      _meta: {
        recipientCount: mailTips.length,
        warningCount,
      },
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
        { type: 'text', text: `Error getting mail tips: ${error.message}` },
      ],
    };
  }
}

module.exports = { handleGetMailTips, formatMailTips, MAIL_TIP_TYPES };
