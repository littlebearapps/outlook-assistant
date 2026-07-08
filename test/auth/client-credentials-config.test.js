describe('client credentials config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  test('device-code remains the default auth method', () => {
    delete process.env.OUTLOOK_AUTH_METHOD;
    const config = require('../../config');
    expect(config.AUTH_CONFIG.defaultAuthMethod).toBe('device-code');
  });

  test('exposes client credentials env settings without changing delegated scopes', () => {
    process.env.OUTLOOK_AUTH_METHOD = 'client-credentials';
    process.env.OUTLOOK_TENANT_ID = '11111111-2222-3333-4444-555555555555';
    process.env.OUTLOOK_CERT_PATH = '/cert.pem';
    process.env.OUTLOOK_KEY_PATH = '/key.pem';
    process.env.OUTLOOK_TARGET_USER = 'user@example.com';

    const config = require('../../config');

    expect(config.AUTH_CONFIG.defaultAuthMethod).toBe('client-credentials');
    expect(config.CLIENT_CREDENTIALS_CONFIG).toEqual({
      tenantId: '11111111-2222-3333-4444-555555555555',
      certPath: '/cert.pem',
      keyPath: '/key.pem',
      targetUser: 'user@example.com',
    });
    expect(config.AUTH_CONFIG.scopes).toContain('offline_access');
    expect(config.CLIENT_CREDENTIALS_SCOPE).toBe(
      'https://graph.microsoft.com/.default'
    );
  });
});
