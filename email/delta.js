/**
 * Delta sync functionality for email
 *
 * Provides incremental sync using Microsoft Graph delta queries.
 * Returns only changes since last sync, with deltaToken for next call.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { formatEmailList, VERBOSITY } = require('../utils/response-formatter');
const { getEmailFields } = require('../utils/field-presets');

/**
 * List emails delta handler - incremental sync
 * @param {object} args - Tool arguments
 * @param {string} [args.folder] - Folder to sync (default: inbox)
 * @param {string} [args.deltaToken] - Token from previous delta call (omit for initial sync)
 * @param {number} [args.maxResults] - Max results per page (default: 100)
 * @param {string} [args.outputVerbosity] - Output detail level
 * @returns {object} - MCP response with emails, deltaToken, and change summary
 */
async function handleListEmailsDelta(args) {
  const folder = args.folder || 'inbox';
  const deltaToken = args.deltaToken;
  const maxResults = Math.min(args.maxResults || 100, 200);
  const verbosity = args.outputVerbosity || 'standard';

  try {
    const accessToken = await ensureAuthenticated();

    // Build delta query
    let endpoint;
    let queryParams = {};

    if (deltaToken) {
      // Continue from previous sync - use deltaLink directly
      endpoint = deltaToken;
    } else {
      // Initial sync - start fresh
      endpoint = `me/mailFolders/${folder}/messages/delta`;
      queryParams = {
        $select: getEmailFields('delta'),
        $top: maxResults.toString(),
      };
    }

    // Fetch delta results
    const response = await callGraphAPI(
      accessToken,
      'GET',
      endpoint,
      null,
      deltaToken ? {} : queryParams
    );

    // Process results
    const emails = response.value || [];
    const nextLink = response['@odata.nextLink'];
    const deltaLink = response['@odata.deltaLink'];

    // Categorise changes
    const changesSummary = {
      created: 0,
      updated: 0,
      deleted: 0,
    };

    const processedEmails = [];
    for (const email of emails) {
      if (email['@removed']) {
        // Deleted email
        changesSummary.deleted++;
        processedEmails.push({
          id: email.id,
          removed: true,
          reason: email['@removed'].reason || 'deleted',
        });
      } else if (deltaToken) {
        // With deltaToken, all non-removed items are changes
        // We can't reliably distinguish created vs updated via delta
        changesSummary.updated++;
        processedEmails.push(email);
      } else {
        // Initial sync - all items are "created" for our purposes
        changesSummary.created++;
        processedEmails.push(email);
      }
    }

    // Build response
    const isInitialSync = !deltaToken;
    const hasMoreChanges = Boolean(nextLink);
    const newDeltaToken = deltaLink || nextLink;
    // F-15: nextLink is a continuation token (more pages of the same
    // sync), not a delta token. The real delta token only emits once
    // the initial sync finishes paging. Distinguish them in output so
    // callers know what they're storing.
    const tokenIsContinuation = !deltaLink && Boolean(nextLink);

    // Format output based on verbosity
    let resultText;
    if (verbosity === 'minimal') {
      resultText = `## Delta Sync\n\n`;
      resultText += `| Metric | Value |\n`;
      resultText += `|--------|-------|\n`;
      resultText += `| Items | ${processedEmails.length} |\n`;
      resultText += `| Type | ${isInitialSync ? 'Initial' : 'Incremental'} |\n`;
      resultText += `| More | ${hasMoreChanges ? 'Yes' : 'No'} |\n`;
      if (newDeltaToken) {
        const label = tokenIsContinuation
          ? 'Continuation Token (more pages — call again to keep paging)'
          : 'Delta Token (save for next sync call)';
        resultText += `\n**${label}**:\n\`\`\`\n${newDeltaToken}\n\`\`\`\n`;
      }
    } else {
      resultText = `## Delta Sync ${isInitialSync ? '(Initial)' : '(Incremental)'}\n\n`;

      // Changes summary
      resultText += `### Changes Summary\n\n`;
      resultText += `| Change Type | Count |\n`;
      resultText += `|-------------|-------|\n`;
      if (!isInitialSync) {
        resultText += `| Created/Updated | ${changesSummary.updated} |\n`;
        resultText += `| Deleted | ${changesSummary.deleted} |\n`;
      } else {
        resultText += `| Synced | ${changesSummary.created} |\n`;
      }
      resultText += `| Total | ${processedEmails.length} |\n`;

      // Emails list (non-deleted only)
      const activeEmails = processedEmails.filter((e) => !e.removed);
      if (activeEmails.length > 0) {
        resultText += `\n### Emails\n\n`;
        resultText += formatEmailList(
          activeEmails,
          verbosity === 'full' ? VERBOSITY.FULL : VERBOSITY.STANDARD
        );
      }

      // Deleted items
      const deletedEmails = processedEmails.filter((e) => e.removed);
      if (deletedEmails.length > 0) {
        resultText += `\n### Deleted Items (${deletedEmails.length})\n\n`;
        for (const del of deletedEmails.slice(0, 10)) {
          resultText += `- ID: \`${del.id}\`\n`;
        }
        if (deletedEmails.length > 10) {
          resultText += `- ... and ${deletedEmails.length - 10} more\n`;
        }
      }

      // Pagination info
      if (hasMoreChanges) {
        resultText += `\n### More Pages Available\n`;
        resultText += `This page returned a continuation token. Call \`search-emails deltaMode=true deltaToken=<token>\` again to fetch the next page. The real delta token only emits once paging completes.\n`;
      }

      // Token (delta or continuation)
      if (newDeltaToken) {
        if (tokenIsContinuation) {
          resultText += `\n### Continuation Token\n`;
          resultText += `**More pages remain. Pass this back to keep paging:**\n\`\`\`\n${newDeltaToken}\n\`\`\`\n`;
        } else {
          resultText += `\n### Delta Token\n`;
          resultText += `**Save this token for next sync call:**\n\`\`\`\n${newDeltaToken}\n\`\`\`\n`;
        }
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: resultText,
        },
      ],
      _meta: {
        syncType: isInitialSync ? 'initial' : 'incremental',
        folder: folder,
        itemCount: processedEmails.length,
        hasMoreChanges: hasMoreChanges,
        changesSummary: changesSummary,
        deltaToken: newDeltaToken,
        tokenType: tokenIsContinuation ? 'continuation' : 'delta',
      },
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

    // Handle expired delta token
    if (
      error.message.includes('410') ||
      error.message.includes('resyncRequired')
    ) {
      return {
        content: [
          {
            type: 'text',
            text: `## Delta Token Expired\n\nThe provided delta token has expired. Please start a new initial sync by calling without a deltaToken.\n\n**Error:** ${error.message}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Delta sync failed: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = handleListEmailsDelta;
