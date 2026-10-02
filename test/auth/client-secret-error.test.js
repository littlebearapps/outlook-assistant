/**
 * End-to-end wiring of the AADSTS7000215 friendly error (#69).
 *
 * auth-errors.test.js covers the hint table in isolation; this file asserts the
 * hint actually reaches the caller from the two code paths that talk to the
 * Microsoft token endpoint with a client_secret.
 */
const fs = require('fs').promises;
const https = require('https');
const TokenStorage = require('../../auth/token-storage');

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

const baseConfig = {
  clientId: 'test-client-id',
  clientSecret: 'the-secret-id-not-the-value',
  redirectUri: 'http://localhost/callback',
  scopes: ['test_scope'],
  tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
};

// The real shape Microsoft returns when the Secret ID is used as the secret.
const INVALID_SECRET_RESPONSE = {
  error: 'invalid_client',
  error_description:
    "AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID, for a secret added to app '11111111-2222-3333-4444-555555555555'.\r\nTrace ID: abc\r\nCorrelation ID: def",
};

describe('AADSTS7000215 surfaces an actionable error', () => {
  let tokenStorage;
  let mockHttpsRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    fs.readFile.mockResolvedValue('{}');
    fs.writeFile.mockResolvedValue(undefined);

    tokenStorage = new TokenStorage(baseConfig);
    tokenStorage.tokens = null;
    tokenStorage._loadPromise = null;
    tokenStorage._refreshPromise = null;

    mockHttpsRequest = {
      on: jest.fn((event, cb) => {
        if (event === 'error') mockHttpsRequest.errorHandler = cb;
        return mockHttpsRequest;
      }),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementation((url, options, callback) => {
      mockHttpsRequest.callback = callback;
      return mockHttpsRequest;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  /** Drive the pending request to a 400 with the invalid-secret body. */
  function respondWithInvalidSecret() {
    mockHttpsRequest.callback({
      statusCode: 400,
      on: (event, cb) => {
        if (event === 'data') {
          cb(Buffer.from(JSON.stringify(INVALID_SECRET_RESPONSE)));
        }
        if (event === 'end') cb();
      },
    });
  }

  describe('exchangeCodeForTokens (browser redirect flow)', () => {
    function capture() {
      const p = tokenStorage.exchangeCodeForTokens('auth_code_123');
      respondWithInvalidSecret();
      return p.then(
        () => {
          throw new Error('expected rejection');
        },
        (e) => e.message
      );
    }

    it('still contains the raw Azure error code', async () => {
      expect(await capture()).toContain('AADSTS7000215');
    });

    it('explains the Secret ID vs Secret Value mistake', async () => {
      const msg = await capture();
      expect(msg).toContain('Secret ID');
      expect(msg).toContain('Secret Value');
    });

    it('names OUTLOOK_CLIENT_SECRET as the thing to fix', async () => {
      expect(await capture()).toContain('OUTLOOK_CLIENT_SECRET');
    });
  });

  describe('refreshAccessToken', () => {
    function capture() {
      tokenStorage.tokens = {
        access_token: 'old',
        refresh_token: 'refresh_abc',
        auth_method: 'browser',
        expires_at: Date.now() - 1000,
      };
      const p = tokenStorage.refreshAccessToken();
      respondWithInvalidSecret();
      return p.then(
        () => {
          throw new Error('expected rejection');
        },
        (e) => e.message
      );
    }

    it('still contains the raw Azure error code', async () => {
      expect(await capture()).toContain('AADSTS7000215');
    });

    it('explains the Secret ID vs Secret Value mistake', async () => {
      expect(await capture()).toContain('Secret ID');
    });
  });

  describe('browser-flow error page', () => {
    it('renders the multi-line hint in a pre-wrap block so it stays readable', () => {
      const { templates } = require('../../auth/oauth-server');
      const html = templates.tokenExchangeError(
        new Error('AADSTS7000215: Invalid client secret provided.')
      );
      expect(html).toContain('pre-wrap');
      expect(html).toContain('AADSTS7000215');
    });
  });

  describe('unrelated errors are left alone', () => {
    it('does not append hints to an unknown error_description', async () => {
      const p = tokenStorage.exchangeCodeForTokens('auth_code_123');
      mockHttpsRequest.callback({
        statusCode: 400,
        on: (event, cb) => {
          if (event === 'data') {
            cb(
              Buffer.from(
                JSON.stringify({
                  error: 'server_error',
                  error_description: 'Something opaque',
                })
              )
            );
          }
          if (event === 'end') cb();
        },
      });
      const msg = await p.then(
        () => {
          throw new Error('expected rejection');
        },
        (e) => e.message
      );
      expect(msg).toBe('Something opaque');
    });
  });
});
