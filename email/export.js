/**
 * Email export functionality
 *
 * Export emails to disk in MIME, Markdown, or JSON format.
 * Supports single and batch export with attachment handling.
 */
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
  const savePath = args.savePath;
  const includeAttachments = args.includeAttachments !== false;

  if (!emailId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Email ID is required.',
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Get email metadata first (for filename and markdown export)
    const selectFields = getEmailFields('export');
    const email = await callGraphAPI(
      accessToken,
      'GET',
      `me/messages/${emailId}`,
      null,
      { $select: selectFields }
    );

    if (!email) {
      return {
        content: [
          {
            type: 'text',
            text: `Email with ID ${emailId} not found.`,
          },
        ],
      };
    }

    // Generate filename based on email metadata
    const timestamp = new Date(email.receivedDateTime)
      .toISOString()
      .slice(0, 10);
    const safeSubject = sanitizeFilename(email.subject || 'no-subject');
    const extension = getExtension(format);
    const defaultFilename = `${timestamp}_${safeSubject}.${extension}`;

    // Determine final save path
    let finalPath;
    if (savePath) {
      // If savePath is a directory, append filename
      if (fs.existsSync(savePath) && fs.statSync(savePath).isDirectory()) {
        finalPath = path.join(savePath, defaultFilename);
      } else {
        finalPath = savePath;
      }
    } else {
      // Default to OS temp directory to avoid polluting the working directory
      finalPath = path.join(os.tmpdir(), defaultFilename);
    }

    // Export based on format
    let content;
    let attachmentsSaved = [];

    if (format === EXPORT_FORMATS.MIME || format === EXPORT_FORMATS.EML) {
      // MIME export - raw RFC822 format
      content = await callGraphAPIRaw(accessToken, emailId);
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
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Unknown format: ${format}. Supported: ${Object.values(EXPORT_FORMATS).join(', ')}`,
          },
        ],
      };
    }

    // Save main file
    fs.writeFileSync(finalPath, content, 'utf8');

    // Handle attachments
    if (includeAttachments && email.hasAttachments) {
      attachmentsSaved = await saveAttachments(
        accessToken,
        emailId,
        path.dirname(finalPath)
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
          text: `Export failed: ${error.message}`,
        },
      ],
    };
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
  const searchQuery = args.searchQuery || {};
  const format = (args.format || EXPORT_FORMATS.MARKDOWN).toLowerCase();
  const outputDir = args.outputDir;
  const includeAttachments = args.includeAttachments === true; // Default false for batch

  if (!outputDir) {
    return {
      content: [
        {
          type: 'text',
          text: 'Output directory is required.',
        },
      ],
    };
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
        searchQuery
      );
      idsToExport = searchResults.map((e) => e.id);
    }

    if (idsToExport.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No emails to export. Provide emailIds or searchQuery.',
          },
        ],
      };
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
            `me/messages/${emailId}`,
            null,
            { $select: selectFields }
          );
          emails.push(email);
        } catch (error) {
          failed.push({ emailId, error: error.message });
        }
      }

      const csvContent = formatEmailsAsCSV(emails);
      const csvPath = path.join(
        outputDir,
        `batch_export_${new Date().toISOString().slice(0, 10)}.csv`
      );
      fs.writeFileSync(csvPath, csvContent, 'utf8');
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
      4 // Max concurrent
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

    return {
      content: [
        {
          type: 'text',
          text: `Batch export failed: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Search emails for batch export
 */
async function searchEmailsForExport(accessToken, query) {
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
    params.$search = `"${searchParts.join(' ')}"`;
    delete params.$orderby; // Can't combine $search with $orderby
  }

  const response = await callGraphAPI(
    accessToken,
    'GET',
    `me/mailFolders/${folder}/messages`,
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
  maxConcurrent
) {
  const results = [];
  const inProgress = new Set();
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
        includeAttachments
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
  includeAttachments
) {
  try {
    const selectFields = getEmailFields('export');
    const email = await callGraphAPI(
      accessToken,
      'GET',
      `me/messages/${emailId}`,
      null,
      { $select: selectFields }
    );

    const timestamp = new Date(email.receivedDateTime)
      .toISOString()
      .slice(0, 10);
    const safeSubject = sanitizeFilename(email.subject || 'no-subject');
    const extension = getExtension(format);
    const filename = `${timestamp}_${safeSubject}.${extension}`;
    const filePath = path.join(outputDir, filename);

    let content;
    if (format === EXPORT_FORMATS.MIME || format === EXPORT_FORMATS.EML) {
      content = await callGraphAPIRaw(accessToken, emailId);
    } else if (format === EXPORT_FORMATS.MARKDOWN) {
      content = formatEmailContent(email, VERBOSITY.FULL, {
        includeHeaders: true,
      });
    } else {
      content = JSON.stringify(email, null, 2);
    }

    fs.writeFileSync(filePath, content, 'utf8');

    // Handle attachments if requested
    let attachmentCount = 0;
    if (includeAttachments && email.hasAttachments) {
      const saved = await saveAttachments(accessToken, emailId, outputDir);
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
 */
async function saveAttachments(accessToken, emailId, outputDir) {
  const saved = [];

  try {
    const response = await callGraphAPI(
      accessToken,
      'GET',
      `me/messages/${emailId}/attachments`,
      null,
      { $select: 'id,name,contentBytes,size,contentType' }
    );

    if (!response.value) return saved;

    for (const att of response.value) {
      if (att.contentBytes) {
        const safeFilename = sanitizeFilename(att.name || 'attachment');
        const filePath = path.join(
          outputDir,
          `${emailId.substring(0, 8)}_${safeFilename}`
        );
        const buffer = Buffer.from(att.contentBytes, 'base64');
        fs.writeFileSync(filePath, buffer);
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
