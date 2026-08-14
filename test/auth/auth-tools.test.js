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
    scopes: [
      'offline_access',
      'User.Read',
      'Mail.Read',
      'Mail.Read.Shared',
      'Mail.ReadWrite.Shared',
    ],
    fallbackScopes: ['offline_access', 'User.Read', 'Mail.Read'],
    tokenStorePath: '/tmp/test-tokens.json',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    authServerUrl: 'http://localhost:3333',
    defaultAuthMethod: 'device-code',
  },
  USE_TEST_MODE: false,
  SERVER_VERSION: '3.9.0',
  DEFAULT_TIMEZONE: 'Australia/Melbourne',
}));

const {
  handleDeviceCodeAuth,
  handleDeviceCodeComplete,
  handleAbout,
} = require('../../auth/tools');
jest.mock('../../utils/graph-api');
const { callGraphAPI } = require('../../utils/graph-api');
jest.mock('../../auth', () => ({
  ensureAuthenticated: jest.fn().mockResolvedValue('test-token'),
}));
const {
  initiateDeviceCodeFlow,
  pollForToken,
  isScopeConsentError,
  isConsentRequiredError,
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
    // POSIX mode bits are meaningless on Windows — Node reports 0o666 there
    // regardless of the mode passed to writeFileSync.
    if (process.platform !== 'win32') {
      // Check owner-only permissions (0o600 = rw-------)
      expect(stats.mode & 0o777).toBe(0o600);
    }
    expect(stats.isFile()).toBe(true);
  });
});

describe('device code scope fallback + granted_scopes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      fs.unlinkSync(DEVICE_CODE_STATE_PATH);
    } catch {
      // Ignore
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

  test('persists granted_scopes derived from token response scope', async () => {
    const state = {
      deviceCode: 'dc_full',
      interval: 5,
      expiresIn: 900,
      expiresAt: Date.now() + 900 * 1000,
      scopesUsed: 'full',
    };
    fs.writeFileSync(DEVICE_CODE_STATE_PATH, JSON.stringify(state));

    pollForToken.mockResolvedValue({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'offline_access User.Read Mail.Read Mail.Read.Shared',
      token_type: 'Bearer',
    });

    let savedTokens = null;
    TokenStorage.mockImplementation(() => ({
      tokens: null,
      _saveTokensToFile: jest.fn().mockImplementation(function () {
        savedTokens = this.tokens;
        return Promise.resolve();
      }),
    }));

    const result = await handleDeviceCodeComplete();
    expect(result.content[0].text).toContain('Authentication successful');
    expect(savedTokens.granted_scopes).toEqual([
      'offline_access',
      'User.Read',
      'Mail.Read',
      'Mail.Read.Shared',
    ]);
  });

  test('falls back to base scopes when full-scope flow hits scope-consent error', async () => {
    const state = {
      deviceCode: 'dc_full',
      interval: 5,
      expiresIn: 900,
      expiresAt: Date.now() + 900 * 1000,
      scopesUsed: 'full',
    };
    fs.writeFileSync(DEVICE_CODE_STATE_PATH, JSON.stringify(state));

    const scopeErr = new Error('AADSTS650053');
    pollForToken.mockRejectedValue(scopeErr);
    isScopeConsentError.mockReturnValue(true);

    // The re-issued (base-scopes) device code
    initiateDeviceCodeFlow.mockResolvedValue({
      userCode: 'NEWCODE',
      verificationUri: 'https://microsoft.com/devicelogin',
      deviceCode: 'dc_base',
      expiresIn: 900,
      interval: 5,
    });

    const result = await handleDeviceCodeComplete();

    // Re-issued with the base/fallback scopes
    expect(initiateDeviceCodeFlow).toHaveBeenCalledWith('test-client-id', [
      'offline_access',
      'User.Read',
      'Mail.Read',
    ]);
    expect(result.content[0].text).toContain('NEWCODE');
    expect(result.content[0].text).toContain("doesn't support shared-mailbox");

    // The new (base) pending state should be persisted with scopesUsed=base
    const persisted = JSON.parse(
      fs.readFileSync(DEVICE_CODE_STATE_PATH, 'utf8')
    );
    expect(persisted.scopesUsed).toBe('base');
    expect(persisted.deviceCode).toBe('dc_base');
  });

  test('surfaces a real error when a scope error recurs on base scopes', async () => {
    const state = {
      deviceCode: 'dc_base',
      interval: 5,
      expiresIn: 900,
      expiresAt: Date.now() + 900 * 1000,
      scopesUsed: 'base',
    };
    fs.writeFileSync(DEVICE_CODE_STATE_PATH, JSON.stringify(state));

    pollForToken.mockRejectedValue(new Error('AADSTS650053 still failing'));
    isScopeConsentError.mockReturnValue(true);

    const result = await handleDeviceCodeComplete();
    expect(result.content[0].text).toContain('Authentication failed');
    // Should NOT have attempted another re-issue
    expect(initiateDeviceCodeFlow).not.toHaveBeenCalled();
  });

  test('AADSTS65001 surfaces a consent remediation message, not a new device code', async () => {
    const state = {
      deviceCode: 'dc_full',
      interval: 5,
      expiresIn: 900,
      expiresAt: Date.now() + 900 * 1000,
      scopesUsed: 'full',
    };
    fs.writeFileSync(DEVICE_CODE_STATE_PATH, JSON.stringify(state));

    const consentErr = new Error('AADSTS65001: not consented');
    consentErr.oauth = { error: 'invalid_grant', error_codes: [65001] };
    pollForToken.mockRejectedValue(consentErr);
    isScopeConsentError.mockReturnValue(false);
    isConsentRequiredError.mockReturnValue(true);

    const result = await handleDeviceCodeComplete();

    expect(initiateDeviceCodeFlow).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('AADSTS65001');
    expect(result.content[0].text).toMatch(/administrator may need to grant/i);
    expect(result.content[0].text).toMatch(/capability is unchanged/i);
    expect(fs.existsSync(DEVICE_CODE_STATE_PATH)).toBe(false);
  });

  test('generic invalid_grant does not fall back — plain failure message', async () => {
    const state = {
      deviceCode: 'dc_full',
      interval: 5,
      expiresIn: 900,
      expiresAt: Date.now() + 900 * 1000,
      scopesUsed: 'full',
    };
    fs.writeFileSync(DEVICE_CODE_STATE_PATH, JSON.stringify(state));

    pollForToken.mockRejectedValue(new Error('AADSTS50076: MFA required'));
    isScopeConsentError.mockReturnValue(false);
    isConsentRequiredError.mockReturnValue(false);

    const result = await handleDeviceCodeComplete();

    expect(initiateDeviceCodeFlow).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain(
      'Authentication failed: AADSTS50076'
    );
  });

  test('handleDeviceCodeAuth records scopesUsed=full in persisted state', async () => {
    initiateDeviceCodeFlow.mockResolvedValue({
      userCode: 'FULLCODE',
      verificationUri: 'https://microsoft.com/devicelogin',
      deviceCode: 'dc_full_initiate',
      expiresIn: 900,
      interval: 5,
    });

    await handleDeviceCodeAuth();

    expect(initiateDeviceCodeFlow).toHaveBeenCalledWith('test-client-id', [
      'offline_access',
      'User.Read',
      'Mail.Read',
      'Mail.Read.Shared',
      'Mail.ReadWrite.Shared',
    ]);
    const persisted = JSON.parse(
      fs.readFileSync(DEVICE_CODE_STATE_PATH, 'utf8')
    );
    expect(persisted.scopesUsed).toBe('full');

    // Cleanup in-memory pending state
    pollForToken.mockRejectedValue(new Error('cleanup'));
    isScopeConsentError.mockReturnValue(false);
    TokenStorage.mockImplementation(() => ({
      tokens: null,
      _saveTokensToFile: jest.fn(),
    }));
    await handleDeviceCodeComplete();
  });
});

// #213 — device-code step 1 must surface failures as visible, actionable
// error content instead of throwing (which the top-level dispatcher used to
// convert into empty output). Mirrors the try/catch step 2 already has.
describe('handleDeviceCodeAuth — visible errors on failure (#213)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('returns visible isError content (not empty, no throw) when initiation fails', async () => {
    initiateDeviceCodeFlow.mockRejectedValue(
      new Error(
        'AADSTS9002331: Application is configured for personal Microsoft accounts only'
      )
    );

    const result = await handleDeviceCodeAuth();

    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].text).toContain('AADSTS9002331');
  });

  test('includes audience-mismatch remediation hint for AADSTS9002331', async () => {
    initiateDeviceCodeFlow.mockRejectedValue(
      new Error('AADSTS9002331: audience mismatch on /common')
    );

    const result = await handleDeviceCodeAuth();
    expect(result.content[0].text).toMatch(/OUTLOOK_AUTH_AUDIENCE=consumers/);
  });

  test('includes public-client-flow hint for invalid_client', async () => {
    initiateDeviceCodeFlow.mockRejectedValue(
      new Error('invalid_client: AADSTS7000218 public client flow not enabled')
    );

    const result = await handleDeviceCodeAuth();
    expect(result.content[0].text).toMatch(/public client flows/i);
  });

  test('includes network-egress hint on connection failure', async () => {
    const err = new Error('connect ETIMEDOUT 20.190.190.1:443');
    err.code = 'ETIMEDOUT';
    initiateDeviceCodeFlow.mockRejectedValue(err);

    const result = await handleDeviceCodeAuth();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/login\.microsoftonline\.com/);
  });
});

describe('handleAbout — F-1/F-2/F-48', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OUTLOOK_MAX_EMAILS_PER_SESSION;
    delete process.env.OUTLOOK_ALLOWED_RECIPIENTS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('surfaces authenticated mailbox identity (F-2)', async () => {
    callGraphAPI.mockResolvedValue({
      userPrincipalName: 'user@example.com',
      mail: 'user@example.com',
      displayName: 'Test User',
    });

    const result = await handleAbout();

    expect(result.content[0].text).toMatch(/Test User <user@example\.com>/);
  });

  test('warns when both safety belts are unset (F-1, F-48)', async () => {
    callGraphAPI.mockResolvedValue({
      userPrincipalName: 'u@example.com',
    });

    const result = await handleAbout();

    expect(result.content[0].text).toMatch(/Safety Belts Not Configured/);
    expect(result.content[0].text).toMatch(/OUTLOOK_MAX_EMAILS_PER_SESSION/);
    expect(result.content[0].text).toMatch(/OUTLOOK_ALLOWED_RECIPIENTS/);
  });

  test('does not warn when both safety belts are set', async () => {
    process.env.OUTLOOK_MAX_EMAILS_PER_SESSION = '10';
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    callGraphAPI.mockResolvedValue({ userPrincipalName: 'u@example.com' });

    const result = await handleAbout();

    expect(result.content[0].text).not.toMatch(/Safety Belts Not Configured/);
  });

  test('degrades gracefully when not authenticated', async () => {
    const { ensureAuthenticated } = require('../../auth');
    ensureAuthenticated.mockRejectedValueOnce(
      new Error('Authentication required')
    );

    const result = await handleAbout();

    expect(result.content[0].text).toMatch(/Not authenticated/);
  });
});
