/**
 * Token management for Microsoft Graph API authentication
 */
const fs = require('fs');
const config = require('../config');
const { log } = require('../utils/logger');

// Global variable to store tokens
let cachedTokens = null;

/**
 * Loads authentication tokens from the token file
 * @returns {object|null} - The loaded tokens or null if not available
 */
function loadTokenCache() {
  try {
    const tokenPath = config.AUTH_CONFIG.tokenStorePath;

    if (!fs.existsSync(tokenPath)) {
      return null;
    }

    const tokenData = fs.readFileSync(tokenPath, 'utf8');

    try {
      const tokens = JSON.parse(tokenData);

      if (!tokens.access_token) {
        return null;
      }

      const now = Date.now();
      const expiresAt = tokens.expires_at || 0;

      if (now > expiresAt) {
        return null;
      }

      cachedTokens = tokens;
      return tokens;
    } catch (parseError) {
      log.note('auth', 'token-cache-unreadable');
      log.debug('Error parsing token file:', parseError.message);
      return null;
    }
  } catch (error) {
    log.note('auth', 'token-cache-unreadable');
    log.debug('Error loading token cache:', error.message);
    return null;
  }
}

/**
 * Saves authentication tokens to the token file
 * @param {object} tokens - The tokens to save
 * @returns {boolean} - Whether the save was successful
 */
function saveTokenCache(tokens) {
  try {
    const tokenPath = config.AUTH_CONFIG.tokenStorePath;

    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), {
      mode: 0o600,
    });

    // Update the cache
    cachedTokens = tokens;
    return true;
  } catch (error) {
    log.note('auth', 'token-cache-save-failed');
    log.debug('Error saving token cache:', error);
    return false;
  }
}

/**
 * Gets the current access token, loading from cache if necessary
 * @returns {string|null} - The access token or null if not available
 */
function getAccessToken() {
  if (cachedTokens && cachedTokens.access_token) {
    return cachedTokens.access_token;
  }

  const tokens = loadTokenCache();
  return tokens ? tokens.access_token : null;
}

/**
 * Creates a test access token for use in test mode
 * @returns {object} - The test tokens
 */
function createTestTokens() {
  const testTokens = {
    access_token: `test_access_token_${Date.now()}`,
    refresh_token: `test_refresh_token_${Date.now()}`,
    expires_at: Date.now() + 3600 * 1000, // 1 hour
  };

  saveTokenCache(testTokens);
  return testTokens;
}

module.exports = {
  loadTokenCache,
  saveTokenCache,
  getAccessToken,
  createTestTokens,
};
