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
const { buildMailboxPrefix } = require('../utils/mailbox');
const { resolveFolder, looksLikeFolderId } = require('../folder/resolve');
const { toolError, authRequiredError } = require('../utils/tool-error');

/**
 * Extract the mailbox segment (`me` or `users/{address}`) from a delta/
 * continuation token URL. Returns null when the token carries no mailbox
 * segment we can recognise (e.g. an opaque or relative value) — those are
 * passed through untouched for backward compatibility.
 * @param {string} token - Delta or continuation token (a full Graph URL)
 * @returns {string|null} - Mailbox prefix found in the token path, or null
 */
function mailboxFromToken(token) {
  let pathname = token;
  try {
    pathname = new URL(token).pathname;
  } catch {
    // Not an absolute URL — match against the raw value.
  }
  const match = pathname.match(/(?:^|\/)(me|users\/[^/]+)(?:\/|$)/i);
  if (!match) {
    return null;
  }
  // Token URLs carry the percent-encoded form; local prefixes are raw.
  // Decode so the two compare on equal footing.
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Decide whether a delta token's mailbox clearly differs from the target.
 * Only identifiers of the same kind are compared: `me` against `me`, or an
 * address against an address. Graph may hand back continuation links that
 * name the mailbox by object ID (`users/<guid>`), which can't be matched to an
 * address locally, so those are let through rather than wrongly rejected.
 * @param {string} tokenMailbox - Mailbox segment from the token (`me` or `users/...`)
 * @param {string} prefix - Mailbox prefix for this call (`me` or `users/...`)
 * @returns {boolean} - True when the two identifiably name different mailboxes
 */
function mailboxesConflict(tokenMailbox, prefix) {
  const token = tokenMailbox.toLowerCase();
  const target = prefix.toLowerCase();
  if (token === target) return false;
  const isAddress = (p) => p.startsWith('users/') && p.includes('@');
  if (token === 'me' || target === 'me') {
    // `me` versus a named mailbox is a mismatch, unless the named one is an
    // opaque object ID that could be the signed-in user.
    const other = token === 'me' ? target : token;
    return isAddress(other);
  }
  return isAddress(token) && isAddress(target);
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

/**
 * Turn the caller's `maxResults` into a delta page size: an integer from 1 to
 * 200. Missing or non-numeric values give the default (100); fractions are
 * floored; zero and negatives become 1; anything over 200 becomes 200.
 * @param {*} value - Raw `maxResults` argument
 * @returns {number} - Page size to request
 */
function clampPageSize(value) {
  const n =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(n), 1), MAX_PAGE_SIZE);
}

/**
 * Sync phase of each continuation token this server issued (#262). A
 * `$skiptoken` page belongs to whichever sync produced it, initial or
 * incremental, and its URL doesn't say which, so remember it. Bounded; a
 * continuation token not in here (e.g. after a restart) has phase 'unknown'.
 */
const CONTINUATION_PHASES = new Map();
const MAX_TRACKED_CONTINUATIONS = 200;

function rememberPhase(token, phase) {
  CONTINUATION_PHASES.delete(token);
  CONTINUATION_PHASES.set(token, phase);
  if (CONTINUATION_PHASES.size > MAX_TRACKED_CONTINUATIONS) {
    CONTINUATION_PHASES.delete(CONTINUATION_PHASES.keys().next().value);
  }
}

/**
 * 'initial' (no token, or a continuation of an initial sync), 'incremental'
 * (a delta token, or a continuation of one) or 'unknown' (a continuation
 * token this server didn't issue).
 * @param {string} [deltaToken]
 * @returns {'initial'|'incremental'|'unknown'}
 */
function syncPhase(deltaToken) {
  if (!deltaToken) return 'initial';
  if (CONTINUATION_PHASES.has(deltaToken)) {
    return CONTINUATION_PHASES.get(deltaToken);
  }
  // A continuation token this server didn't issue (e.g. from before a
  // restart) can't be placed; any other token is a delta token.
  if (/[?&](\$|%24)skiptoken=/i.test(deltaToken)) return 'unknown';
  return 'incremental';
}

const PHASE_LABEL = {
  initial: 'Initial',
  incremental: 'Incremental',
  unknown: 'Continuation (initial or incremental unknown)',
};

/**
 * List emails delta handler - incremental sync
 * @param {object} args - Tool arguments
 * @param {string} [args.folder] - Folder to sync (default: inbox)
 * @param {string} [args.deltaToken] - Token from previous delta call (omit for initial sync)
 * @param {number} [args.maxResults] - Page size, 1-200 (default: 100). Sent as
 *   `Prefer: odata.maxpagesize` on every page; `$top` would cap the whole sync.
 * @param {string} [args.outputVerbosity] - Output detail level
 * @returns {object} - MCP response with emails, deltaToken, and change summary
 */
async function handleListEmailsDelta(args) {
  const folder = args.folder || 'inbox';
  const deltaToken = args.deltaToken;
  const maxResults = clampPageSize(args.maxResults);
  const verbosity = args.outputVerbosity || 'standard';
  // Optional: scope the delta sync to a shared/delegated mailbox rather than
  // the signed-in account. Accepts a custom/localized folder name or path.
  const sharedMailbox = args.sharedMailbox || args.email || null;
  const prefix = buildMailboxPrefix(sharedMailbox);

  try {
    const accessToken = await ensureAuthenticated();

    // Build delta query
    let endpoint;
    let queryParams = {};

    if (deltaToken) {
      // Continue from previous sync - use deltaLink directly. The token is
      // authoritative: it already encodes the mailbox and folder, so the
      // `folder`/`sharedMailbox` args are ignored. Reject a token from a
      // different mailbox rather than silently syncing the wrong one.
      const tokenMailbox = mailboxFromToken(deltaToken);
      if (tokenMailbox && mailboxesConflict(tokenMailbox, prefix)) {
        return toolError(
          `Delta token mailbox mismatch: the token belongs to \`${tokenMailbox}\` but this call targets \`${prefix}\`.\n\n` +
            'A delta token is bound to the mailbox and folder it was issued for. Use the token from that same mailbox/folder, or omit `deltaToken` to start a fresh initial sync here.'
        );
      }
      endpoint = deltaToken;
    } else {
      // Initial sync - start fresh. Resolve the folder (well-known name,
      // nested path, display name, or raw ID) within the target mailbox so
      // custom subfolders work for shared mailboxes too.
      // Resolution failures (not-found / ambiguous) carry their own actionable
      // message; let them propagate to the handler's catch like any other error.
      // A raw folder ID (accepted here before name resolution existed) is
      // treated as an ID, not searched for as a display name.
      const resolved = await resolveFolder(
        accessToken,
        looksLikeFolderId(folder)
          ? { id: folder, mailbox: sharedMailbox }
          : { name: folder, mailbox: sharedMailbox }
      );
      endpoint = `${prefix}/mailFolders/${resolved.id}/messages/delta`;
      // No `$top`: on messages/delta it caps the whole sync, not the page.
      queryParams = { $select: getEmailFields('delta') };
    }

    // Fetch delta results. Graph honours the page size only on requests that
    // carry the Prefer header, so continuation calls must send it too.
    const response = await callGraphAPI(
      accessToken,
      'GET',
      endpoint,
      null,
      queryParams,
      { Prefer: `odata.maxpagesize=${maxResults}` }
    );

    // Process results
    const phase = syncPhase(deltaToken);
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
      } else if (phase === 'initial') {
        // Initial sync (any page) - all items are "created" for our purposes
        changesSummary.created++;
        processedEmails.push(email);
      } else {
        // Incremental (or unknown) - every non-removed item is a change; Graph
        // doesn't say whether it was created or updated
        changesSummary.updated++;
        processedEmails.push(email);
      }
    }

    // Build response
    const isInitialSync = phase === 'initial';
    const hasMoreChanges = Boolean(nextLink);
    const newDeltaToken = deltaLink || nextLink;
    // F-15: nextLink is a continuation token (more pages of the same
    // sync), not a delta token. The real delta token only emits once
    // the initial sync finishes paging. Distinguish them in output so
    // callers know what they're storing.
    const tokenIsContinuation = !deltaLink && Boolean(nextLink);
    if (tokenIsContinuation) rememberPhase(nextLink, phase);

    // Format output based on verbosity
    let resultText;
    if (verbosity === 'minimal') {
      resultText = `## Delta Sync\n\n`;
      resultText += `| Metric | Value |\n`;
      resultText += `|--------|-------|\n`;
      resultText += `| Items | ${processedEmails.length} |\n`;
      resultText += `| Type | ${PHASE_LABEL[phase]} |\n`;
      resultText += `| More | ${hasMoreChanges ? 'Yes' : 'No'} |\n`;
      if (newDeltaToken) {
        const label = tokenIsContinuation
          ? 'Continuation Token (more pages — call again to keep paging)'
          : 'Delta Token (save for next sync call)';
        resultText += `\n**${label}**:\n\`\`\`\n${newDeltaToken}\n\`\`\`\n`;
      }
    } else {
      resultText = `## Delta Sync (${PHASE_LABEL[phase]})\n\n`;

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
        // formatEmailList takes (emails, folder, verbosity): the verbosity
        // used to land in the folder slot ("Emails in standard", #306).
        resultText += formatEmailList(
          activeEmails,
          deltaToken ? 'this sync page' : folder,
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
        resultText += `This page returned a continuation token. Call \`search-emails deltaMode=true deltaToken=<token>\` again to fetch the next page, and pass the same \`maxResults\` on every page to keep the page size. The real delta token only emits once paging completes.\n`;
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
        syncType: phase,
        mailbox: sharedMailbox || 'me',
        // With a token the folder comes from the token, not the `folder` arg
        // (which is ignored) — don't echo a value we didn't use.
        folder: deltaToken ? null : folder,
        folderSource: deltaToken ? 'deltaToken' : 'argument',
        itemCount: processedEmails.length,
        hasMoreChanges: hasMoreChanges,
        changesSummary: changesSummary,
        deltaToken: newDeltaToken,
        tokenType: tokenIsContinuation ? 'continuation' : 'delta',
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    // Handle expired delta token
    if (
      error.message.includes('410') ||
      error.message.includes('resyncRequired')
    ) {
      return toolError(
        `## Delta Token Expired\n\nThe provided delta token has expired. Please start a new initial sync by calling without a deltaToken.\n\n**Error:** ${error.message}`
      );
    }

    return toolError(`Delta sync failed: ${error.message}`);
  }
}

module.exports = handleListEmailsDelta;
module.exports.syncPhase = syncPhase;
