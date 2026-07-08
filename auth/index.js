/**
 * Authentication module for Outlook Assistant server
 */
const tokenManager = require('./token-manager');
const TokenStorage = require('./token-storage');
const config = require('../config');
const { authTools, setToolCount } = require('./tools');
const {
  ClientCredentialsProvider,
  validateClientCredentialsConfig,
} = require('./client-credentials');

// Singleton TokenStorage instance with auto-refresh support
const tokenStorage = new TokenStorage({
  clientId: config.AUTH_CONFIG.clientId,
  clientSecret: config.AUTH_CONFIG.clientSecret,
  tokenStorePath: config.AUTH_CONFIG.tokenStorePath,
  scopes: config.AUTH_CONFIG.scopes,
  tokenEndpoint: config.AUTH_CONFIG.tokenEndpoint,
});

const clientCredentialsProvider = new ClientCredentialsProvider({
  tenantId: config.CLIENT_CREDENTIALS_CONFIG.tenantId,
  clientId: config.AUTH_CONFIG.clientId,
  certPath: config.CLIENT_CREDENTIALS_CONFIG.certPath,
  keyPath: config.CLIENT_CREDENTIALS_CONFIG.keyPath,
  targetUser: config.CLIENT_CREDENTIALS_CONFIG.targetUser,
});

function isClientCredentialsAuth() {
  return config.AUTH_CONFIG.defaultAuthMethod === 'client-credentials';
}

function validateActiveAuthConfig() {
  if (!isClientCredentialsAuth()) {
    return;
  }
  validateClientCredentialsConfig({
    authConfig: config.AUTH_CONFIG,
    clientCredentialsConfig: config.CLIENT_CREDENTIALS_CONFIG,
  });
}

/**
 * Ensures the user is authenticated and returns an access token.
 * Automatically refreshes expired tokens via tokenStorage.
 * @param {boolean} forceNew - Whether to force a new authentication
 * @returns {Promise<string>} - Access token
 * @throws {Error} - If authentication fails
 */
async function ensureAuthenticated(forceNew = false) {
  if (forceNew) {
    throw new Error('Authentication required');
  }

  if (isClientCredentialsAuth()) {
    validateActiveAuthConfig();
    return clientCredentialsProvider.getValidAccessToken();
  }

  const accessToken = await tokenStorage.getValidAccessToken();
  if (!accessToken) {
    throw new Error('Authentication required');
  }

  return accessToken;
}

module.exports = {
  tokenManager, // deprecated: use tokenStorage
  tokenStorage,
  clientCredentialsProvider,
  authTools,
  setToolCount,
  ensureAuthenticated,
  isClientCredentialsAuth,
  validateActiveAuthConfig,
};
