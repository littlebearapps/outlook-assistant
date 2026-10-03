const fs = require('fs');
const os = require('os');
const path = require('path');

// auth/tools.js builds its pending-auth path from HOME at load time, so point
// HOME at a throwaway dir before it is required — this suite writes and deletes
// that file and must never touch a real pending sign-in (#257).
const ORIGINAL_HOME = process.env.HOME;
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-auth-tools-'));
process.env.HOME = TEST_HOME;
// AUTH_CONFIG.clientId below resolves through the real auth/client-config
// (env → saved ~/.outlook-assistant-config.json in TEST_HOME). Existing tests
// rely on the env var; the clientId suite clears it to exercise the rest.
process.env.OUTLOOK_CLIENT_ID = 'test-client-id';
delete process.env.MS_CLIENT_ID;

afterAll(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = ORIGINAL_HOME;
  }
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

// Mock dependencies before requiring the module under test
jest.mock('../../auth/device-code');
jest.mock('../../auth/token-manager');
jest.mock('../../auth/token-storage');

const DEVICE_CODE_STATE_PATH = path.join(
  TEST_HOME,
  '.outlook-assistant-pending-auth.json'
);

// Mock config
jest.mock('../../config', () => ({
  AUTH_CONFIG: {
    get clientId() {
      return jest.requireActual('../../auth/client-config').resolveClientId();
    },
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
  // Shared-mailbox support enabled for these tests (the fallback paths only
  // apply when OUTLOOK_SHARED_MAILBOX opts in).
  SHARED_SCOPES: ['Mail.Read.Shared', 'Mail.ReadWrite.Shared'],
  SHARED_MAILBOX_MODE: 'readwrite',
  USE_TEST_MODE: false,
  SERVER_VERSION: '3.9.0',
  DEFAULT_TIMEZONE: 'Australia/Melbourne',
}));

const {
  authTools,
  handleAuthenticate,
  handleDeviceCodeAuth,
  handleDeviceCodeComplete,
  handleCheckAuthStatus,
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

  test('keeps pending-auth state inside an isolated temp HOME (#257)', async () => {
    // The state file must live in this suite's own temp HOME, never the real one
    const stateHome = path.dirname(DEVICE_CODE_STATE_PATH);
    expect(stateHome.startsWith(os.tmpdir())).toBe(true);
    expect(path.basename(stateHome)).toMatch(/^oa-auth-tools-/);

    initiateDeviceCodeFlow.mockResolvedValue({
      userCode: 'ISOLATED',
      verificationUri: 'https://microsoft.com/devicelogin',
      deviceCode: 'device_code_isolated',
      expiresIn: 900,
      interval: 5,
    });
    await handleDeviceCodeAuth();
    expect(
      JSON.parse(fs.readFileSync(DEVICE_CODE_STATE_PATH, 'utf8')).deviceCode
    ).toBe('device_code_isolated');

    // Consume the in-memory state so it doesn't leak to subsequent tests
    pollForToken.mockRejectedValue(new Error('test cleanup'));
    TokenStorage.mockImplementation(() => ({
      tokens: null,
      _saveTokensToFile: jest.fn(),
    }));
    await handleDeviceCodeComplete();
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
    // clearAllMocks keeps mockReturnValue implementations; reset the
    // classifiers so one test's verdict can't leak into the next.
    isScopeConsentError.mockReset();
    isConsentRequiredError.mockReset();
    initiateDeviceCodeFlow.mockReset();
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

  test('falls back once when the device-code REQUEST rejects the .Shared scopes', async () => {
    const scopeErr = new Error('AADSTS70011: invalid scope');
    scopeErr.oauth = { error: 'invalid_scope' };
    initiateDeviceCodeFlow
      .mockRejectedValueOnce(scopeErr)
      .mockResolvedValueOnce({
        userCode: 'BASECODE',
        verificationUri: 'https://microsoft.com/devicelogin',
        deviceCode: 'dc_base',
        expiresIn: 900,
        interval: 5,
      });
    isScopeConsentError.mockReturnValue(true);

    const result = await handleDeviceCodeAuth();

    expect(initiateDeviceCodeFlow).toHaveBeenCalledTimes(2);
    expect(initiateDeviceCodeFlow.mock.calls[1][1]).toEqual([
      'offline_access',
      'User.Read',
      'Mail.Read',
    ]);
    expect(result.content[0].text).toContain('BASECODE');
    const persisted = JSON.parse(
      fs.readFileSync(DEVICE_CODE_STATE_PATH, 'utf8')
    );
    expect(persisted.scopesUsed).toBe('base');
  });

  test('with shared mailboxes off, a rejected device-code request is reported, not retried', async () => {
    const config = require('../../config');
    const saved = config.SHARED_SCOPES;
    config.SHARED_SCOPES = [];
    try {
      initiateDeviceCodeFlow.mockRejectedValue(new Error('AADSTS70011'));
      isScopeConsentError.mockReturnValue(true);

      const result = await handleDeviceCodeAuth();

      expect(initiateDeviceCodeFlow).toHaveBeenCalledTimes(1);
      expect(result.isError).toBe(true);
    } finally {
      config.SHARED_SCOPES = saved;
    }
  });

  test('a consent-required error is surfaced even if it also looks like a scope error', async () => {
    fs.writeFileSync(
      DEVICE_CODE_STATE_PATH,
      JSON.stringify({
        deviceCode: 'dc_full',
        interval: 5,
        expiresIn: 900,
        expiresAt: Date.now() + 900 * 1000,
        scopesUsed: 'full',
      })
    );
    pollForToken.mockRejectedValue(new Error('AADSTS65001'));
    isScopeConsentError.mockReturnValue(true);
    isConsentRequiredError.mockReturnValue(true);

    const result = await handleDeviceCodeComplete();

    expect(initiateDeviceCodeFlow).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/consent was not granted/);
  });

  test('with shared mailboxes off, a scope error never triggers a fallback code', async () => {
    const config = require('../../config');
    const saved = config.SHARED_SCOPES;
    config.SHARED_SCOPES = [];
    try {
      fs.writeFileSync(
        DEVICE_CODE_STATE_PATH,
        JSON.stringify({
          deviceCode: 'dc_full',
          interval: 5,
          expiresIn: 900,
          expiresAt: Date.now() + 900 * 1000,
          scopesUsed: 'full',
        })
      );
      pollForToken.mockRejectedValue(new Error('AADSTS70011: invalid scope'));
      isScopeConsentError.mockReturnValue(true);
      isConsentRequiredError.mockReturnValue(true);

      const result = await handleDeviceCodeComplete();

      expect(initiateDeviceCodeFlow).not.toHaveBeenCalled();
      expect(result.content[0].text).toMatch(/Authentication failed/);
      expect(result.content[0].text).not.toMatch(/shared-mailbox scopes/);
    } finally {
      config.SHARED_SCOPES = saved;
    }
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

  describe('shared-mailbox status and granted scopes', () => {
    const auth = require('../../auth');
    const config = require('../../config');
    let savedMode;
    let savedScopes;

    beforeEach(() => {
      savedMode = config.SHARED_MAILBOX_MODE;
      savedScopes = config.SHARED_SCOPES;
      callGraphAPI.mockResolvedValue({ userPrincipalName: 'u@example.com' });
    });

    afterEach(() => {
      config.SHARED_MAILBOX_MODE = savedMode;
      config.SHARED_SCOPES = savedScopes;
      delete auth.tokenStorage;
    });

    test('reports which configured .Shared scopes were actually granted', async () => {
      auth.tokenStorage = {
        getTokens: jest.fn().mockResolvedValue({
          access_token: 'never-shown',
          refresh_token: 'never-shown-either',
          scope:
            'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Read.Shared User.Read',
        }),
      };

      const text = (await handleAbout()).content[0].text;

      expect(text).toMatch(
        /Shared mailboxes \| Enabled \(readwrite\): Mail\.Read\.Shared granted, Mail\.ReadWrite\.Shared not granted/
      );
      expect(text).toMatch(/force=true/);
      expect(text).toMatch(
        /\*\*Granted scopes\*\*: Mail\.Read, Mail\.Read\.Shared, User\.Read/
      );
      expect(text).not.toContain('never-shown');
    });

    test('says shared mailboxes are disabled when the flag is off', async () => {
      config.SHARED_MAILBOX_MODE = 'off';
      config.SHARED_SCOPES = [];
      auth.tokenStorage = {
        getTokens: jest.fn().mockResolvedValue({ scope: 'User.Read' }),
      };

      const text = (await handleAbout()).content[0].text;

      expect(text).toMatch(/Shared mailboxes \| Disabled/);
      expect(text).toMatch(/OUTLOOK_SHARED_MAILBOX=read/);
    });

    test('reports not signed in when no token is stored', async () => {
      auth.tokenStorage = { getTokens: jest.fn().mockResolvedValue(null) };

      const text = (await handleAbout()).content[0].text;

      expect(text).toMatch(/\*\*Granted scopes\*\*: not signed in/);
    });
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

// Runtime client ID (`auth action=authenticate clientId=…`) for MCP clients
// that can't set env vars, e.g. Copilot/Cursor plugin marketplaces.
describe('auth clientId param — runtime Azure Application (client) ID', () => {
  const GUID = '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d';
  const OTHER_GUID = 'ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb';
  const CONFIG_PATH = path.join(TEST_HOME, '.outlook-assistant-config.json');
  const originalEnv = process.env;

  const readSaved = () => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    // Drain any in-memory pending device code left by earlier tests: a
    // failed completion clears it.
    process.env.OUTLOOK_CLIENT_ID = 'drain';
    pollForToken.mockRejectedValue(new Error('reset'));
    await handleDeviceCodeComplete();
    pollForToken.mockReset();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OUTLOOK_CLIENT_ID;
    delete process.env.MS_CLIENT_ID;
    fs.rmSync(CONFIG_PATH, { force: true });
    fs.rmSync(DEVICE_CODE_STATE_PATH, { force: true });
    initiateDeviceCodeFlow.mockResolvedValue({
      deviceCode: 'dc_runtime',
      userCode: 'RUNTIME1',
      verificationUri: 'https://microsoft.com/devicelogin',
      interval: 5,
      expiresIn: 900,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    console.error.mockRestore();
    fs.rmSync(CONFIG_PATH, { force: true });
    fs.rmSync(DEVICE_CODE_STATE_PATH, { force: true });
  });

  test('schema exposes an optional string clientId that schema-coerce accepts', () => {
    const { coerceArgsAgainstSchema } = require('../../utils/schema-coerce');
    const authTool = authTools.find((t) => t.name === 'auth');
    const prop = authTool.inputSchema.properties.clientId;
    expect(prop.type).toBe('string');
    expect(prop.description).toMatch(/Application \(client\) ID/);
    expect(prop.description).toMatch(/\.outlook-assistant-config\.json/);
    expect(prop.description).toMatch(/not a secret/);
    expect(prop.description).toMatch(/OUTLOOK_CLIENT_ID/);
    expect(authTool.inputSchema.required).not.toContain('clientId');
    expect(
      coerceArgsAgainstSchema(
        { action: 'authenticate', clientId: GUID },
        authTool.inputSchema
      )
    ).toEqual({ args: { action: 'authenticate', clientId: GUID } });
  });

  test('saves a valid ID (mode 0600) and proceeds to device-code sign-in with it', async () => {
    const result = await handleAuthenticate({
      action: 'authenticate',
      clientId: `  ${GUID}  `,
    });

    expect(result.isError).toBeUndefined();
    expect(readSaved()).toEqual({ clientId: GUID });
    if (process.platform !== 'win32') {
      expect(fs.statSync(CONFIG_PATH).mode & 0o777).toBe(0o600);
    }
    expect(initiateDeviceCodeFlow).toHaveBeenCalledWith(
      GUID,
      expect.any(Array)
    );
    const text = result.content[0].text;
    expect(text).toMatch(/Saved your Azure Application \(client\) ID/);
    expect(text).toContain('RUNTIME1');
    // The pending state records the client ID the code was issued to
    expect(
      JSON.parse(fs.readFileSync(DEVICE_CODE_STATE_PATH, 'utf8')).clientId
    ).toBe(GUID);
  });

  test('device-code-complete polls with the saved ID', async () => {
    await handleAuthenticate({ action: 'authenticate', clientId: GUID });
    pollForToken.mockResolvedValue({
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 3600,
      scope: 'User.Read',
      token_type: 'Bearer',
    });
    TokenStorage.mockImplementation(() => ({
      tokens: null,
      _saveTokensToFile: jest.fn().mockResolvedValue(undefined),
    }));

    const result = await handleDeviceCodeComplete();

    expect(result.content[0].text).toContain('Authentication successful');
    expect(pollForToken).toHaveBeenCalledWith(
      GUID,
      'dc_runtime',
      5,
      expect.any(Number)
    );
    expect(TokenStorage).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: GUID })
    );
  });

  test('a saved ID is used later without passing clientId again', async () => {
    await handleAuthenticate({ action: 'authenticate', clientId: GUID });
    initiateDeviceCodeFlow.mockClear();

    await handleAuthenticate({ action: 'authenticate' });

    expect(initiateDeviceCodeFlow).toHaveBeenCalledWith(
      GUID,
      expect.any(Array)
    );
  });

  test.each(['not-a-guid', 'test-client-id', `${GUID}-extra`, 42])(
    'rejects invalid clientId %p without saving or starting sign-in',
    async (bad) => {
      const result = await handleAuthenticate({
        action: 'authenticate',
        clientId: bad,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(
        /not a valid Azure Application \(client\) ID/
      );
      expect(fs.existsSync(CONFIG_PATH)).toBe(false);
      expect(initiateDeviceCodeFlow).not.toHaveBeenCalled();
    }
  );

  test.each([null, '', '   '])(
    'treats clientId %p as not supplied (some clients send empty optionals)',
    async (empty) => {
      process.env.OUTLOOK_CLIENT_ID = GUID;

      const result = await handleAuthenticate({
        action: 'authenticate',
        clientId: empty,
      });

      expect(result.isError).toBeUndefined();
      expect(fs.existsSync(CONFIG_PATH)).toBe(false);
      expect(initiateDeviceCodeFlow).toHaveBeenCalledWith(
        GUID,
        expect.any(Array)
      );
    }
  );

  test.each(['OUTLOOK_CLIENT_ID', 'MS_CLIENT_ID'])(
    'refuses when %s is set to a different ID (env wins)',
    async (envName) => {
      process.env[envName] = OTHER_GUID;

      const result = await handleAuthenticate({
        action: 'authenticate',
        clientId: GUID,
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain(envName);
      expect(text).toMatch(/takes precedence/);
      expect(text).toMatch(/change or remove/);
      expect(text).not.toContain(OTHER_GUID);
      expect(fs.existsSync(CONFIG_PATH)).toBe(false);
      expect(initiateDeviceCodeFlow).not.toHaveBeenCalled();
    }
  );

  test('accepts a clientId matching the env var (case-insensitive)', async () => {
    process.env.OUTLOOK_CLIENT_ID = GUID.toUpperCase();

    const result = await handleAuthenticate({
      action: 'authenticate',
      clientId: GUID,
    });

    expect(result.isError).toBeUndefined();
    expect(initiateDeviceCodeFlow).toHaveBeenCalledWith(
      GUID.toUpperCase(),
      expect.any(Array)
    );
  });

  test('no client ID anywhere → guidance error for the AI client', async () => {
    const result = await handleAuthenticate({ action: 'authenticate' });

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toMatch(/OUTLOOK_CLIENT_ID is not configured/);
    expect(text).toMatch(/Ask the user for the \*\*Application \(client\) ID/);
    expect(text).toContain('auth action=authenticate clientId=<id>');
    expect(text).toContain(
      'https://github.com/littlebearapps/outlook-assistant/blob/main/docs/how-to/getting-started/connect-outlook-to-claude.md'
    );
    expect(text).toMatch(/client secret is not needed for device-code/);
    expect(initiateDeviceCodeFlow).not.toHaveBeenCalled();
  });

  test('browser method with no client ID → same guidance error', async () => {
    const result = await handleAuthenticate({
      action: 'authenticate',
      method: 'browser',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(
      /OUTLOOK_CLIENT_ID is not configured/
    );
  });

  test('browser method with a saved ID notes the auth server needs env vars', async () => {
    const result = await handleAuthenticate({
      action: 'authenticate',
      method: 'browser',
      clientId: GUID,
    });

    const text = result.content[0].text;
    expect(result.isError).toBeUndefined();
    expect(readSaved()).toEqual({ clientId: GUID });
    expect(text).toContain(`client_id=${GUID}`);
    expect(text).toMatch(/OUTLOOK_CLIENT_SECRET/);
    expect(initiateDeviceCodeFlow).not.toHaveBeenCalled();
  });

  test('device-code-complete with no client ID anywhere → guidance error', async () => {
    fs.writeFileSync(
      DEVICE_CODE_STATE_PATH,
      JSON.stringify({
        deviceCode: 'dc_old',
        interval: 5,
        expiresIn: 900,
        expiresAt: Date.now() + 900 * 1000,
      }),
      { mode: 0o600 }
    );

    const result = await handleDeviceCodeComplete();

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(
      /OUTLOOK_CLIENT_ID is not configured/
    );
    expect(pollForToken).not.toHaveBeenCalled();
    expect(fs.existsSync(DEVICE_CODE_STATE_PATH)).toBe(false);
  });

  test('status with no client ID guides the AI client', async () => {
    TokenStorage.mockImplementation(() => ({
      getValidAccessToken: jest.fn().mockResolvedValue(null),
    }));

    const text = (await handleCheckAuthStatus()).content[0].text;

    expect(text).toMatch(/^Not authenticated/);
    expect(text).toContain('auth action=authenticate clientId=<id>');
  });

  describe('auth about — Client ID row', () => {
    beforeEach(() => {
      callGraphAPI.mockResolvedValue({ userPrincipalName: 'u@example.com' });
    });

    test('Not set', async () => {
      const text = (await handleAbout()).content[0].text;
      expect(text).toMatch(/\| Client ID \| Not set/);
    });

    test('Configured (environment)', async () => {
      process.env.OUTLOOK_CLIENT_ID = GUID;
      const text = (await handleAbout()).content[0].text;
      expect(text).toMatch(
        /\| Client ID \| Configured \(environment: OUTLOOK_CLIENT_ID\) \|/
      );
      expect(text).not.toContain(GUID);
    });

    test('Configured (saved) — never prints the ID', async () => {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ clientId: GUID }));
      const text = (await handleAbout()).content[0].text;
      expect(text).toMatch(
        /\| Client ID \| Configured \(saved in ~\/\.outlook-assistant-config\.json\) \|/
      );
      expect(text).not.toContain(GUID);
      expect(text).not.toContain(GUID.slice(-4));
    });
  });
});
