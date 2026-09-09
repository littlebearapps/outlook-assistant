/**
 * End-to-end token refresh round trip (#72).
 *
 * The existing coverage stops short of the full cycle:
 *   - token-storage.test.js  — expiry detection, refresh buffer, invalid_grant
 *   - token-refresh.test.js  — whether client_secret is sent, per auth method
 *
 * What was untested is the join between them: load an expired token from disk,
 * detect it, refresh it over the wire, persist the result, and then actually
 * use the NEW access token on the next Graph call. Plus the failure paths,
 * where the important property is that a transient network blip must not cost
 * the user their refresh token.
 *
 * A single https mock serves both the Microsoft token endpoint and the Graph
 * endpoint, routed by URL, so the token really does travel end to end.
 */
const fs = require('fs').promises;
const https = require('https');
const querystring = require('querystring');
const TokenStorage = require('../../auth/token-storage');
const { callGraphAPI } = require('../../utils/graph-api');

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
  },
  existsSync: jest.fn().mockReturnValue(false),
  renameSync: jest.fn(),
}));
jest.mock('https');

process.env.HOME = '/mock/home';

const TOKEN_ENDPOINT =
  'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const LOGIN_HOST = 'login.microsoftonline.com';
const GRAPH_HOST = 'graph.microsoft.com';

/** Exact host of a URL — never a substring match, which is bypassable. */
function hostOf(url) {
  return new URL(String(url)).hostname;
}

const baseConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost/callback',
  scopes: ['Mail.Read'],
  tokenEndpoint: TOKEN_ENDPOINT,
  refreshTokenBuffer: 5 * 60 * 1000,
};

/** Tokens as they would sit on disk, already past expiry. */
function expiredTokensOnDisk(overrides = {}) {
  return JSON.stringify({
    access_token: 'STALE_ACCESS_TOKEN',
    refresh_token: 'REFRESH_TOKEN_V1',
    auth_method: 'browser',
    expires_in: 3600,
    expires_at: Date.now() - 60 * 1000,
    ...overrides,
  });
}

describe('token refresh round trip', () => {
  let tokenStorage;
  /** Every https.request call, in order: { url, options, body, req }. */
  let calls;
  /** hostname -> () => ({ statusCode, body }) */
  let routes;
  /** hostnames that should fail with a socket error instead of responding */
  let networkFailures;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    fs.writeFile.mockResolvedValue(undefined);
    calls = [];
    routes = {};
    networkFailures = {};

    https.request.mockImplementation((url, options, callback) => {
      const entry = { url: String(url), options, body: null };
      const req = {
        on: jest.fn((event, cb) => {
          if (event === 'error') entry.errorHandler = cb;
          return req;
        }),
        write: jest.fn((b) => {
          entry.body = b;
        }),
        end: jest.fn(() => {
          // Respond asynchronously, as a real socket would.
          setImmediate(() => {
            const host = hostOf(entry.url);
            if (networkFailures[host]) {
              entry.errorHandler(networkFailures[host]);
              return;
            }
            const { statusCode, body } = routes[host]();
            callback({
              statusCode,
              on: (event, cb) => {
                if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
                if (event === 'end') cb();
              },
            });
          });
        }),
      };
      entry.req = req;
      calls.push(entry);
      return req;
    });

    tokenStorage = new TokenStorage(baseConfig);
    tokenStorage.tokens = null;
    tokenStorage._loadPromise = null;
    tokenStorage._refreshPromise = null;
  });

  afterEach(() => jest.restoreAllMocks());

  /** The refresh endpoint issues a rotated token pair. */
  function refreshSucceeds() {
    routes[LOGIN_HOST] = () => ({
      statusCode: 200,
      body: {
        access_token: 'FRESH_ACCESS_TOKEN',
        refresh_token: 'REFRESH_TOKEN_V2',
        expires_in: 3600,
      },
    });
  }

  function graphSucceeds() {
    routes[GRAPH_HOST] = () => ({
      statusCode: 200,
      body: { value: [{ id: 'msg-1' }] },
    });
  }

  describe('the happy path, disk to Graph', () => {
    beforeEach(() => {
      fs.readFile.mockResolvedValue(expiredTokensOnDisk());
      refreshSucceeds();
      graphSucceeds();
    });

    it('loads from disk, detects expiry, refreshes, and returns the new token', async () => {
      const token = await tokenStorage.getValidAccessToken();
      expect(token).toBe('FRESH_ACCESS_TOKEN');
    });

    it('reads the token file exactly once', async () => {
      await tokenStorage.getValidAccessToken();
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    it('sends a refresh_token grant carrying the stored refresh token', async () => {
      await tokenStorage.getValidAccessToken();
      const body = querystring.parse(calls[0].body);
      expect(calls[0].url).toBe(TOKEN_ENDPOINT);
      expect(body.grant_type).toBe('refresh_token');
      expect(body.refresh_token).toBe('REFRESH_TOKEN_V1');
    });

    it('writes the refreshed tokens back to disk', async () => {
      await tokenStorage.getValidAccessToken();
      expect(fs.writeFile).toHaveBeenCalled();
      const written = JSON.parse(fs.writeFile.mock.calls.at(-1)[1]);
      expect(written.access_token).toBe('FRESH_ACCESS_TOKEN');
    });

    it('persists the rotated refresh token, not the one it replaced', async () => {
      await tokenStorage.getValidAccessToken();
      const written = JSON.parse(fs.writeFile.mock.calls.at(-1)[1]);
      expect(written.refresh_token).toBe('REFRESH_TOKEN_V2');
    });

    it('persists a future expiry so the next call does not re-refresh', async () => {
      await tokenStorage.getValidAccessToken();
      const written = JSON.parse(fs.writeFile.mock.calls.at(-1)[1]);
      expect(written.expires_at).toBeGreaterThan(Date.now());
    });

    it('writes the token file with 0600 permissions', async () => {
      await tokenStorage.getValidAccessToken();
      expect(fs.writeFile.mock.calls.at(-1)[2]).toEqual({ mode: 0o600 });
    });

    it('uses the NEW access token on the next Graph call', async () => {
      const token = await tokenStorage.getValidAccessToken();
      await callGraphAPI(token, 'GET', 'me/messages');

      const graphCall = calls.find((c) => hostOf(c.url) === GRAPH_HOST);
      expect(graphCall.options.headers.Authorization).toBe(
        'Bearer FRESH_ACCESS_TOKEN'
      );
    });

    it('never sends the stale token to Graph', async () => {
      const token = await tokenStorage.getValidAccessToken();
      await callGraphAPI(token, 'GET', 'me/messages');
      const auths = calls
        .filter((c) => c.options.headers && c.options.headers.Authorization)
        .map((c) => c.options.headers.Authorization);
      expect(auths).not.toContain('Bearer STALE_ACCESS_TOKEN');
    });

    it('does not refresh again on a subsequent call', async () => {
      await tokenStorage.getValidAccessToken();
      const afterFirst = calls.length;
      const second = await tokenStorage.getValidAccessToken();
      expect(second).toBe('FRESH_ACCESS_TOKEN');
      expect(calls.length).toBe(afterFirst);
    });

    it('coalesces concurrent callers into a single refresh request', async () => {
      const [a, b, c] = await Promise.all([
        tokenStorage.getValidAccessToken(),
        tokenStorage.getValidAccessToken(),
        tokenStorage.getValidAccessToken(),
      ]);
      expect([a, b, c]).toEqual([
        'FRESH_ACCESS_TOKEN',
        'FRESH_ACCESS_TOKEN',
        'FRESH_ACCESS_TOKEN',
      ]);
      expect(calls.filter((x) => hostOf(x.url) === LOGIN_HOST)).toHaveLength(1);
    });
  });

  describe('a still-valid token is used as-is', () => {
    it('does not contact the token endpoint at all', async () => {
      fs.readFile.mockResolvedValue(
        expiredTokensOnDisk({
          access_token: 'GOOD_TOKEN',
          expires_at: Date.now() + 60 * 60 * 1000,
        })
      );
      const token = await tokenStorage.getValidAccessToken();
      expect(token).toBe('GOOD_TOKEN');
      expect(calls).toHaveLength(0);
    });
  });

  describe('network failure during refresh', () => {
    beforeEach(() => {
      fs.readFile.mockResolvedValue(expiredTokensOnDisk());
      networkFailures[LOGIN_HOST] = Object.assign(
        new Error('getaddrinfo ENOTFOUND login.microsoftonline.com'),
        { code: 'ENOTFOUND' }
      );
    });

    it('returns null rather than throwing at the caller', async () => {
      await expect(tokenStorage.getValidAccessToken()).resolves.toBeNull();
    });

    it('does not overwrite the token file, so the refresh token survives', async () => {
      // A transient blip must not cost the user a full re-authentication.
      // `_saveTokensToFile` returns early when tokens are null, so the on-disk
      // credentials are left intact.
      await tokenStorage.getValidAccessToken();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('recovers on a later attempt once the network returns', async () => {
      await tokenStorage.getValidAccessToken();

      delete networkFailures[LOGIN_HOST];
      refreshSucceeds();
      // Fresh process would reload from the untouched file; simulate that.
      tokenStorage.tokens = null;
      tokenStorage._loadPromise = null;

      await expect(tokenStorage.getValidAccessToken()).resolves.toBe(
        'FRESH_ACCESS_TOKEN'
      );
    });
  });

  describe('refresh token rejected by Microsoft', () => {
    beforeEach(() => {
      fs.readFile.mockResolvedValue(expiredTokensOnDisk());
      routes[LOGIN_HOST] = () => ({
        statusCode: 400,
        body: {
          error: 'invalid_grant',
          error_description:
            'AADSTS700082: The refresh token has expired due to inactivity.',
        },
      });
    });

    it('returns null so callers can prompt for re-authentication', async () => {
      await expect(tokenStorage.getValidAccessToken()).resolves.toBeNull();
    });

    it('surfaces a re-authentication hint on the underlying error', async () => {
      tokenStorage.tokens = JSON.parse(expiredTokensOnDisk());
      await expect(tokenStorage.refreshAccessToken()).rejects.toThrow(
        /re-?authenticate/i
      );
    });
  });

  describe('expired token with no refresh token', () => {
    it('returns null without contacting the token endpoint', async () => {
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          access_token: 'STALE',
          expires_at: Date.now() - 1000,
        })
      );
      await expect(tokenStorage.getValidAccessToken()).resolves.toBeNull();
      expect(calls).toHaveLength(0);
    });
  });
});
