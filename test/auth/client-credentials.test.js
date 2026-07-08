const https = require('https');
const fs = require('fs');
const { EventEmitter } = require('events');
const { generateKeyPairSync } = require('crypto');

jest.mock('https');
jest.mock('fs');

const PRIVATE_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

const CERT_PEM = [
  '-----BEGIN CERTIFICATE-----',
  Buffer.from('test certificate bytes').toString('base64'),
  '-----END CERTIFICATE-----',
].join('\n');

function mockTokenResponse(body, statusCode = 200) {
  const mockReq = new EventEmitter();
  mockReq.write = jest.fn();
  mockReq.end = jest.fn();

  https.request.mockImplementation((_url, _options, callback) => {
    const mockRes = new EventEmitter();
    mockRes.statusCode = statusCode;
    process.nextTick(() => {
      callback(mockRes);
      mockRes.emit('data', JSON.stringify(body));
      mockRes.emit('end');
    });
    return mockReq;
  });

  return mockReq;
}

describe('app-only client credentials auth', () => {
  let provider;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath === '/cert.pem') return CERT_PEM;
      if (filePath === '/key.pem') return PRIVATE_KEY;
      throw new Error(`Unexpected file: ${filePath}`);
    });
    provider = require('../../auth/client-credentials');
  });

  test('app-only token acquisition uses certificate assertion and .default scope', async () => {
    const request = mockTokenResponse({
      access_token: 'app-token-1',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    const token = await provider.acquireTokenWithCertificate({
      tenantId: '11111111-2222-3333-4444-555555555555',
      clientId: 'client-id-123',
      certPath: '/cert.pem',
      keyPath: '/key.pem',
    });

    expect(token.access_token).toBe('app-token-1');
    expect(https.request).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token',
      expect.objectContaining({ method: 'POST' }),
      expect.any(Function)
    );

    const body = request.write.mock.calls[0][0];
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('scope')).toBe('https://graph.microsoft.com/.default');
    expect(params.get('client_id')).toBe('client-id-123');
    expect(params.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
    );

    const [header, payload] = params.get('client_assertion').split('.');
    const decodedHeader = JSON.parse(
      Buffer.from(header, 'base64url').toString('utf8')
    );
    const decodedPayload = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );
    expect(decodedHeader).toMatchObject({ alg: 'PS256', typ: 'JWT' });
    expect(decodedHeader['x5t#S256']).toBeTruthy();
    expect(decodedPayload).toMatchObject({
      iss: 'client-id-123',
      sub: 'client-id-123',
      aud: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token',
    });
    expect(decodedPayload.exp).toBeGreaterThan(decodedPayload.nbf);
  });

  test('app-only provider caches access tokens in memory and refetches before expiry', async () => {
    mockTokenResponse({
      access_token: 'cached-token',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    const appOnlyProvider = new provider.ClientCredentialsProvider({
      tenantId: '11111111-2222-3333-4444-555555555555',
      clientId: 'client-id-123',
      certPath: '/cert.pem',
      keyPath: '/key.pem',
    });

    await expect(appOnlyProvider.getValidAccessToken()).resolves.toBe(
      'cached-token'
    );
    await expect(appOnlyProvider.getValidAccessToken()).resolves.toBe(
      'cached-token'
    );
    expect(https.request).toHaveBeenCalledTimes(1);

    appOnlyProvider.cachedToken.expires_at = Date.now() + 60 * 1000;
    mockTokenResponse({
      access_token: 'refetched-token',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    await expect(appOnlyProvider.getValidAccessToken()).resolves.toBe(
      'refetched-token'
    );
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  test('app-only token errors include consent guidance', async () => {
    mockTokenResponse(
      {
        error: 'invalid_grant',
        error_description: 'AADSTS65001: consent_required',
      },
      400
    );

    await expect(
      provider.acquireTokenWithCertificate({
        tenantId: '11111111-2222-3333-4444-555555555555',
        clientId: 'client-id-123',
        certPath: '/cert.pem',
        keyPath: '/key.pem',
      })
    ).rejects.toThrow(/admin consent/i);
  });

  test('app-only config validation rejects missing target user and non-tenant audience', () => {
    expect(() =>
      provider.validateClientCredentialsConfig({
        authConfig: { clientId: 'client-id', audience: 'common' },
        clientCredentialsConfig: {
          tenantId: '',
          certPath: '/cert.pem',
          keyPath: '/key.pem',
          targetUser: '',
        },
      })
    ).toThrow(/OUTLOOK_TENANT_ID/);

    expect(() =>
      provider.validateClientCredentialsConfig({
        authConfig: { clientId: 'client-id', audience: 'common' },
        clientCredentialsConfig: {
          tenantId: 'common',
          certPath: '/cert.pem',
          keyPath: '/key.pem',
          targetUser: 'user@example.com',
        },
      })
    ).toThrow(/tenant GUID/);
  });
});
