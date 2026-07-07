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

/**
 * Resolve the OAuth audience segment used in Microsoft Graph endpoints.
 *
 * Microsoft's identity platform v2.0 routes by audience:
 *   - `common`         — personal AND work/school accounts (multi-tenant + personal)
 *   - `consumers`      — personal Microsoft accounts only
 *   - `organizations`  — work/school accounts only
 *   - `<tenant-guid>`  — single-tenant
 *
 * The right value depends on the Azure app registration's "Supported account
 * types" setting. An app registered as "Personal Microsoft accounts only" is
 * rejected by `/common/` with `AADSTS9002331` and must use `/consumers/`;
 * a single-tenant app must use its tenant GUID; etc.
 *
 * Defaulting to `common` preserves existing behaviour. Set
 * `OUTLOOK_AUTH_AUDIENCE` to override.
 */
const AUTH_AUDIENCE = process.env.OUTLOOK_AUTH_AUDIENCE || 'common';

function parseExtraScopes(value) {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

// Surface obvious misconfigurations at startup rather than failing later with a
// cryptic AADSTS error from Microsoft. Warn rather than throw so we never break
// an existing deployment on upgrade — Graph itself remains the source of truth
// for what audiences it accepts.
const VALID_AUDIENCE_LITERALS = new Set([
  'common',
  'consumers',
  'organizations',
]);
const TENANT_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (
  !VALID_AUDIENCE_LITERALS.has(AUTH_AUDIENCE) &&
  !TENANT_GUID_RE.test(AUTH_AUDIENCE)
) {
  console.warn(
    `[outlook-assistant] OUTLOOK_AUTH_AUDIENCE="${AUTH_AUDIENCE}" is not a recognised value. ` +
      `Expected one of: common, consumers, organizations, or a tenant GUID. ` +
      `Proceeding anyway — Microsoft's identity platform will reject it at runtime if invalid.`
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
      ...parseExtraScopes(process.env.OUTLOOK_EXTRA_SCOPES),
      // Org-dependent scopes (work/school accounts only):
      // 'Calendars.Read.Shared', // find-meeting-times tool
      // 'Mail.Read.Shared',   // access-shared-mailbox tool
      // 'Place.Read.All',     // find-meeting-rooms tool
      // 'User.Read.All',      // search-people manager/directReports actions
    ],
    tokenStorePath: path.join(homeDir, '.outlook-assistant-tokens.json'),
    authServerUrl: 'http://localhost:3333',
    audience: AUTH_AUDIENCE,
    deviceCodeEndpoint: `https://login.microsoftonline.com/${AUTH_AUDIENCE}/oauth2/v2.0/devicecode`,
    tokenEndpoint: `https://login.microsoftonline.com/${AUTH_AUDIENCE}/oauth2/v2.0/token`,
    authorizeEndpoint: `https://login.microsoftonline.com/${AUTH_AUDIENCE}/oauth2/v2.0/authorize`,
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

  // Timezone — IANA zone (e.g. "Australia/Melbourne", "Europe/London",
  // "America/New_York"). Override per-deployment via OUTLOOK_DEFAULT_TIMEZONE.
  // Default preserves the historic value for backwards compatibility.
  DEFAULT_TIMEZONE:
    process.env.OUTLOOK_DEFAULT_TIMEZONE || 'Australia/Melbourne',
};
