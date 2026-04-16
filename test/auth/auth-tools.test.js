const fs = require('fs');
const path = require('path');

// Mock dependencies before requiring the module under test
jest.mock('../../auth/device-code');
jest.mock('../../auth/token-manager');
jest.mock('../../auth/token-storage');

const DEVICE_CODE_STATE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.outlook-assistant-pending-auth.json'
);

// Mock config
jest.mock('../../config', () => ({
  AUTH_CONFIG: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    scopes: ['offline_access', 'User.Read', 'Mail.Read'],
    tokenStorePath: '/tmp/test-tokens.json',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    authServerUrl: 'http://localhost:3333',
    defaultAuthMethod: 'device-code',
  },
  USE_TEST_MODE: false,
  SERVER_VERSION: '3.7.2',
  DEFAULT_TIMEZONE: 'Australia/Melbourne',
}));

const {
  handleDeviceCodeAuth,
  handleDeviceCodeComplete,
} = require('../../auth/tools');
const {
  initiateDeviceCodeFlow,
  pollForToken,
} = require('../../auth/device-code');
const TokenStorage = require('../../auth/token-storage');

describe('device code state persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    // Clean up any persisted state file
    try {
      fs.unlinkSync(DEVICE_CODE_STATE_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  afterEach(() => {
    console.error.mockRestore();
    try {
      fs.unlinkSync(DEVICE_CODE_STATE_PATH);
    } catch {
      // Ignore
    }
  });

  test('handleDeviceCodeComplete returns error when no state exists', async () => {
    // No in-memory state, no file on disk — test this FIRST before any initiation
    const result = await handleDeviceCodeComplete();
    expect(result.content[0].text).toContain('No pending device code flow');
  });

  test('handleDeviceCodeComplete loads state from disk when in-memory is lost', async () => {
    // Simulate: device code was initiated in a previous server process
    // Write state directly to disk (as if previous process saved it)
    const state = {
      deviceCode: 'device_code_from_disk',
      interval: 5,
      expiresIn: 900,
      expiresAt: Date.now() + 900 * 1000,
    };
    fs.writeFileSync(DEVICE_CODE_STATE_PATH, JSON.stringify(state), {
      mode: 0o600,
    });

    // Mock successful token response
    pollForToken.mockResolvedValue({
      access_token: 'test_access_token',
      refresh_token: 'test_refresh_token',
      expires_in: 3600,
      scope: 'User.Read Mail.Read',
      token_type: 'Bearer',
    });

    // Mock TokenStorage
    const mockInstance = {
      tokens: null,
      _saveTokensToFile: jest.fn().mockResolvedValue(undefined),
    };
    TokenStorage.mockImplementation(() => mockInstance);

    const result = await handleDeviceCodeComplete();

    // Should succeed using disk-persisted state
    expect(result.content[0].text).toContain('Authentication successful');
    expect(pollForToken).toHaveBeenCalledWith(
      'test-client-id',
      'device_code_from_disk',
      5,
      expect.any(Number)
    );

    // State file should be cleaned up
    expect(fs.existsSync(DEVICE_CODE_STATE_PATH)).toBe(false);
  });

  test('handleDeviceCodeAuth persists state to disk', async () => {
    initiateDeviceCodeFlow.mockResolvedValue({
      userCode: 'TESTCODE',
      verificationUri: 'https://microsoft.com/devicelogin',
      deviceCode: 'device_code_abc123',
      expiresIn: 900,
      interval: 5,
    });

    const result = await handleDeviceCodeAuth();

    // Should return the code to the user
    expect(result.content[0].text).toContain('TESTCODE');
    expect(result.content[0].text).toContain('microsoft.com/devicelogin');

    // Should have persisted state to disk
    expect(fs.existsSync(DEVICE_CODE_STATE_PATH)).toBe(true);
    const state = JSON.parse(fs.readFileSync(DEVICE_CODE_STATE_PATH, 'utf8'));
    expect(state.deviceCode).toBe('device_code_abc123');
    expect(state.interval).toBe(5);
    expect(state.expiresAt).toBeGreaterThan(Date.now());

    // Consume the in-memory state so it doesn't leak to subsequent tests
    pollForToken.mockRejectedValue(new Error('test cleanup'));
    TokenStorage.mockImplementation(() => ({
      tokens: null,
      _saveTokensToFile: jest.fn(),
    }));
    await handleDeviceCodeComplete();
  });

  test('handleDeviceCodeComplete cleans up expired state from disk', async () => {
    // Write expired state
    const state = {
      deviceCode: 'expired_code',
      interval: 5,
      expiresIn: 900,
      expiresAt: Date.now() - 60000, // Expired 1 minute ago
    };
    fs.writeFileSync(DEVICE_CODE_STATE_PATH, JSON.stringify(state));

    const result = await handleDeviceCodeComplete();
    expect(result.content[0].text).toContain('No pending device code flow');
    // Expired file should be cleaned up
    expect(fs.existsSync(DEVICE_CODE_STATE_PATH)).toBe(false);
  });

  test('handleDeviceCodeComplete saves auth_method in tokens', async () => {
    // Write valid state to disk
    const state = {
      deviceCode: 'device_code_test',
      interval: 5,
      expiresIn: 900,
      expiresAt: Date.now() + 900 * 1000,
    };
    fs.writeFileSync(DEVICE_CODE_STATE_PATH, JSON.stringify(state));

    pollForToken.mockResolvedValue({
      access_token: 'test_access_token',
      refresh_token: 'test_refresh_token',
      expires_in: 3600,
      scope: 'User.Read Mail.Read',
      token_type: 'Bearer',
    });

    let savedTokens = null;
    TokenStorage.mockImplementation(() => {
      const instance = {
        tokens: null,
        _saveTokensToFile: jest.fn().mockImplementation(function () {
          savedTokens = this.tokens;
          return Promise.resolve();
        }),
      };
      return instance;
    });

    await handleDeviceCodeComplete();

    // Verify auth_method was set
    expect(savedTokens).not.toBeNull();
    expect(savedTokens.auth_method).toBe('device-code');
  });

  test('state file has restrictive permissions (0o600)', async () => {
    initiateDeviceCodeFlow.mockResolvedValue({
      userCode: 'TESTCODE',
      verificationUri: 'https://microsoft.com/devicelogin',
      deviceCode: 'device_code_perms_test',
      expiresIn: 900,
      interval: 5,
    });

    await handleDeviceCodeAuth();

    const stats = fs.statSync(DEVICE_CODE_STATE_PATH);
    // Check owner-only permissions (0o600 = rw-------)
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
