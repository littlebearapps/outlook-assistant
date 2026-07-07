const fs = require('fs');
const os = require('os');
const path = require('path');
const querystring = require('querystring');

jest.mock('https');

function mockHttpsSequence(responses) {
  const calls = [];
  const httpsMock = require('https');

  httpsMock.request.mockImplementation((url, options, callback) => {
    const response = responses.shift();
    const call = {
      url: String(url),
      options,
      requestBody: '',
    };
    calls.push(call);

    const req = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn((data) => {
        call.requestBody += data;
      }),
      end: jest.fn(),
    };

    const res = {
      statusCode: response.statusCode,
      on: jest.fn((event, handler) => {
        if (event === 'data' && response.body !== undefined) {
          handler(JSON.stringify(response.body));
        }
        if (event === 'end') {
          handler();
        }
        return res;
      }),
    };

    process.nextTick(() => callback(res));
    return req;
  });

  return calls;
}

function writeTokenFile(homeDir, tokens) {
  const tokenPath = path.join(homeDir, '.outlook-assistant-tokens.json');
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return tokenPath;
}

describe('token refresh integration through Graph retry', () => {
  const originalEnv = process.env;
  let tempHome;
  let homeTokenMtimeBefore;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const realHomeTokenPath = path.join(
      originalEnv.HOME || os.homedir(),
      '.outlook-assistant-tokens.json'
    );
    homeTokenMtimeBefore = fs.existsSync(realHomeTokenPath)
      ? fs.statSync(realHomeTokenPath).mtimeMs
      : null;

    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-refresh-'));
    process.env = {
      ...originalEnv,
      HOME: tempHome,
      OUTLOOK_CLIENT_ID: 'test-client-id',
      OUTLOOK_CLIENT_SECRET: 'test-client-secret',
      OUTLOOK_AUTH_AUDIENCE: 'common',
      USE_TEST_MODE: 'false',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempHome, { recursive: true, force: true });
    console.log.mockRestore();
    console.error.mockRestore();
    console.warn.mockRestore();
  });

  test('refreshes after a Graph 401, retries with the new bearer token, and persists refreshed tokens', async () => {
    const tokenPath = writeTokenFile(tempHome, {
      access_token: 'old_access_token',
      refresh_token: 'old_refresh_token',
      expires_at: Date.now() + 60 * 60 * 1000,
      auth_method: 'browser',
    });

    const calls = mockHttpsSequence([
      { statusCode: 401, body: { error: 'InvalidAuthenticationToken' } },
      {
        statusCode: 200,
        body: {
          access_token: 'new_access_token',
          refresh_token: 'new_refresh_token',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      },
      { statusCode: 200, body: { value: [{ id: 'msg-1' }] } },
    ]);

    const { callGraphAPIWithAuth } = require('../../utils/graph-api');

    const result = await callGraphAPIWithAuth('GET', 'me/messages', null, {
      $top: '1',
    });

    expect(result).toEqual({ value: [{ id: 'msg-1' }] });
    expect(calls).toHaveLength(3);

    const [firstGraphCall, refreshCall, retryGraphCall] = calls;
    expect(firstGraphCall.url).toBe(
      'https://graph.microsoft.com/v1.0/me/messages?%24top=1'
    );
    expect(firstGraphCall.options.headers.Authorization).toBe(
      'Bearer old_access_token'
    );

    expect(refreshCall.url).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token'
    );
    expect(refreshCall.options.method).toBe('POST');
    const refreshBody = querystring.parse(refreshCall.requestBody);
    expect(refreshBody.grant_type).toBe('refresh_token');
    expect(refreshBody.refresh_token).toBe('old_refresh_token');

    expect(retryGraphCall.url).toBe(firstGraphCall.url);
    expect(retryGraphCall.options.headers.Authorization).toBe(
      'Bearer new_access_token'
    );

    const persistedTokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    expect(persistedTokens.access_token).toBe('new_access_token');
    expect(persistedTokens.refresh_token).toBe('new_refresh_token');
    expect(persistedTokens.expires_at).toBeGreaterThan(Date.now());
  });

  test('surfaces the original unauthorized error when refresh fails', async () => {
    const tokenPath = writeTokenFile(tempHome, {
      access_token: 'old_access_token',
      refresh_token: 'old_refresh_token',
      expires_at: Date.now() + 60 * 60 * 1000,
      auth_method: 'browser',
    });

    const calls = mockHttpsSequence([
      { statusCode: 401, body: { error: 'InvalidAuthenticationToken' } },
      {
        statusCode: 400,
        body: {
          error: 'invalid_grant',
          error_description: 'Refresh token expired',
        },
      },
    ]);

    const { callGraphAPIWithAuth } = require('../../utils/graph-api');

    await expect(callGraphAPIWithAuth('GET', 'me/messages')).rejects.toThrow(
      'UNAUTHORIZED'
    );

    expect(calls).toHaveLength(2);
    const persistedTokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    expect(persistedTokens.access_token).toBe('old_access_token');
    expect(persistedTokens.refresh_token).toBe('old_refresh_token');
  });

  test('does not touch the real home token file', () => {
    const realHomeTokenPath = path.join(
      originalEnv.HOME || os.homedir(),
      '.outlook-assistant-tokens.json'
    );
    const mtimeAfter = fs.existsSync(realHomeTokenPath)
      ? fs.statSync(realHomeTokenPath).mtimeMs
      : null;

    expect(mtimeAfter).toBe(homeTokenMtimeBefore);
  });
});
