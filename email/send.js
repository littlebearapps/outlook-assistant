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
  } = args;

  // Validate required parameters
  if (!to) {
    return {
      content: [
        {
          type: 'text',
          text: 'Recipient (to) is required.',
        },
      ],
    };
  }

  if (!subject) {
    return {
      content: [
        {
          type: 'text',
          text: 'Subject is required.',
        },
      ],
    };
  }

  if (!body) {
    return {
      content: [
        {
          type: 'text',
          text: 'Body content is required.',
        },
      ],
    };
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

    // Prepare email object
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

    return {
      content: [
        {
          type: 'text',
          text: `Email sent successfully!\n\nSubject: ${subject}\nRecipients: ${toRecipients.length}${ccRecipients.length > 0 ? ` + ${ccRecipients.length} CC` : ''}${bccRecipients.length > 0 ? ` + ${bccRecipients.length} BCC` : ''}\nMessage Length: ${body.length} characters`,
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
          text: `Error sending email: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = handleSendEmail;
