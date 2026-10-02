/**
 * Move emails functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { resolveFolder } = require('./resolve');

/**
 * Move emails handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleMoveEmails(args) {
  const emailIds = args.emailIds || '';
  const targetFolder = args.targetFolder || '';
  const targetFolderId = args.targetFolderId || '';
  const sourceFolder = args.sourceFolder || '';

  if (!emailIds) {
    return {
      content: [
        {
          type: 'text',
          text: 'Email IDs are required. Please provide a comma-separated list of email IDs to move.',
        },
      ],
    };
  }

  if (!targetFolder && !targetFolderId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Target folder is required — pass `targetFolder` (name or "Parent/Child" path) or `targetFolderId`.',
        },
      ],
    };
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Parse email IDs
    const ids = emailIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id);

    if (ids.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No valid email IDs provided.',
          },
        ],
      };
    }

    // Move emails
    const result = await moveEmailsToFolder(
      accessToken,
      ids,
      { name: targetFolder, id: targetFolderId },
      sourceFolder
    );

    return {
      content: [
        {
          type: 'text',
          text: result.message,
        },
      ],
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'authenticate' tool first.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error moving emails: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Move emails to a folder
 * @param {string} accessToken - Access token
 * @param {Array<string>} emailIds - Array of email IDs to move
 * @param {{name?: string, id?: string}} targetSpec - Target folder name/path or ID
 * @param {string} sourceFolderName - Name of the source folder (optional)
 * @returns {Promise<object>} - Result object with status and message
 */
async function moveEmailsToFolder(
  accessToken,
  emailIds,
  targetSpec,
  _sourceFolderName
) {
  try {
    // Resolve the target folder (supports "Parent/Child" paths, aliases, and
    // explicit IDs — nested folders are now addressable). (#216)
    let target;
    try {
      target = await resolveFolder(accessToken, targetSpec);
    } catch (resolveError) {
      return { success: false, message: resolveError.message };
    }
    const targetFolderId = target.id;
    const targetLabel = target.path;

    // Track successful and failed moves
    const results = {
      successful: [],
      failed: [],
    };

    // Process each email one by one to handle errors independently
    for (const emailId of emailIds) {
      try {
        // Move the email
        await callGraphAPI(accessToken, 'POST', `me/messages/${emailId}/move`, {
          destinationId: targetFolderId,
        });

        results.successful.push(emailId);
      } catch (error) {
        console.error(`Error moving email ${emailId}: ${error.message}`);
        results.failed.push({
          id: emailId,
          error: error.message,
        });
      }
    }

    // Generate result message
    let message = '';

    if (results.successful.length > 0) {
      message += `Successfully moved ${results.successful.length} email(s) to "${targetLabel}".`;
    }

    if (results.failed.length > 0) {
      if (message) message += '\n\n';
      message += `Failed to move ${results.failed.length} email(s). Errors:`;

      // Show first few errors with details
      const maxErrors = Math.min(results.failed.length, 3);
      for (let i = 0; i < maxErrors; i++) {
        const failure = results.failed[i];
        message += `\n- Email ${i + 1}: ${failure.error}`;
      }

      // If there are more errors, just mention the count
      if (results.failed.length > maxErrors) {
        message += `\n...and ${results.failed.length - maxErrors} more.`;
      }
    }

    return {
      success: results.successful.length > 0,
      message,
      results,
    };
  } catch (error) {
    console.error(`Error in moveEmailsToFolder: ${error.message}`);
    throw error;
  }
}

module.exports = handleMoveEmails;
