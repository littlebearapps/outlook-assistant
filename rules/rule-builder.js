/**
 * Shared rule builder utilities for creating and updating mail rules.
 * Converts flat MCP tool parameters into Microsoft Graph API rule objects.
 */
const { resolveFolder, looksLikeFolderId } = require('../folder/resolve');
const { checkRecipientAllowlist } = require('../utils/safety');

const VALID_IMPORTANCE = ['low', 'normal', 'high'];
const VALID_SENSITIVITY = ['normal', 'personal', 'private', 'confidential'];

/**
 * Parse a comma-separated string into a trimmed, non-empty array.
 * @param {string} str - Comma-separated values
 * @returns {string[]}
 */
function parseCommaSeparated(str) {
  if (!str) return [];
  return str
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Convert a comma-separated email string into Graph API recipient objects.
 * @param {string} emailString - Comma-separated email addresses
 * @returns {Array<{emailAddress: {address: string}}>}
 */
function formatRecipientObjects(emailString) {
  return parseCommaSeparated(emailString).map((email) => ({
    emailAddress: { address: email },
  }));
}

/**
 * Build a Graph API conditions object from flat tool parameters.
 * @param {object} args - Tool arguments
 * @returns {{ conditions: object, warnings: string[] }}
 */
function buildConditions(args) {
  const conditions = {};
  const warnings = [];

  // String collections (comma-separated → array with OR logic)
  if (args.containsSubject) {
    conditions.subjectContains = parseCommaSeparated(args.containsSubject);
  }
  if (args.bodyContains) {
    conditions.bodyContains = parseCommaSeparated(args.bodyContains);
  }
  if (args.bodyOrSubjectContains) {
    conditions.bodyOrSubjectContains = parseCommaSeparated(
      args.bodyOrSubjectContains
    );
  }
  if (args.senderContains) {
    conditions.senderContains = parseCommaSeparated(args.senderContains);
  }
  if (args.recipientContains) {
    conditions.recipientContains = parseCommaSeparated(args.recipientContains);
  }

  // Recipient collections (comma-separated emails → recipient objects)
  if (args.fromAddresses) {
    const recipients = formatRecipientObjects(args.fromAddresses);
    if (recipients.length > 0) {
      conditions.fromAddresses = recipients;
    }
  }
  if (args.sentToAddresses) {
    const recipients = formatRecipientObjects(args.sentToAddresses);
    if (recipients.length > 0) {
      conditions.sentToAddresses = recipients;
    }
  }

  // Boolean conditions
  if (args.hasAttachments === true) conditions.hasAttachment = true;
  if (args.sentToMe === true) conditions.sentToMe = true;
  if (args.sentOnlyToMe === true) conditions.sentOnlyToMe = true;
  if (args.sentCcMe === true) conditions.sentCcMe = true;
  if (args.isAutomaticReply === true) conditions.isAutomaticReply = true;

  // Enum conditions
  if (args.importance) {
    if (!VALID_IMPORTANCE.includes(args.importance)) {
      warnings.push(
        `Invalid importance "${args.importance}". Must be: ${VALID_IMPORTANCE.join(', ')}`
      );
    } else {
      conditions.importance = args.importance;
    }
  }
  if (args.sensitivity) {
    if (!VALID_SENSITIVITY.includes(args.sensitivity)) {
      warnings.push(
        `Invalid sensitivity "${args.sensitivity}". Must be: ${VALID_SENSITIVITY.join(', ')}`
      );
    } else {
      conditions.sensitivity = args.sensitivity;
    }
  }

  return { conditions, warnings };
}

/**
 * Resolve a rule's target folder (ID, well-known alias, nested path such as
 * "Triage/Delete", or bare name) to a folder ID with the shared resolver. (#248)
 * Not-found and ambiguous folders become a warning containing "not found", which
 * create/update treat as fatal when no other action is left; any other failure
 * (auth, network, Graph outage) is rethrown rather than misreported.
 * @param {string} accessToken - Graph API access token
 * @param {string} folder - Folder ID, alias, path, or name
 * @param {string} label - Warning prefix, e.g. "Target folder"
 * @returns {Promise<{ folderId?: string, warning?: string }>}
 */
async function resolveRuleFolder(accessToken, folder, label) {
  const spec = looksLikeFolderId(folder)
    ? { id: folder.trim() }
    : { name: folder };
  try {
    const resolved = await resolveFolder(accessToken, spec);
    return { folderId: resolved.id };
  } catch (error) {
    const message = error.message || '';
    if (message.includes('ambiguous')) {
      return {
        warning: `${label} "${folder}" not found as a single folder. ${message}`,
      };
    }
    if (
      message.includes('not found') ||
      message.startsWith('Invalid folder path') ||
      /status (400|404):/.test(message)
    ) {
      // The resolver's reason follows (an empty path segment, Graph's 400 text);
      // its own not-found message already carries the action=list guidance.
      const hint = message.includes('action=list')
        ? ''
        : ' Use `folders` action=list to see folders (with IDs and full paths), or pass a path like "Parent/Child" or a folderId.';
      return {
        warning: `${label} "${folder}" not found. ${message}${hint}`,
      };
    }
    throw error;
  }
}

/**
 * Build a Graph API actions object from flat tool parameters.
 * Async because folder resolution requires API calls.
 * @param {object} args - Tool arguments
 * @param {string} accessToken - Graph API access token
 * @returns {Promise<{ actions: object, warnings: string[] }>}
 */
async function buildActions(args, accessToken) {
  const actions = {};
  const warnings = [];

  // Folder-based actions (ID, alias, nested path or name → ID)
  const folderActions = [
    ['moveToFolder', 'Target folder'],
    ['copyToFolder', 'Copy-to folder'],
  ];
  for (const [param, label] of folderActions) {
    if (args[param]) {
      const { folderId, warning } = await resolveRuleFolder(
        accessToken,
        args[param],
        label
      );
      if (folderId) {
        actions[param] = folderId;
      } else {
        warnings.push(warning);
      }
    }
  }

  // Boolean actions
  if (args.markAsRead === true) actions.markAsRead = true;
  if (args.stopProcessingRules === true) actions.stopProcessingRules = true;
  if (args.deleteMessage === true) {
    actions.delete = true;
    warnings.push('This rule will move matching messages to Deleted Items.');
  }

  // Enum actions
  if (args.markImportance) {
    if (!VALID_IMPORTANCE.includes(args.markImportance)) {
      warnings.push(
        `Invalid markImportance "${args.markImportance}". Must be: ${VALID_IMPORTANCE.join(', ')}`
      );
    } else {
      actions.markImportance = args.markImportance;
    }
  }

  // Recipient-based actions (comma-separated emails → recipient objects)
  if (args.forwardTo) {
    const recipients = formatRecipientObjects(args.forwardTo);
    if (recipients.length > 0) {
      // Check allowlist if configured
      const allowlistError = checkRecipientAllowlist(recipients);
      if (allowlistError) {
        warnings.push(
          `Forward recipients blocked by allowlist: ${args.forwardTo}`
        );
      } else {
        actions.forwardTo = recipients;
        warnings.push(
          `This rule will forward all matching emails to: ${args.forwardTo}. Verify these addresses are correct.`
        );
      }
    }
  }
  if (args.redirectTo) {
    const recipients = formatRecipientObjects(args.redirectTo);
    if (recipients.length > 0) {
      const allowlistError = checkRecipientAllowlist(recipients);
      if (allowlistError) {
        warnings.push(
          `Redirect recipients blocked by allowlist: ${args.redirectTo}`
        );
      } else {
        actions.redirectTo = recipients;
        warnings.push(
          `This rule will redirect all matching emails to: ${args.redirectTo}. The original sender will appear as the sender.`
        );
      }
    }
  }

  // Category actions
  if (args.assignCategories) {
    actions.assignCategories = parseCommaSeparated(args.assignCategories);
  }

  return { actions, warnings };
}

/**
 * Build a Graph API exceptions object from except* prefixed parameters.
 * @param {object} args - Tool arguments
 * @returns {{ exceptions: object, warnings: string[] }}
 */
function buildExceptions(args) {
  const exceptions = {};
  const warnings = [];

  if (args.exceptFromAddresses) {
    const recipients = formatRecipientObjects(args.exceptFromAddresses);
    if (recipients.length > 0) {
      exceptions.fromAddresses = recipients;
    }
  }
  if (args.exceptSubjectContains) {
    exceptions.subjectContains = parseCommaSeparated(
      args.exceptSubjectContains
    );
  }
  if (args.exceptSenderContains) {
    exceptions.senderContains = parseCommaSeparated(args.exceptSenderContains);
  }
  if (args.exceptBodyContains) {
    exceptions.bodyContains = parseCommaSeparated(args.exceptBodyContains);
  }
  if (args.exceptHasAttachments === true) {
    exceptions.hasAttachment = true;
  }

  return { exceptions, warnings };
}

/**
 * Check if any condition was provided in the args.
 * @param {object} args - Tool arguments
 * @returns {boolean}
 */
function hasAnyCondition(args) {
  return Boolean(
    args.fromAddresses ||
    args.containsSubject ||
    args.hasAttachments === true ||
    args.bodyContains ||
    args.bodyOrSubjectContains ||
    args.senderContains ||
    args.recipientContains ||
    args.sentToAddresses ||
    args.importance ||
    args.sensitivity ||
    args.sentToMe === true ||
    args.sentOnlyToMe === true ||
    args.sentCcMe === true ||
    args.isAutomaticReply === true
  );
}

/**
 * Check if any action was provided in the args.
 * @param {object} args - Tool arguments
 * @returns {boolean}
 */
function hasAnyAction(args) {
  return Boolean(
    args.moveToFolder ||
    args.copyToFolder ||
    args.markAsRead === true ||
    args.markImportance ||
    args.forwardTo ||
    args.redirectTo ||
    args.assignCategories ||
    args.stopProcessingRules === true ||
    args.deleteMessage === true
  );
}

module.exports = {
  VALID_IMPORTANCE,
  VALID_SENSITIVITY,
  parseCommaSeparated,
  formatRecipientObjects,
  buildConditions,
  buildActions,
  buildExceptions,
  hasAnyCondition,
  hasAnyAction,
};
