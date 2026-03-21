/**
 * Configuration for Outlook Assistant Server
 *
 * Token-efficient configuration with field presets and response limits.
 */
const path = require('path');
const os = require('os');

// Import new utility modules
const {
  FIELD_PRESETS,
  FOLDER_FIELDS,
  getEmailFields,
  getFolderFields,
} = require('./utils/field-presets');
const { VERBOSITY, DEFAULT_LIMITS } = require('./utils/response-formatter');

// Ensure we have a home directory path — never fall back to /tmp (world-readable)
const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
if (!homeDir) {
  throw new Error(
    'Cannot determine home directory. Set HOME or USERPROFILE environment variable.'
  );
}

module.exports = {
  // Server information
  SERVER_NAME: 'outlook-assistant',
  SERVER_VERSION: require('./package.json').version,

  // Test mode setting
  USE_TEST_MODE: process.env.USE_TEST_MODE === 'true',

  // Authentication configuration
  AUTH_CONFIG: {
    clientId: process.env.OUTLOOK_CLIENT_ID || '',
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET || '',
    redirectUri: 'http://localhost:3333/auth/callback',
    scopes: [
      'offline_access',
      'User.Read',
      'Mail.Read',
      'Mail.ReadWrite',
      'Mail.Send',
      'Calendars.Read',
      'Calendars.ReadWrite',
      'Contacts.Read',
      'Contacts.ReadWrite',
      'People.Read',
      'MailboxSettings.ReadWrite',
      // Org-dependent scopes (work/school accounts only):
      // 'Mail.Read.Shared',   // access-shared-mailbox tool
      // 'Place.Read.All',     // find-meeting-rooms tool
    ],
    tokenStorePath: path.join(homeDir, '.outlook-assistant-tokens.json'),
    authServerUrl: 'http://localhost:3333',
    deviceCodeEndpoint:
      'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    defaultAuthMethod: process.env.OUTLOOK_AUTH_METHOD || 'device-code',
  },

  // Microsoft Graph API
  GRAPH_API_ENDPOINT: 'https://graph.microsoft.com/v1.0/',

  // Calendar constants
  CALENDAR_SELECT_FIELDS:
    'id,subject,bodyPreview,start,end,location,organizer,attendees,isAllDay,isCancelled',

  // Email field presets (use getEmailFields() for dynamic selection)
  FIELD_PRESETS,
  getEmailFields,

  // Legacy email fields (kept for backward compatibility)
  EMAIL_SELECT_FIELDS: getEmailFields('list'),
  EMAIL_DETAIL_FIELDS: getEmailFields('read'),
  EMAIL_FORENSIC_FIELDS: getEmailFields('forensic'),
  EMAIL_EXPORT_FIELDS: getEmailFields('export'),

  // Folder field presets
  FOLDER_FIELDS,
  getFolderFields,

  // Verbosity levels for response formatting
  VERBOSITY,

  // Default limits for token efficiency
  DEFAULT_LIMITS,

  // Pagination (updated to use DEFAULT_LIMITS)
  DEFAULT_PAGE_SIZE: DEFAULT_LIMITS.listEmails,
  MAX_RESULT_COUNT: 100, // Increased for batch operations

  // Search defaults (reduced for token efficiency)
  DEFAULT_SEARCH_RESULTS: DEFAULT_LIMITS.searchEmails,

  // Immutable IDs (opt-in: IDs persist through folder moves)
  USE_IMMUTABLE_IDS: process.env.OUTLOOK_IMMUTABLE_IDS === 'true',

  // Timezone
  DEFAULT_TIMEZONE: 'Australia/Melbourne', // Updated for Nathan's timezone
};
