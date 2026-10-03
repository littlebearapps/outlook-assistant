/**
 * Email export functionality
 *
 * Export emails to disk in MIME, Markdown, or JSON format.
 * Supports single and batch export with attachment handling.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { callGraphAPI, callGraphAPIRaw } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const {
  formatEmailContent,
  formatEmailsAsCSV,
  VERBOSITY,
} = require('../utils/response-formatter');
const { getEmailFields } = require('../utils/field-presets');
const { resolveFolderPath } = require('./folder-utils');
const { buildMailboxPrefix } = require('../utils/mailbox');
const { quoteSearchPhrase } = require('../utils/odata-helpers');
const { safeAttachmentFilename } = require('./attachments');
const { writeClaimedFile } = require('../utils/safe-write');
const { toolError, authRequiredError } = require('../utils/tool-error');

// Export format constants
const EXPORT_FORMATS = {
  MIME: 'mime',
  EML: 'eml', // Alias for MIME
  MARKDOWN: 'markdown',
  JSON: 'json',
  CSV: 'csv',
};

/**
 * Export single email handler
 * @param {object} args - Tool arguments
 * @param {string} args.id - Email ID (required)
 * @param {string} [args.format] - Export format (mime, eml, markdown, json)
 * @param {string} [args.savePath] - File path to save (optional)
 * @param {boolean} [args.includeAttachments] - Include attachments (default: true)
 * @returns {object} - MCP response with export status
 */
async function handleExportEmail(args) {
  const emailId = args.id;
  const format = (args.format || EXPORT_FORMATS.MARKDOWN).toLowerCase();
  // F-27: accept `outputDir` (canonical) and `savePath` (legacy alias).
  // Previously single-message exports ignored outputDir entirely and
  // hardcoded os.tmpdir(), inconsistent with target=messages.
  const savePath = args.outputDir || args.savePath;
  const includeAttachments = args.includeAttachments !== false;
  // Message IDs are mailbox-scoped: route to /users/{mailbox} for a shared/
  // delegated mailbox, else /me.
  const prefix = buildMailboxPrefix(args.sharedMailbox || args.email || null);

  if (!emailId) {
    return toolError('Email ID is required.');
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Get email metadata first (for filename and markdown export)
    const selectFields = getEmailFields('export');
    const email = await callGraphAPI(
      accessToken,
      'GET',
      `${prefix}/messages/${emailId}`,
      null,
      { $select: selectFields }
    );

    if (!email) {
      return toolError(`Email with ID ${emailId} not found.`);
    }

    // Generate filename based on email metadata. The time matters: a
    // date-only name collides across any same-day reply chain, and the old
    // behaviour was to overwrite silently.
    const timestamp = filenameTimestamp(email.receivedDateTime);
    const safeSubject = sanitizeFilename(email.subject || 'no-subject');
    const extension = getExtension(format);
    const defaultBase = `${timestamp}_${safeSubject}`;

    // Paths claimed while writing this message (main file + attachments).
    const claimedPaths = new Set();

    // Determine the save location. An explicit file path is the caller's to
    // control — honour it exactly, including overwriting, since that is what
    // an explicit path means. A directory (or the default temp dir) means we
    // choose the name, so the write is exclusive (`wx`): it never clobbers an
    // existing file and never follows a planted symlink.
    const explicitFile =
      savePath &&
      !(fs.existsSync(savePath) && fs.statSync(savePath).isDirectory());
    const targetDir = explicitFile ? null : savePath || os.tmpdir();

    // Export based on format
    let content;
    let attachmentsSaved = [];

    if (format === EXPORT_FORMATS.MIME || format === EXPORT_FORMATS.EML) {
      // MIME export - raw RFC822 format
      content = await callGraphAPIRaw(accessToken, emailId, prefix);
    } else if (format === EXPORT_FORMATS.MARKDOWN) {
      // Markdown export using existing formatter
      content = formatEmailContent(email, VERBOSITY.FULL, {
        includeHeaders: true,
        includeAllHeaders: true,
      });
    } else if (format === EXPORT_FORMATS.JSON) {
      // JSON export - full email object
      content = JSON.stringify(email, null, 2);
    } else if (format === EXPORT_FORMATS.CSV) {
      // CSV export - email metadata
      content = formatEmailsAsCSV(email);
    } else if (format === 'mbox' || format === 'html') {
      // F-26: clarify that mbox/html are conversation-only formats so
      // callers don't infer the format itself is unsupported.
      return toolError(
        `Format '${format}' is only supported for target=conversation. For target=message use one of: ${Object.values(EXPORT_FORMATS).join(', ')}.`
      );
    } else {
      return toolError(
        `Unknown format: ${format}. Supported for target=message: ${Object.values(EXPORT_FORMATS).join(', ')}.`
      );
    }

    // Save main file. Auto-create the directory so callers don't have to
    // pre-mkdir.
    let finalPath;
    if (explicitFile) {
      finalPath = savePath;
      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      fs.writeFileSync(finalPath, content, 'utf8');
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      finalPath = writeClaimedFile(
        targetDir,
        defaultBase,
        extension,
        claimedPaths,
        content,
        'utf8'
      );
    }

    // Handle attachments
    if (includeAttachments && email.hasAttachments) {
      attachmentsSaved = await saveAttachments(
        accessToken,
        emailId,
        path.dirname(finalPath),
        prefix,
        claimedPaths
      );
    }

    // Build response
    let resultText = `## Export Complete\n\n`;
    resultText += `| Property | Value |\n`;
    resultText += `|----------|-------|\n`;
    resultText += `| File | \`${finalPath}\` |\n`;
    resultText += `| Format | ${format.toUpperCase()} |\n`;
    resultText += `| Size | ${content.length.toLocaleString()} bytes |\n`;
    resultText += `| Subject | ${email.subject} |\n`;
    resultText += `| From | ${email.from?.emailAddress?.name || email.from?.emailAddress?.address} |\n`;
    resultText += `| Date | ${new Date(email.receivedDateTime).toLocaleString('en-AU')} |\n`;

    if (attachmentsSaved.length > 0) {
      resultText += `\n### Attachments (${attachmentsSaved.length})\n\n`;
      for (const att of attachmentsSaved) {
        resultText += `- \`${att.filename}\` (${att.size.toLocaleString()} bytes)\n`;
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
        filePath: finalPath,
        format: format,
        sizeBytes: content.length,
        attachmentsSaved: attachmentsSaved.length,
        emailId: emailId,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    return toolError(`Export failed: ${error.message}`);
  }
}

/**
 * Batch export emails handler
 * @param {object} args - Tool arguments
 * @param {string[]} [args.emailIds] - Array of email IDs to export
 * @param {object} [args.searchQuery] - Search query to find emails
 * @param {string} [args.format] - Export format (mime, markdown, json)
 * @param {string} args.outputDir - Output directory (required)
 * @param {boolean} [args.includeAttachments] - Include attachments (default: false for batch)
 * @returns {object} - MCP response with batch export status
 */
async function handleBatchExportEmails(args) {
  const emailIds = args.emailIds || [];
  // F-28: accept `query` as a top-level string alias for
  // `searchQuery: { subject }`. Lets callers use the same `query`
  // word they already know from search-emails.
  const searchQuery = { ...(args.searchQuery || {}) };
  if (args.query && !searchQuery.subject) {
    searchQuery.subject = args.query;
  }
  const format = (args.format || EXPORT_FORMATS.MARKDOWN).toLowerCase();
  const outputDir = args.outputDir;
  const includeAttachments = args.includeAttachments === true; // Default false for batch
  // Scope the whole batch (search + per-message fetch + attachments) to a
  // shared/delegated mailbox when supplied.
  const mailbox = args.sharedMailbox || args.email || null;
  const prefix = buildMailboxPrefix(mailbox);

  if (!outputDir) {
    return toolError('Output directory is required.');
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    const accessToken = await ensureAuthenticated();
    let idsToExport = [...emailIds];

    // If searchQuery provided, fetch matching emails
    if (Object.keys(searchQuery).length > 0 && emailIds.length === 0) {
      const searchResults = await searchEmailsForExport(
        accessToken,
        searchQuery,
        mailbox
      );
      idsToExport = searchResults.map((e) => e.id);
      // An empty match is a result, not an error.
      if (idsToExport.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No emails matched the search query; nothing was exported.',
            },
          ],
        };
      }
    }

    if (idsToExport.length === 0) {
      return toolError('No emails to export. Provide emailIds or searchQuery.');
    }

    // Limit batch size (per plan: max 100)
    const maxBatch = 100;
    if (idsToExport.length > maxBatch) {
      idsToExport = idsToExport.slice(0, maxBatch);
      console.error(`Batch export limited to ${maxBatch} emails`);
    }

    // CSV batch export: aggregate all emails into a single CSV file
    if (format === EXPORT_FORMATS.CSV) {
      const selectFields = getEmailFields('export');
      const emails = [];
      const failed = [];

      for (const emailId of idsToExport) {
        try {
          const email = await callGraphAPI(
            accessToken,
            'GET',
            `${prefix}/messages/${emailId}`,
            null,
            { $select: selectFields }
          );
          emails.push(email);
        } catch (error) {
          failed.push({ emailId, error: error.message });
        }
      }

      const csvContent = formatEmailsAsCSV(emails);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.mkdirSync(outputDir, { recursive: true });
      const csvPath = writeClaimedFile(
        outputDir,
        `batch_export_${timestamp}`,
        'csv',
        null,
        csvContent,
        'utf8'
      );
      const totalBytes = Buffer.byteLength(csvContent, 'utf8');

      let resultText = `## Batch Export Complete\n\n`;
      resultText += `| Metric | Value |\n`;
      resultText += `|--------|-------|\n`;
      resultText += `| Total | ${idsToExport.length} |\n`;
      resultText += `| Successful | ${emails.length} |\n`;
      resultText += `| Failed | ${failed.length} |\n`;
      resultText += `| Output File | \`${csvPath}\` |\n`;
      resultText += `| Format | CSV |\n`;
      resultText += `| Total Size | ${(totalBytes / 1024).toFixed(1)} KB |\n`;

      if (failed.length > 0) {
        resultText += `\n### Failed Exports\n\n`;
        for (const f of failed.slice(0, 10)) {
          resultText += `- ID \`${f.emailId}\`: ${f.error}\n`;
        }
        if (failed.length > 10) {
          resultText += `- ... and ${failed.length - 10} more\n`;
        }
      }

      return {
        content: [{ type: 'text', text: resultText }],
        _meta: {
          outputDir,
          format,
          total: idsToExport.length,
          successful: emails.length,
          failed: failed.length,
          totalBytes,
        },
      };
    }

    // Export emails with concurrency limit (4 concurrent per Graph API limits)
    const results = await exportWithConcurrency(
      accessToken,
      idsToExport,
      format,
      outputDir,
      includeAttachments,
      4, // Max concurrent
      prefix
    );

    // Build response
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    let resultText = `## Batch Export Complete\n\n`;
    resultText += `| Metric | Value |\n`;
    resultText += `|--------|-------|\n`;
    resultText += `| Total | ${results.length} |\n`;
    resultText += `| Successful | ${successful.length} |\n`;
    resultText += `| Failed | ${failed.length} |\n`;
    resultText += `| Output Directory | \`${outputDir}\` |\n`;
    resultText += `| Format | ${format.toUpperCase()} |\n`;

    // Total size
    const totalBytes = successful.reduce(
      (sum, r) => sum + (r.sizeBytes || 0),
      0
    );
    resultText += `| Total Size | ${(totalBytes / 1024).toFixed(1)} KB |\n`;

    // Requested id -> written path, so a caller can reconcile without
    // listing the directory. A batch that silently lost messages to
    // filename collisions still reported "Successful N / Failed 0", and the
    // loss was only ever caught by counting distinct Message-IDs by hand.
    const manifest = successful.map((r) => ({
      emailId: r.emailId,
      filePath: r.filePath,
    }));
    const disambiguated = manifest.filter((entry) =>
      /_\d+\.[^.]+$/.test(entry.filePath)
    );
    if (disambiguated.length > 0) {
      resultText += `\n> ${disambiguated.length} file name(s) were disambiguated with a numeric suffix — messages sharing a timestamp and subject, or names already present in the output directory. Nothing was overwritten.\n`;
    }

    if (failed.length > 0) {
      resultText += `\n### Failed Exports\n\n`;
      for (const f of failed.slice(0, 10)) {
        resultText += `- ID \`${f.emailId}\`: ${f.error}\n`;
      }
      if (failed.length > 10) {
        resultText += `- ... and ${failed.length - 10} more\n`;
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
        outputDir: outputDir,
        format: format,
        total: results.length,
        successful: successful.length,
        failed: failed.length,
        totalBytes: totalBytes,
        manifest,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return authRequiredError();
    }

    return toolError(`Batch export failed: ${error.message}`);
  }
}

/**
 * Search emails for batch export
 * @param {string} accessToken
 * @param {object} query
 * @param {string|null} [mailbox] - Shared mailbox email, or null for the signed-in user
 */
async function searchEmailsForExport(accessToken, query, mailbox = null) {
  const folder = query.folder || 'inbox';
  const maxResults = Math.min(query.maxResults || 25, 100);

  // Build filter conditions
  const filterParts = [];
  if (query.receivedAfter) {
    filterParts.push(
      `receivedDateTime ge ${new Date(query.receivedAfter).toISOString()}`
    );
  }
  if (query.receivedBefore) {
    filterParts.push(
      `receivedDateTime le ${new Date(query.receivedBefore).toISOString()}`
    );
  }

  const params = {
    $select: 'id',
    $top: maxResults,
    $orderby: 'receivedDateTime desc',
  };

  if (filterParts.length > 0) {
    params.$filter = filterParts.join(' and ');
  }

  // Add search for from/subject if provided
  const searchParts = [];
  if (query.from) {
    searchParts.push(`from:${query.from}`);
  }
  if (query.subject) {
    searchParts.push(`subject:${query.subject}`);
  }
  if (searchParts.length > 0) {
    params.$search = quoteSearchPhrase(searchParts.join(' '));
    delete params.$orderby; // Can't combine $search with $orderby
  }

  // resolveFolderPath handles well-known names, custom/localized names, nested
  // paths, and raw IDs, scoped to the signed-in user or the shared mailbox.
  const endpoint = await resolveFolderPath(accessToken, folder, mailbox);
  const response = await callGraphAPI(
    accessToken,
    'GET',
    endpoint,
    null,
    params
  );

  return response.value || [];
}

/**
 * Export emails with concurrency limit
 */
async function exportWithConcurrency(
  accessToken,
  emailIds,
  format,
  outputDir,
  includeAttachments,
  maxConcurrent,
  prefix = 'me'
) {
  const results = [];
  const inProgress = new Set();
  // Shared across the batch so concurrent exports cannot claim the same path.
  const claimedPaths = new Set();
  let index = 0;

  while (index < emailIds.length || inProgress.size > 0) {
    // Start new exports up to concurrency limit
    while (index < emailIds.length && inProgress.size < maxConcurrent) {
      const emailId = emailIds[index];
      const promise = exportSingleForBatch(
        accessToken,
        emailId,
        format,
        outputDir,
        includeAttachments,
        prefix,
        claimedPaths
      ).then((result) => {
        inProgress.delete(promise);
        results.push(result);
        return result;
      });
      inProgress.add(promise);
      index++;
    }

    // Wait for at least one to complete
    if (inProgress.size > 0) {
      await Promise.race(inProgress);
    }
  }

  return results;
}

/**
 * Export single email for batch operation
 */
async function exportSingleForBatch(
  accessToken,
  emailId,
  format,
  outputDir,
  includeAttachments,
  prefix = 'me',
  claimedPaths
) {
  try {
    const selectFields = getEmailFields('export');
    const email = await callGraphAPI(
      accessToken,
      'GET',
      `${prefix}/messages/${emailId}`,
      null,
      { $select: selectFields }
    );

    const timestamp = filenameTimestamp(email.receivedDateTime);
    const safeSubject = sanitizeFilename(email.subject || 'no-subject');
    const extension = getExtension(format);

    let content;
    if (format === EXPORT_FORMATS.MIME || format === EXPORT_FORMATS.EML) {
      content = await callGraphAPIRaw(accessToken, emailId, prefix);
    } else if (format === EXPORT_FORMATS.MARKDOWN) {
      content = formatEmailContent(email, VERBOSITY.FULL, {
        includeHeaders: true,
      });
    } else {
      content = JSON.stringify(email, null, 2);
    }

    const filePath = writeClaimedFile(
      outputDir,
      `${timestamp}_${safeSubject}`,
      extension,
      claimedPaths,
      content,
      'utf8'
    );

    // Handle attachments if requested
    let attachmentCount = 0;
    if (includeAttachments && email.hasAttachments) {
      const saved = await saveAttachments(
        accessToken,
        emailId,
        outputDir,
        prefix,
        claimedPaths
      );
      attachmentCount = saved.length;
    }

    return {
      success: true,
      emailId: emailId,
      filePath: filePath,
      sizeBytes: content.length,
      attachments: attachmentCount,
    };
  } catch (error) {
    return {
      success: false,
      emailId: emailId,
      error: error.message,
    };
  }
}

/**
 * Save email attachments to directory
 * @param {string} accessToken
 * @param {string} emailId
 * @param {string} outputDir
 * @param {string} [prefix] - Mailbox resource prefix (`me` or `users/{email}`)
 */
async function saveAttachments(
  accessToken,
  emailId,
  outputDir,
  prefix = 'me',
  claimedPaths
) {
  const saved = [];

  try {
    const response = await callGraphAPI(
      accessToken,
      'GET',
      `${prefix}/messages/${emailId}/attachments`,
      null,
      { $select: 'id,name,contentBytes,size,contentType' }
    );

    if (!response.value) return saved;

    for (const att of response.value) {
      if (att.contentBytes) {
        // The attachment name is sender-controlled (GHSA-755c-c45g-69rv):
        // reduce it to a safe basename. The per-message tag is derived from a
        // hash of the id, never the raw caller-supplied id, so it can't carry
        // path characters; uniqueness comes from the exclusive write.
        const safeFilename = safeAttachmentFilename(att.name);
        const { base, extension } = splitExtension(safeFilename);
        const buffer = Buffer.from(att.contentBytes, 'base64');
        const filePath = writeClaimedFile(
          outputDir,
          `${messageTag(emailId)}_${base}`,
          extension,
          claimedPaths,
          buffer
        );
        saved.push({
          filename: safeFilename,
          path: filePath,
          size: buffer.length,
        });
      }
    }
  } catch (error) {
    console.error(`Failed to save attachments: ${error.message}`);
  }

  return saved;
}

/**
 * Format a message timestamp for use in a filename.
 *
 * Date-only was the collision: a same-day reply chain is extremely common, and
 * every message in it normalises to the same `<date>_<subject>` name. Keeping
 * the time disambiguates the realistic case. Mirrors the sanitisation #82
 * applied to the aggregated CSV name.
 *
 * @param {string} isoDateTime - Message receivedDateTime
 * @returns {string} - e.g. `2023-06-15T01-26-00`
 */
function filenameTimestamp(isoDateTime) {
  const parsed = new Date(isoDateTime);
  if (Number.isNaN(parsed.getTime())) return 'undated';
  return parsed.toISOString().slice(0, 19).replace(/[:.]/g, '-');
}

/**
 * Short, filesystem-safe tag for a message id. Graph ids in one mailbox share
 * a long common prefix and are caller-supplied, so neither a raw prefix nor
 * the id itself is usable in a filename.
 * @param {string} emailId
 * @returns {string} - 8 hex characters
 */
function messageTag(emailId) {
  return crypto
    .createHash('sha256')
    .update(String(emailId))
    .digest('hex')
    .slice(0, 8);
}

/**
 * Split a filename into base and extension for collision-safe claiming.
 * @param {string} name - Sanitised filename, possibly with an extension
 * @returns {{base: string, extension: string}}
 */
function splitExtension(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, extension: '' };
  return { base: name.slice(0, dot), extension: name.slice(dot + 1) };
}

/**
 * Sanitize filename for filesystem
 */
function sanitizeFilename(name) {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Replace illegal chars including control chars
      .replace(/\s+/g, '_') // Replace spaces
      .replace(/_+/g, '_') // Collapse multiple underscores
      .substring(0, 50) // Limit length
      .replace(/^[._]+|[._]+$/g, '')
  ); // Remove leading/trailing dots/underscores
}

/**
 * Get file extension for format
 */
function getExtension(format) {
  switch (format) {
    case EXPORT_FORMATS.MIME:
    case EXPORT_FORMATS.EML:
      return 'eml';
    case EXPORT_FORMATS.JSON:
      return 'json';
    case EXPORT_FORMATS.CSV:
      return 'csv';
    case EXPORT_FORMATS.MARKDOWN:
    default:
      return 'md';
  }
}

module.exports = {
  handleExportEmail,
  handleBatchExportEmails,
  EXPORT_FORMATS,
};
