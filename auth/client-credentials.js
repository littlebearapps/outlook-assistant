/**
 * Certificate-based OAuth client credentials flow for app-only Graph auth.
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');

const CLIENT_CREDENTIALS_SCOPE = 'https://graph.microsoft.com/.default';
const CLIENT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const TENANT_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function certPemToDer(certPem) {
  const body = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  if (!body) {
    throw new Error('OUTLOOK_CERT_PATH does not contain a PEM certificate.');
  }
  return Buffer.from(body, 'base64');
}

function buildTokenEndpoint(tenantId) {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

function buildClientAssertion({ clientId, tenantId, certPem, keyPem }) {
  const tokenEndpoint = buildTokenEndpoint(tenantId);
  const now = Math.floor(Date.now() / 1000);
  const certDer = certPemToDer(certPem);
  const thumbprint = crypto.createHash('sha1').update(certDer).digest();

  const header = {
    alg: 'RS256',
    typ: 'JWT',
    x5t: base64Url(thumbprint),
  };
  const payload = {
    aud: tokenEndpoint,
    iss: clientId,
    sub: clientId,
    jti: crypto.randomUUID(),
    nbf: now,
    exp: now + 600,
  };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload)
  )}`;
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(signingInput),
    keyPem
  );

  return `${signingInput}.${base64Url(signature)}`;
}

function formatTokenError(statusCode, responseBody) {
  let errorMessage = responseBody;
  try {
    const parsed = JSON.parse(responseBody || '{}');
    errorMessage = parsed.error_description || parsed.error || responseBody;
  } catch {
    // Use raw response body.
  }

  if (/AADSTS65001|consent_required/i.test(errorMessage)) {
    return (
      `Client credentials token request failed with status ${statusCode}: ${errorMessage}\n\n` +
      'Admin consent is required for application permissions. Grant tenant-admin consent to the app permissions and ensure Exchange app access is scoped to the target mailbox.'
    );
  }

  return `Client credentials token request failed with status ${statusCode}: ${errorMessage}`;
}

function requestToken(tokenEndpoint, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      tokenEndpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(responseBody || '{}'));
            } catch (error) {
              reject(
                new Error(
                  `Error parsing client credentials response: ${error.message}`
                )
              );
            }
            return;
          }
          reject(new Error(formatTokenError(res.statusCode, responseBody)));
        });
      }
    );

    req.on('error', (error) => {
      reject(
        new Error(
          `Network error during client credentials token request: ${error.message}`
        )
      );
    });
    req.write(body);
    req.end();
  });
}

function acquireTokenWithCertificate(options) {
  validateClientCredentialsConfig({
    authConfig: {
      clientId: options.clientId,
      audience: options.tenantId,
    },
    clientCredentialsConfig: {
      tenantId: options.tenantId,
      certPath: options.certPath,
      keyPath: options.keyPath,
      targetUser: options.targetUser || 'target@example.com',
    },
  });

  const certPem = fs.readFileSync(options.certPath, 'utf8');
  const keyPem = fs.readFileSync(options.keyPath, 'utf8');
  const tokenEndpoint = buildTokenEndpoint(options.tenantId);
  const clientAssertion = buildClientAssertion({
    clientId: options.clientId,
    tenantId: options.tenantId,
    certPem,
    keyPem,
  });

  const params = new URLSearchParams({
    client_id: options.clientId,
    scope: CLIENT_CREDENTIALS_SCOPE,
    grant_type: 'client_credentials',
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: clientAssertion,
  });

  return requestToken(tokenEndpoint, params.toString());
}

function validateClientCredentialsConfig({
  authConfig,
  clientCredentialsConfig,
}) {
  const missing = [];
  if (!authConfig.clientId) missing.push('OUTLOOK_CLIENT_ID');
  if (!clientCredentialsConfig.tenantId) missing.push('OUTLOOK_TENANT_ID');
  if (!clientCredentialsConfig.certPath) missing.push('OUTLOOK_CERT_PATH');
  if (!clientCredentialsConfig.keyPath) missing.push('OUTLOOK_KEY_PATH');
  if (!clientCredentialsConfig.targetUser) missing.push('OUTLOOK_TARGET_USER');

  if (missing.length > 0) {
    throw new Error(
      `Client credentials auth is missing required config: ${missing.join(', ')}.`
    );
  }

  if (!TENANT_GUID_RE.test(clientCredentialsConfig.tenantId)) {
    throw new Error(
      'OUTLOOK_TENANT_ID must be a tenant GUID for client credentials auth. Values like common, consumers, and organizations are delegated-auth audiences and do not work for app-only Graph permissions.'
    );
  }

  if (
    authConfig.audience &&
    !TENANT_GUID_RE.test(authConfig.audience) &&
    authConfig.audience !== clientCredentialsConfig.tenantId
  ) {
    throw new Error(
      'OUTLOOK_AUTH_AUDIENCE must be the same tenant GUID as OUTLOOK_TENANT_ID when using client credentials auth.'
    );
  }
}

class ClientCredentialsProvider {
  constructor(options = {}) {
    this.options = options;
    this.cachedToken = null;
  }

  async getValidAccessToken() {
    if (
      this.cachedToken &&
      this.cachedToken.access_token &&
      this.cachedToken.expires_at - Date.now() > REFRESH_BUFFER_MS
    ) {
      return this.cachedToken.access_token;
    }

    const token = await acquireTokenWithCertificate(this.options);
    this.cachedToken = {
      ...token,
      auth_method: 'client-credentials',
      expires_at: Date.now() + (token.expires_in || 3600) * 1000,
    };
    return this.cachedToken.access_token;
  }

  getExpiryTime() {
    return this.cachedToken?.expires_at || null;
  }

  clearCache() {
    this.cachedToken = null;
  }
}

module.exports = {
  CLIENT_CREDENTIALS_SCOPE,
  ClientCredentialsProvider,
  acquireTokenWithCertificate,
  buildClientAssertion,
  validateClientCredentialsConfig,
};
