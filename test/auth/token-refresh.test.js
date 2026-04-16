const https = require('https');
const TokenStorage = require('../../auth/token-storage');

jest.mock('https');

/**
 * Helper to mock an HTTPS POST response and capture the request body
 */
function mockHttpsResponse(statusCode, body) {
  let capturedPostData = '';
  const mockRes = {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(JSON.stringify(body));
      if (event === 'end') cb();
      return mockRes;
    }),
  };
  const mockReq = {
    on: jest.fn(),
    write: jest.fn((data) => {
      capturedPostData = data;
    }),
    end: jest.fn(),
  };
  https.request.mockImplementationOnce((_url, _opts, cb) => {
    cb(mockRes);
    return mockReq;
  });
  return { getCapturedPostData: () => capturedPostData };
}

describe('TokenStorage.refreshAccessToken — client_secret handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
    console.warn.mockRestore();
  });

  test('should NOT include client_secret for device-code tokens', async () => {
    const storage = new TokenStorage({
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      tokenEndpoint:
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: ['offline_access', 'User.Read'],
    });

    // Load device-code tokens
    storage.tokens = {
      access_token: 'expired_access',
      refresh_token: 'valid_refresh',
      expires_at: Date.now() - 60000, // Expired
      auth_method: 'device-code',
    };

    // Mock _saveTokensToFile
    storage._saveTokensToFile = jest.fn().mockResolvedValue(undefined);

    const { getCapturedPostData } = mockHttpsResponse(200, {
      access_token: 'new_access_token',
      refresh_token: 'new_refresh_token',
      expires_in: 3600,
    });

    await storage.refreshAccessToken();

    const postData = getCapturedPostData();
    // Should NOT contain client_secret
    expect(postData).not.toContain('client_secret');
    // Should contain other required fields
    expect(postData).toContain('client_id=test-client-id');
    expect(postData).toContain('grant_type=refresh_token');
    expect(postData).toContain('refresh_token=valid_refresh');
  });

  test('should include client_secret for browser-flow tokens', async () => {
    const storage = new TokenStorage({
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      tokenEndpoint:
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: ['offline_access', 'User.Read'],
    });

    // Load browser-flow tokens (no auth_method field)
    storage.tokens = {
      access_token: 'expired_access',
      refresh_token: 'valid_refresh',
      expires_at: Date.now() - 60000,
      // No auth_method — defaults to browser/confidential client
    };

    storage._saveTokensToFile = jest.fn().mockResolvedValue(undefined);

    const { getCapturedPostData } = mockHttpsResponse(200, {
      access_token: 'new_access_token',
      refresh_token: 'new_refresh_token',
      expires_in: 3600,
    });

    await storage.refreshAccessToken();

    const postData = getCapturedPostData();
    // SHOULD contain client_secret for browser flow
    expect(postData).toContain('client_secret=test-secret');
    expect(postData).toContain('client_id=test-client-id');
  });

  test('should include client_secret when auth_method is explicitly browser', async () => {
    const storage = new TokenStorage({
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      tokenEndpoint:
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: ['offline_access', 'User.Read'],
    });

    storage.tokens = {
      access_token: 'expired_access',
      refresh_token: 'valid_refresh',
      expires_at: Date.now() - 60000,
      auth_method: 'browser',
    };

    storage._saveTokensToFile = jest.fn().mockResolvedValue(undefined);

    const { getCapturedPostData } = mockHttpsResponse(200, {
      access_token: 'new_access_token',
      expires_in: 3600,
    });

    await storage.refreshAccessToken();

    const postData = getCapturedPostData();
    expect(postData).toContain('client_secret=test-secret');
  });

  test('should preserve auth_method after refresh', async () => {
    const storage = new TokenStorage({
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      tokenEndpoint:
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: ['offline_access', 'User.Read'],
    });

    storage.tokens = {
      access_token: 'expired_access',
      refresh_token: 'valid_refresh',
      expires_at: Date.now() - 60000,
      auth_method: 'device-code',
    };

    storage._saveTokensToFile = jest.fn().mockResolvedValue(undefined);

    mockHttpsResponse(200, {
      access_token: 'new_access_token',
      refresh_token: 'new_refresh_token',
      expires_in: 3600,
    });

    await storage.refreshAccessToken();

    // auth_method should still be device-code after refresh
    expect(storage.tokens.auth_method).toBe('device-code');
  });
});
