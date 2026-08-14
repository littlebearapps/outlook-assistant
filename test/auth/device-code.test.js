const https = require('https');
const {
  initiateDeviceCodeFlow,
  pollForToken,
  isScopeConsentError,
} = require('../../auth/device-code');

jest.mock('https');
jest.mock('../../config', () => ({
  AUTH_CONFIG: {
    deviceCodeEndpoint:
      'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  },
  SHARED_SCOPES: ['Mail.Read.Shared', 'Mail.ReadWrite.Shared'],
}));

/**
 * Helper to mock an HTTPS POST response
 */
function mockHttpsResponse(statusCode, body) {
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
    setTimeout: jest.fn(),
    destroy: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
  https.request.mockImplementationOnce((_url, _opts, cb) => {
    cb(mockRes);
    return mockReq;
  });
}

describe('device-code', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initiateDeviceCodeFlow', () => {
    it('returns device code response on success', async () => {
      mockHttpsResponse(200, {
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://microsoft.com/devicelogin',
        device_code: 'device_code_123',
        expires_in: 900,
        interval: 5,
        message: 'To sign in, visit https://microsoft.com/devicelogin',
      });

      const result = await initiateDeviceCodeFlow('test-client', [
        'offline_access',
        'Mail.Read',
      ]);

      expect(result.userCode).toBe('ABCD-EFGH');
      expect(result.verificationUri).toBe('https://microsoft.com/devicelogin');
      expect(result.deviceCode).toBe('device_code_123');
      expect(result.expiresIn).toBe(900);
      expect(result.interval).toBe(5);

      // Verify the POST was sent correctly
      const [url, opts] = https.request.mock.calls[0];
      expect(url).toContain('devicecode');
      expect(opts.method).toBe('POST');
    });

    it('throws on error response', async () => {
      mockHttpsResponse(400, {
        error: 'invalid_client',
        error_description: 'The client ID is not valid',
      });

      await expect(
        initiateDeviceCodeFlow('bad-client', ['Mail.Read'])
      ).rejects.toThrow('The client ID is not valid');
    });

    it('defaults interval to 5 when not provided', async () => {
      mockHttpsResponse(200, {
        user_code: 'XXXX-YYYY',
        verification_uri: 'https://microsoft.com/devicelogin',
        device_code: 'dc_456',
        expires_in: 600,
      });

      const result = await initiateDeviceCodeFlow('test-client', ['Mail.Read']);
      expect(result.interval).toBe(5);
    });

    // #191 — a hung request (e.g. blocked outbound egress in a sandboxed
    // connector) must fail fast with a clear timeout error rather than hang.
    it('rejects with a timeout message when the request times out', async () => {
      const mockReq = {
        on: jest.fn(),
        setTimeout: jest.fn((_ms, cb) => cb()), // fire the timeout immediately
        write: jest.fn(),
        end: jest.fn(),
      };
      // destroy(err) re-emits via the registered 'error' handler (Node behaviour)
      mockReq.destroy = jest.fn((err) => {
        const errCall = mockReq.on.mock.calls.find((c) => c[0] === 'error');
        if (errCall) errCall[1](err);
      });
      // Never invoke the response callback — simulates no response / hang
      https.request.mockImplementationOnce(() => mockReq);

      await expect(
        initiateDeviceCodeFlow('test-client', ['Mail.Read'])
      ).rejects.toThrow(/timed out/i);
    });
  });

  describe('pollForToken', () => {
    it('returns tokens on successful auth after pending', async () => {
      // First poll: authorization_pending, second: success
      mockHttpsResponse(400, { error: 'authorization_pending' });
      mockHttpsResponse(200, {
        access_token: 'at_123',
        refresh_token: 'rt_456',
        expires_in: 3600,
        scope: 'Mail.Read',
        token_type: 'Bearer',
      });

      // Use interval=0.001 (1ms) for fast tests
      const result = await pollForToken('test-client', 'dc_123', 0.001, 30);
      expect(result.access_token).toBe('at_123');
      expect(result.refresh_token).toBe('rt_456');
    });

    it('returns tokens on immediate success', async () => {
      mockHttpsResponse(200, {
        access_token: 'at_direct',
        refresh_token: 'rt_direct',
        expires_in: 3600,
      });

      const result = await pollForToken('test-client', 'dc_123', 0.001, 30);
      expect(result.access_token).toBe('at_direct');
    });

    it('increases interval on slow_down', async () => {
      // slow_down, then success
      mockHttpsResponse(400, { error: 'slow_down' });
      mockHttpsResponse(200, {
        access_token: 'at_slow',
        refresh_token: 'rt_slow',
        expires_in: 3600,
      });

      // After slow_down, interval increases by 5s (0.001 + 5 = ~5s)
      const result = await pollForToken('test-client', 'dc_123', 0.001, 30);
      expect(result.access_token).toBe('at_slow');
      expect(https.request).toHaveBeenCalledTimes(2);
    }, 10000);

    it('throws on authorization_declined', async () => {
      mockHttpsResponse(400, { error: 'authorization_declined' });

      await expect(
        pollForToken('test-client', 'dc_123', 0.001, 30)
      ).rejects.toThrow('declined by the user');
    });

    it('throws on expired_token', async () => {
      mockHttpsResponse(400, { error: 'expired_token' });

      await expect(
        pollForToken('test-client', 'dc_123', 0.001, 30)
      ).rejects.toThrow('expired');
    });

    it('throws on unknown error', async () => {
      mockHttpsResponse(400, {
        error: 'server_error',
        error_description: 'Something went wrong',
      });

      await expect(
        pollForToken('test-client', 'dc_123', 0.001, 30)
      ).rejects.toThrow('Something went wrong');
    });

    // The poll loop handles expired_token / authorization_pending in explicit
    // cases, so they never reach the classifier — and the errors it does throw
    // for them must not be mistaken for a scope rejection (which would
    // silently strip shared-mailbox scopes).
    it('expired_token throws an error the classifier does not treat as a scope rejection', async () => {
      mockHttpsResponse(400, { error: 'expired_token' });

      const err = await pollForToken('test-client', 'dc_123', 0.001, 30).catch(
        (e) => e
      );
      expect(err.oauth).toBeUndefined();
      expect(isScopeConsentError(err)).toBe(false);
    });

    it('attaches the oauth payload only on the default branch', async () => {
      mockHttpsResponse(400, {
        error: 'invalid_grant',
        error_codes: [50076],
        error_description: 'AADSTS50076: MFA required',
      });

      const err = await pollForToken('test-client', 'dc_123', 0.001, 30).catch(
        (e) => e
      );
      expect(err.oauth.error).toBe('invalid_grant');
      expect(isScopeConsentError(err)).toBe(false);
    });
  });
});
