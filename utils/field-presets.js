/**
 * Field selection presets for Microsoft Graph API email queries
 *
 * Named presets for common use cases to optimize API calls
 * and reduce response size/token usage.
 */

/**
 * Field presets for different use cases
 */
const FIELD_PRESETS = {
  /**
   * Minimal fields for listing/scanning emails
   * Use case: Quick folder scan, batch operations needing just IDs
   */
  list: ['id', 'subject', 'from', 'receivedDateTime', 'isRead'],

  /**
   * Minimal fields for reading a single email
   * Use case: Quick read at minimal verbosity (includes bodyPreview + toRecipients)
   */
  'read-minimal': [
    'id',
    'subject',
    'from',
    'toRecipients',
    'receivedDateTime',
    'bodyPreview',
    'hasAttachments',
    'importance',
    'isRead',
  ],

  /**
   * Standard fields for reading email content
   * Use case: Viewing email details with body
   */
  read: [
    'id',
    'subject',
    'from',
    'toRecipients',
    'ccRecipients',
    'receivedDateTime',
    'body',
    'bodyPreview',
    'hasAttachments',
    'importance',
    'isRead',
  ],

  /**
   * Extended fields for legal/forensic use
   * Use case: Evidence collection, compliance, legal review
   */
  forensic: [
    'id',
    'subject',
    'from',
    'toRecipients',
    'ccRecipients',
    'bccRecipients',
    'receivedDateTime',
    'sentDateTime',
    'body',
    'bodyPreview',
    'hasAttachments',
    'importance',
    'isRead',
    'internetMessageHeaders',
    'internetMessageId',
    'conversationId',
    'conversationIndex',
    'parentFolderId',
  ],

  /**
   * Full fields for export operations
   * Use case: Complete email backup, migration, archival
   */
  export: [
    'id',
    'subject',
    'from',
    'toRecipients',
    'ccRecipients',
    'bccRecipients',
    'replyTo',
    'receivedDateTime',
    'sentDateTime',
    'createdDateTime',
    'lastModifiedDateTime',
    'body',
    'bodyPreview',
    'hasAttachments',
    'importance',
    'isRead',
    'isDraft',
    'internetMessageHeaders',
    'internetMessageId',
    'conversationId',
    'conversationIndex',
    'parentFolderId',
    'categories',
    'flag',
    'webLink',
    'changeKey',
  ],

  /**
   * Search result fields (optimized for relevance display)
   * Use case: Search results with context
   */
  search: [
    'id',
    'subject',
    'from',
    'toRecipients',
    'receivedDateTime',
    'bodyPreview',
    'hasAttachments',
    'importance',
    'isRead',
    'parentFolderId',
  ],

  /**
   * Delta query fields (for incremental sync)
   * Use case: Tracking changes in folder
   */
  delta: [
    'id',
    'subject',
    'from',
    'receivedDateTime',
    'isRead',
    'parentFolderId',
    'changeKey',
  ],

  /**
   * Conversation fields (for thread grouping)
   * Use case: Viewing email threads
   */
  conversation: [
    'id',
    'subject',
    'from',
    'toRecipients',
    'receivedDateTime',
    'bodyPreview',
    'conversationId',
    'conversationIndex',
    'isRead',
  ],
};

/**
 * Extended email fields (comprehensive list)
 * Used as reference for export preset
 */
const EXTENDED_EMAIL_FIELDS = [
  'id',
  'subject',
  'from',
  'sender',
  'toRecipients',
  'ccRecipients',
  'bccRecipients',
  'replyTo',
  'receivedDateTime',
  'sentDateTime',
  'createdDateTime',
  'lastModifiedDateTime',
  'body',
  'bodyPreview',
  'hasAttachments',
  'importance',
  'isRead',
  'isDraft',
  'isDeliveryReceiptRequested',
  'isReadReceiptRequested',
  'internetMessageHeaders',
  'internetMessageId',
  'conversationId',
  'conversationIndex',
  'parentFolderId',
  'categories',
  'flag',
  'webLink',
  'changeKey',
  'inferenceClassification',
];

/**
 * Folder fields for folder operations
 */
const FOLDER_FIELDS = {
  /**
   * Basic folder info
   */
  basic: ['id', 'displayName', 'parentFolderId'],

  /**
   * Folder with item counts
   */
  withCounts: [
    'id',
    'displayName',
    'parentFolderId',
    'totalItemCount',
    'unreadItemCount',
  ],

  /**
   * Full folder details
   * Note: sizeInBytes is NOT available on mailFolder resource type
   */
  full: [
    'id',
    'displayName',
    'parentFolderId',
    'childFolderCount',
    'totalItemCount',
    'unreadItemCount',
    'isHidden',
  ],
};

/**
 * Gets field selection string for Graph API $select parameter
 * @param {string} preset - Preset name (list, read, forensic, export, search, delta, conversation)
 * @returns {string} - Comma-separated field list
 */
function getEmailFields(preset = 'list') {
  const fields = FIELD_PRESETS[preset];
  if (!fields) {
    console.error(`Unknown preset: ${preset}, falling back to 'list'`);
    return FIELD_PRESETS.list.join(',');
  }
  return fields.join(',');
}

/**
 * Gets folder field selection string
 * @param {string} preset - Preset name (basic, withCounts, full)
 * @returns {string} - Comma-separated field list
 */
function getFolderFields(preset = 'basic') {
  const fields = FOLDER_FIELDS[preset];
  if (!fields) {
    console.error(`Unknown folder preset: ${preset}, falling back to 'basic'`);
    return FOLDER_FIELDS.basic.join(',');
  }
  return fields.join(',');
}

/**
 * Builds custom field selection from array
 * @param {Array<string>} fields - Array of field names
 * @returns {string} - Comma-separated field list
 */
function buildFieldSelection(fields) {
  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return getEmailFields('list');
  }
  return fields.join(',');
}

/**
 * Merges preset with additional fields
 * @param {string} preset - Base preset name
 * @param {Array<string>} additionalFields - Extra fields to include
 * @returns {string} - Combined field selection
 */
function mergeFields(preset, additionalFields = []) {
  const baseFields = FIELD_PRESETS[preset] || FIELD_PRESETS.list;
  const merged = [...new Set([...baseFields, ...additionalFields])];
  return merged.join(',');
}

/**
 * Validates that requested fields are valid Graph API fields
 * @param {Array<string>} fields - Fields to validate
 * @returns {object} - { valid: Array, invalid: Array }
 */
function validateFields(fields) {
  const validFields = new Set(EXTENDED_EMAIL_FIELDS);
  const result = { valid: [], invalid: [] };

  fields.forEach((field) => {
    if (validFields.has(field)) {
      result.valid.push(field);
    } else {
      result.invalid.push(field);
    }
  });

  return result;
}

module.exports = {
  FIELD_PRESETS,
  EXTENDED_EMAIL_FIELDS,
  FOLDER_FIELDS,
  getEmailFields,
  getFolderFields,
  buildFieldSelection,
  mergeFields,
  validateFields,
};
