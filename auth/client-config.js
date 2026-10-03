/**
 * Runtime-supplied Azure Application (client) ID.
 *
 * Plugin marketplaces (GitHub Copilot, Cursor — Agent Plugins 1.0) ship a
 * static `mcp.json` with no way to prompt for settings, so users there can't
 * set OUTLOOK_CLIENT_ID. Device-code sign-in only needs the client ID (never
 * the secret), so the `auth` tool accepts it at runtime and it's persisted to
 * `~/.outlook-assistant-config.json`.
 *
 * Precedence: OUTLOOK_CLIENT_ID env → MS_CLIENT_ID env (legacy) → saved file.
 *
 * Deliberately does NOT require ../config (config.js requires this module).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_FILE_NAME = '.outlook-assistant-config.json';

// Azure Application (client) IDs are GUIDs.
const CLIENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Path of the persisted config file. Resolved per call (not at load) so a
 * changed HOME — e.g. in tests — is honoured.
 * @returns {string}
 */
function getConfigPath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(homeDir, CONFIG_FILE_NAME);
}

/**
 * @param {unknown} id
 * @returns {boolean} - true when `id` (trimmed) is a GUID
 */
function isValidClientId(id) {
  return typeof id === 'string' && CLIENT_ID_RE.test(id.trim());
}

/**
 * Read the whole config file. Never throws.
 * @returns {object} - Parsed object, or {} when missing/unreadable/not an object
 */
function readConfigFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

/**
 * The saved client ID, or '' when there is none or it isn't a valid GUID.
 * Never throws.
 * @returns {string}
 */
function loadSavedClientId() {
  const { clientId } = readConfigFile();
  return isValidClientId(clientId) ? clientId.trim() : '';
}

/**
 * Validate and persist a client ID (mode 0600, temp file + rename), keeping
 * any other keys already in the file.
 * @param {string} id
 * @returns {string} - The normalised (trimmed) ID that was saved
 * @throws {Error} - When `id` isn't a GUID or the write fails
 */
function saveClientId(id) {
  if (!isValidClientId(id)) {
    throw new Error(
      'Invalid client ID: expected the Application (client) ID GUID from your Azure app registration.'
    );
  }
  const clientId = id.trim();
  const filePath = getConfigPath();
  const data = { ...readConfigFile(), clientId };
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Temp file was never created or is already gone
    }
    throw error;
  }
  return clientId;
}

/**
 * Which environment variable supplies the client ID, if any.
 * @returns {{name: string, value: string}|null}
 */
function getEnvClientId() {
  if (process.env.OUTLOOK_CLIENT_ID) {
    return { name: 'OUTLOOK_CLIENT_ID', value: process.env.OUTLOOK_CLIENT_ID };
  }
  if (process.env.MS_CLIENT_ID) {
    return { name: 'MS_CLIENT_ID', value: process.env.MS_CLIENT_ID };
  }
  return null;
}

/**
 * Effective client ID: env (OUTLOOK_CLIENT_ID, then legacy MS_CLIENT_ID),
 * then the saved file, then ''.
 * @returns {string}
 */
function resolveClientId() {
  const env = getEnvClientId();
  return env ? env.value : loadSavedClientId();
}

/**
 * @returns {'env'|'saved'|'none'} - Where the effective client ID comes from
 */
function getClientIdSource() {
  if (getEnvClientId()) return 'env';
  return loadSavedClientId() ? 'saved' : 'none';
}

module.exports = {
  CONFIG_FILE_NAME,
  getConfigPath,
  isValidClientId,
  loadSavedClientId,
  saveClientId,
  getEnvClientId,
  resolveClientId,
  getClientIdSource,
};
