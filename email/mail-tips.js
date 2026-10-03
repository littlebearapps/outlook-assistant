/**
 * Mail tips functionality — pre-send validation via Graph API
 *
 * Checks recipients for out-of-office, mailbox full, external,
 * delivery restrictions, and more before sending.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { toolError, authRequiredError } = require('../utils/tool-error');

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
 *
 * Graph's mailTips resource reports `mailboxFull`, `deliveryRestricted` and
 * `isModerated` as booleans. The older `mailboxFullStatus`,
 * `deliveryRestriction` and `moderationStatus` shapes are still recognised.
 * @param {Array} mailTips - Array of mail tip objects from Graph API
 * @returns {{formatted: string, warningCount: number, issues: Array<{address: string, type: string}>}}
 *   `issues` lists each flagged condition per recipient, with `type` one of
 *   outOfOffice, mailboxFull, customTip, deliveryRestricted, moderated,
 *   external or externalMembers
 */
function formatMailTips(mailTips) {
  const lines = [];
  const issues = [];
  let warningCount = 0;

  for (const tip of mailTips) {
    const email = tip.emailAddress?.address || 'Unknown';
    const tipLines = [];
    const warnings = [];
    const flag = (type) => issues.push({ address: email, type });

    // Out-of-office / automatic replies
    if (
      tip.automaticReplies?.message &&
      tip.automaticReplies.message.trim() !== ''
    ) {
      warnings.push('Out of Office');
      flag('outOfOffice');
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
    if (tip.mailboxFull === true || tip.mailboxFullStatus === true) {
      warnings.push('Mailbox Full');
      flag('mailboxFull');
      tipLines.push(
        `  **Mailbox Full**: Recipient's mailbox is full — delivery may fail`
      );
    }

    // Custom mail tip (admin-configured)
    if (tip.customMailTip) {
      warnings.push('Custom Tip');
      flag('customTip');
      tipLines.push(`  **Notice**: ${tip.customMailTip}`);
    }

    // Delivery restriction
    if (
      tip.deliveryRestricted === true ||
      tip.deliveryRestriction?.isDeliveryRestricted
    ) {
      warnings.push('Delivery Restricted');
      flag('deliveryRestricted');
      tipLines.push(
        `  **Delivery Restricted**: ${tip.deliveryRestriction?.message || 'Cannot deliver to this recipient'}`
      );
    }

    // Moderation status
    if (
      tip.isModerated === true ||
      (tip.moderationStatus && tip.moderationStatus !== 'notModerated')
    ) {
      warnings.push('Moderated');
      flag('moderated');
      tipLines.push(
        `  **Moderated**: Messages to this recipient require approval`
      );
    }

    // Recipient scope: external, externalPartner or externalNonPartner
    if (/^external/i.test(tip.recipientScope || '')) {
      flag('external');
      tipLines.push(`  **External**: Recipient is outside your organisation`);
    }

    // Max message size
    if (tip.maxMessageSize && tip.maxMessageSize > 0) {
      const sizeMB = (tip.maxMessageSize / (1024 * 1024)).toFixed(1);
      tipLines.push(`  *Max message size*: ${sizeMB} MB`);
    }

    // Group member counts
    if (tip.externalMemberCount > 0) flag('externalMembers');
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

  return { formatted: lines.join('\n'), warningCount, issues };
}

/**
 * Get mail tips for specified recipients
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleGetMailTips(args) {
  const { recipients, tipTypes } = args;

  if (!recipients || recipients.length === 0) {
    return toolError('At least one recipient email address is required.');
  }

  // Normalise recipients to a clean array of email strings
  let recipientList;
  if (Array.isArray(recipients)) {
    recipientList = recipients.map((e) => String(e).trim());
  } else if (typeof recipients === 'string') {
    // Handle JSON array strings like '["a@b.com","c@d.com"]' from MCP clients
    const trimmed = recipients.trim();
    if (trimmed.startsWith('[')) {
      try {
        recipientList = JSON.parse(trimmed).map((e) => String(e).trim());
      } catch (_e) {
        // Fall through to comma-split
      }
    }
    if (!recipientList) {
      recipientList = trimmed.split(',').map((e) => e.trim());
    }
  } else {
    recipientList = [String(recipients).trim()];
  }

  // Filter out empty strings
  recipientList = recipientList.filter((e) => e.length > 0);

  if (recipientList.length === 0) {
    return toolError('At least one valid recipient email address is required.');
  }

  try {
    const accessToken = await ensureAuthenticated();

    const requestBody = {
      EmailAddresses: recipientList,
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
            text: 'No mail tips returned. Mail Tips is M365-only — personal Outlook.com accounts return empty responses, so recipient validation is unavailable on this account.',
          },
        ],
        _meta: {
          recipientCount: 0,
          warningCount: 0,
          allEmpty: true,
          issues: [],
        },
      };
    }

    const { formatted, warningCount, issues } = formatMailTips(mailTips);

    // F-23: Detect a "fully empty" tips response — every recipient
    // returned with no actionable fields. Personal Outlook.com
    // accounts surface this as a successful empty response rather
    // than a feature-unsupported error, leading to false confidence
    // when callers see "No issues detected".
    const allEmpty = mailTips.every((tip) => {
      const hasContent =
        tip.recipientNotFound ||
        tip.mailboxFull ||
        tip.deliveryRestricted ||
        tip.isModerated ||
        tip.automaticReplies?.message ||
        tip.maxMessageSize ||
        tip.totalMemberCount ||
        tip.customMailTip;
      return !hasContent;
    });

    let header = `# Mail Tips\n\n`;
    header += `**Recipients checked**: ${mailTips.length}\n`;
    header += `**Warnings**: ${warningCount}\n`;
    if (allEmpty && warningCount === 0) {
      header +=
        '\n**Note**: Graph returned no actionable mail tips for any recipient. This usually means Mail Tips is not supported on the connected account (M365-only feature) — "No issues detected" below means "no warnings flagged by Graph", NOT "validated as deliverable".\n';
    }
    header += '\n';

    return {
      content: [{ type: 'text', text: header + formatted }],
      _meta: {
        recipientCount: mailTips.length,
        warningCount,
        allEmpty,
        issues,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }
    return toolError(`Error getting mail tips: ${error.message}`);
  }
}

module.exports = { handleGetMailTips, formatMailTips, MAIL_TIP_TYPES };
