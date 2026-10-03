/**
 * Send email functionality
 */
const _config = require('../config'); // Reserved for future use
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const {
  checkRateLimit,
  checkRecipientAllowlist,
  formatDryRunPreview,
} = require('../utils/safety');
const { handleGetMailTips } = require('./mail-tips');
const { toolError, authRequiredError } = require('../utils/tool-error');

/**
 * Mail-tip issues that stop a send until the caller passes
 * `acknowledgeWarnings: true` (#272). Custom tips and moderation are
 * returned with the result but do not block.
 */
const BLOCKING_TIP_LABELS = {
  outOfOffice: 'out of office',
  mailboxFull: 'mailbox full',
  deliveryRestricted: 'delivery restricted',
  external: 'external recipient',
  externalMembers: 'group with external members',
};

const DELIVERY_CAVEAT =
  'Mail tips are M365-only: personal Outlook.com accounts return none, and no warnings is not proof the email will be delivered.';

/**
 * One line per blocking issue, e.g. "- a@b.com: mailbox full".
 * @param {Array<{address: string, type: string}>} issues
 * @returns {string}
 */
function formatBlockingIssues(issues) {
  return issues
    .map((issue) => `- ${issue.address}: ${BLOCKING_TIP_LABELS[issue.type]}`)
    .join('\n');
}

/**
 * Send email handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleSendEmail(args) {
  const {
    to,
    cc,
    bcc,
    subject,
    body,
    importance = 'normal',
    saveToSentItems = true,
    dryRun = false,
    checkRecipients = false,
    acknowledgeWarnings = false,
  } = args;

  // Validate required parameters
  if (!to) {
    return toolError('Recipient (to) is required.');
  }

  if (!subject) {
    return toolError('Subject is required.');
  }

  if (!body) {
    return toolError('Body content is required.');
  }

  try {
    // Format recipients
    const toRecipients = to.split(',').map((email) => {
      email = email.trim();
      return {
        emailAddress: {
          address: email,
        },
      };
    });

    const ccRecipients = cc
      ? cc.split(',').map((email) => {
          email = email.trim();
          return {
            emailAddress: {
              address: email,
            },
          };
        })
      : [];

    const bccRecipients = bcc
      ? bcc.split(',').map((email) => {
          email = email.trim();
          return {
            emailAddress: {
              address: email,
            },
          };
        })
      : [];

    // Check recipient allowlist (all recipients combined)
    const allRecipients = [...toRecipients, ...ccRecipients, ...bccRecipients];
    const allowlistError = checkRecipientAllowlist(allRecipients);
    if (allowlistError) return allowlistError;

    // Prepare email object (needed by both dryRun and actual send)
    const emailObject = {
      message: {
        subject,
        body: {
          contentType:
            /<(html|div|p|h[1-6]|br|table|ul|ol|li|span|a\s|img|strong|em|b|i)\b/i.test(
              body
            )
              ? 'html'
              : 'text',
          content: body,
        },
        toRecipients,
        ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
        bccRecipients: bccRecipients.length > 0 ? bccRecipients : undefined,
        importance,
      },
      saveToSentItems,
    };

    // Pre-send mail tips check. The tips are kept out of emailObject: only
    // Graph message properties may go in the sendMail payload (#272).
    let mailTips = null;
    if (checkRecipients) {
      const allAddresses = allRecipients.map((r) => r.emailAddress.address);
      const tipsResult = await handleGetMailTips({
        recipients: allAddresses,
      });

      const tipsText = tipsResult.content[0]?.text || '';
      const blocking = (tipsResult._meta?.issues || []).filter(
        (issue) => BLOCKING_TIP_LABELS[issue.type]
      );

      // In dry-run mode, always include mail tips in the preview
      if (dryRun) {
        const preview = formatDryRunPreview(emailObject);
        const refusalNote =
          blocking.length > 0 && !acknowledgeWarnings
            ? `\n\nNote: a real send would be refused until acknowledgeWarnings: true is passed, because of:\n${formatBlockingIssues(blocking)}`
            : '';
        return {
          content: [
            {
              type: 'text',
              text: `${tipsText}\n\n---\n\n${preview.content[0].text}${refusalNote}`,
            },
          ],
          _meta: { mailTips: tipsResult._meta },
        };
      }

      // The caller asked for a check, so a failed check stops the send.
      if (tipsResult.isError) {
        return toolError(
          `Email not sent: the recipient check failed.\n\n${tipsText}`,
          tipsText.includes('Next step:')
            ? {}
            : {
                nextStep:
                  'Retry the call, or call send-email without checkRecipients to send without the check.',
              }
        );
      }

      if (blocking.length > 0 && !acknowledgeWarnings) {
        return toolError(
          `Email not sent: the recipient check flagged ${blocking.length} issue(s):\n${formatBlockingIssues(blocking)}\n\n${tipsText}`,
          {
            nextStep:
              'Show these warnings to the user. If they still want to send, call send-email again with the same arguments plus acknowledgeWarnings: true; otherwise change the recipients.',
          }
        );
      }

      mailTips = { text: tipsText, meta: tipsResult._meta, blocking };
    }

    // Dry-run mode: return preview without sending
    if (dryRun) {
      return formatDryRunPreview(emailObject);
    }

    // Check rate limit (only for actual sends, not dry runs)
    const rateLimitError = checkRateLimit('send-email');
    if (rateLimitError) return rateLimitError;

    // Get access token
    const accessToken = await ensureAuthenticated();

    // Make API call to send email
    await callGraphAPI(accessToken, 'POST', 'me/sendMail', emailObject);

    const sentText = `Email sent successfully!\n\nSubject: ${subject}\nRecipients: ${toRecipients.length}${ccRecipients.length > 0 ? ` + ${ccRecipients.length} CC` : ''}${bccRecipients.length > 0 ? ` + ${bccRecipients.length} BCC` : ''}\nMessage Length: ${body.length} characters`;

    if (!mailTips) {
      return { content: [{ type: 'text', text: sentText }] };
    }

    // Empty tips already carry their own M365-only note; don't repeat it.
    const caveat = mailTips.meta?.allEmpty ? '' : `\n\n${DELIVERY_CAVEAT}`;
    const acknowledged =
      mailTips.blocking.length > 0
        ? `\n\nSent with ${mailTips.blocking.length} acknowledged warning(s):\n${formatBlockingIssues(mailTips.blocking)}`
        : '';
    return {
      content: [
        {
          type: 'text',
          text: `${sentText}${acknowledged}\n\n---\n\n${mailTips.text}${caveat}`,
        },
      ],
      _meta: { mailTips: mailTips.meta },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    return toolError(`Error sending email: ${error.message}`);
  }
}

module.exports = handleSendEmail;
