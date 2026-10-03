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
const { resolveClientId } = require('./auth/client-config');
const { redact } = require('./utils/logger');

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

// Shared/delegated mailbox access is OPT-IN (work/school accounts only).
// With OUTLOOK_SHARED_MAILBOX unset, sign-in requests exactly BASE_SCOPES —
// nobody's consent prompt or token changes unless they enable it:
//   OUTLOOK_SHARED_MAILBOX=read                 → Mail.Read.Shared
//   OUTLOOK_SHARED_MAILBOX=true|readwrite|1     → Mail.Read.Shared + Mail.ReadWrite.Shared
// Sending/drafts from a shared mailbox are out of scope (Mail.Send.Shared is
// never requested). When enabled, the device-code flow falls back to
// BASE_SCOPES only on errors proving the account can't use `.Shared` scopes
// (see auth/device-code.js isScopeConsentError); consent-required errors
// (AADSTS65001) surface remediation instead of downgrading.
const ALL_SHARED_SCOPES = ['Mail.Read.Shared', 'Mail.ReadWrite.Shared'];

/**
 * Parse OUTLOOK_SHARED_MAILBOX into a mode.
 * @param {string|undefined} raw
 * @returns {'off'|'read'|'readwrite'}
 */
function parseSharedMailboxMode(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'read') return 'read';
  if (['true', 'readwrite', '1'].includes(value)) return 'readwrite';
  if (value && !['false', '0', 'off', 'no'].includes(value)) {
    console.warn(
      // redact(): people sometimes put the shared mailbox's address here.
      `[outlook-assistant] OUTLOOK_SHARED_MAILBOX="${redact(raw)}" is not a recognised value. ` +
        'Expected read, true/readwrite/1, or unset. Shared-mailbox support stays off.'
    );
  }
  return 'off';
}

const SHARED_MAILBOX_MODE = parseSharedMailboxMode(
  process.env.OUTLOOK_SHARED_MAILBOX
);
const SHARED_SCOPES_BY_MODE = {
  off: [],
  read: ['Mail.Read.Shared'],
  readwrite: [...ALL_SHARED_SCOPES],
};
const SHARED_SCOPES = SHARED_SCOPES_BY_MODE[SHARED_MAILBOX_MODE];

// Base scopes consentable by ANY account type (personal + work/school).
const BASE_SCOPES = [
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
  // 'Place.Read.All',     // find-meeting-rooms tool
];

/**
 * Parse OUTLOOK_READ_ONLY. On: true/1/yes/on; off: unset, empty,
 * false/0/no/off (any case). Anything else fails closed (read-only on, with
 * a warning), because whoever set the variable meant to restrict the server.
 * @param {string|undefined} raw
 * @returns {boolean}
 */
function parseReadOnly(raw) {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['', 'false', '0', 'no', 'off'].includes(value)) return false;
  // Redacted and capped: the value is echoed only to spot a typo.
  console.warn(
    `[outlook-assistant] OUTLOOK_READ_ONLY="${redact(String(raw).slice(0, 40))}" is not a recognised value. ` +
      'Expected true, 1, yes or on to switch it on, or false, 0, no or off (or unset) to switch it off. Treating it as on: read-only mode is on.'
  );
  return true;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60000;

/**
 * Parse OUTLOOK_REQUEST_TIMEOUT_MS: per-attempt Graph inactivity timeout
 * (ms with no data received). Unset or invalid → 60000 (invalid values warn).
 * @param {string|undefined} raw
 * @returns {number}
 */
function parseRequestTimeoutMs(raw) {
  if (raw === undefined || String(raw).trim() === '') {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.warn(
      `[outlook-assistant] OUTLOOK_REQUEST_TIMEOUT_MS="${raw}" is not a positive integer. ` +
        `Using the default of ${DEFAULT_REQUEST_TIMEOUT_MS} ms.`
    );
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return value;
}

module.exports = {
  // Server information
  SERVER_NAME: 'outlook-assistant',
  SERVER_VERSION: require('./package.json').version,

  // Test mode setting
  USE_TEST_MODE: process.env.USE_TEST_MODE === 'true',

  // Read-only mode (OUTLOOK_READ_ONLY, #271): every tool call that isn't
  // classified `read` in utils/risk-classes.js is refused before it runs.
  READ_ONLY: parseReadOnly(process.env.OUTLOOK_READ_ONLY),
  parseReadOnly,

  // OAuth scope sets (exported so tests + the fallback logic can reference them)
  BASE_SCOPES,
  // `.Shared` scopes requested at sign-in for the configured mode ([] = off)
  SHARED_SCOPES,
  ALL_SHARED_SCOPES,
  // 'off' | 'read' | 'readwrite' — from OUTLOOK_SHARED_MAILBOX (opt-in)
  SHARED_MAILBOX_MODE,
  parseSharedMailboxMode,

  // Authentication configuration
  AUTH_CONFIG: {
    // Getter, resolved on every read: OUTLOOK_CLIENT_ID → MS_CLIENT_ID →
    // ~/.outlook-assistant-config.json (saved via `auth action=authenticate
    // clientId=…`), so a saved ID takes effect without a restart.
    get clientId() {
      return resolveClientId();
    },
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET || '',
    redirectUri: 'http://localhost:3333/auth/callback',
    // Base scopes, plus the `.Shared` scopes only when OUTLOOK_SHARED_MAILBOX
    // opts in. With the flag on, device-code auth falls back to
    // fallbackScopes (base only) when the account rejects `.Shared`.
    scopes: [...BASE_SCOPES, ...SHARED_SCOPES],
    fallbackScopes: BASE_SCOPES,
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

  // Per-attempt Graph inactivity timeout: an attempt that receives no data
  // for this many ms is abandoned (not an overall deadline). Throttled and
  // transient responses are retried by utils/graph-api.js.
  REQUEST_TIMEOUT_MS: parseRequestTimeoutMs(
    process.env.OUTLOOK_REQUEST_TIMEOUT_MS
  ),

  // Timezone — IANA zone (e.g. "Australia/Melbourne", "Europe/London",
  // "America/New_York"). Override per-deployment via OUTLOOK_DEFAULT_TIMEZONE.
  // Default preserves the historic value for backwards compatibility.
  DEFAULT_TIMEZONE:
    process.env.OUTLOOK_DEFAULT_TIMEZONE || 'Australia/Melbourne',
};
