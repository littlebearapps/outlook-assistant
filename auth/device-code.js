/**
 * Device Code Flow for Microsoft OAuth2
 *
 * Enables authentication without browser redirect — ideal for
 * headless/remote environments (SSH, VPS, containers).
 *
 * The user gets a short code, visits https://microsoft.com/devicelogin
 * on any device, and enters it. No auth server or port forwarding needed.
 */
const https = require('https');
const querystring = require('querystring');
const config = require('../config');

// Fail fast if the OAuth endpoint is unreachable (e.g. blocked outbound
// egress in a sandboxed connector) instead of hanging indefinitely. (#213)
const REQUEST_TIMEOUT_MS = 15000;

/**
 * POST helper for OAuth2 endpoints
 * @param {string} url - Full URL to POST to
 * @param {string} postData - URL-encoded form data
 * @returns {Promise<{statusCode: number, body: object}>}
 */
function postRequest(url, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
          } catch (_e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(
        new Error(
          'Device code request timed out — network egress to login.microsoftonline.com may be blocked.'
        )
      );
    });
    req.write(postData);
    req.end();
  });
}

/**
 * Initiates the device code flow by requesting a device code from Azure.
 * @param {string} clientId - Azure app client ID
 * @param {string[]} scopes - OAuth2 scopes to request
 * @returns {Promise<{userCode: string, verificationUri: string, deviceCode: string, expiresIn: number, interval: number, message: string}>}
 */
async function initiateDeviceCodeFlow(clientId, scopes) {
  const postData = querystring.stringify({
    client_id: clientId,
    scope: scopes.join(' '),
  });

  const endpoint = config.AUTH_CONFIG.deviceCodeEndpoint;
  const { statusCode, body } = await postRequest(endpoint, postData);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      body.error_description ||
        `Device code request failed with status ${statusCode}`
    );
  }

  return {
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    deviceCode: body.device_code,
    expiresIn: body.expires_in,
    interval: body.interval || 5,
    message: body.message,
  };
}

/**
 * Polls the token endpoint until the user completes authentication.
 * @param {string} clientId - Azure app client ID
 * @param {string} deviceCode - Device code from initiateDeviceCodeFlow
 * @param {number} interval - Polling interval in seconds
 * @param {number} expiresIn - Seconds until the device code expires
 * @returns {Promise<{access_token: string, refresh_token: string, expires_in: number, scope: string, token_type: string}>}
 */
async function pollForToken(clientId, deviceCode, interval, expiresIn) {
  const endpoint = config.AUTH_CONFIG.tokenEndpoint;
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval;

  while (Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, pollInterval * 1000);
    });

    const postData = querystring.stringify({
      client_id: clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    });

    const { statusCode, body } = await postRequest(endpoint, postData);

    if (statusCode >= 200 && statusCode < 300) {
      return body;
    }

    switch (body.error) {
      case 'authorization_pending':
        // User hasn't completed auth yet — keep polling
        break;
      case 'slow_down':
        // Server asked us to slow down — increase interval by 5s
        pollInterval += 5;
        break;
      case 'authorization_declined':
        throw new Error('Authentication was declined by the user.');
      case 'expired_token':
        throw new Error(
          'Device code expired. Please restart the authentication process.'
        );
      default: {
        // Attach the raw OAuth payload so callers (e.g. handleDeviceCodeComplete)
        // can classify the failure — notably scope-consent rejections that should
        // trigger a base-scopes fallback. Keep the existing message text.
        const e = new Error(
          body.error_description ||
            `Token polling failed: ${body.error || `status ${statusCode}`}`
        );
        e.oauth = {
          error: body.error,
          error_codes: body.error_codes,
          suberror: body.suberror,
          error_description: body.error_description,
        };
        throw e;
      }
    }
  }

  throw new Error(
    'Device code expired. Please restart the authentication process.'
  );
}

// AADSTS codes meaning "this scope value isn't supported for this account" —
// the only signals that justify a SILENT, DURABLE downgrade to base scopes:
//   650053 — "The application asked for scope '<x>' that doesn't exist on the
//             resource" (the personal-account `.Shared` rejection)
//   70011  — invalid scope value
// Deliberately NOT here:
//   65001  — consent required (remediable: user/admin consent) → see
//             isConsentRequiredError; must not silently strip capability
//   28000  — generic invalid request, not scope-specific
//   invalid_grant (bare) — MFA/conditional access, revoked grant, tenant policy
const SCOPE_UNSUPPORTED_AADSTS_CODES = ['650053', '70011'];
const CONSENT_REQUIRED_AADSTS_CODES = ['65001'];

/**
 * Does `err` carry one of `codes` in `oauth.error_codes` (array) or as an
 * `AADSTS<code>` substring in `oauth.error_description` / `err.message`?
 * @param {Error & {oauth?: object}} err
 * @param {string[]} codes
 * @returns {boolean}
 */
// The OAuth error payload is attacker-influencable HTTP data — fields may
// arrive as arrays or objects instead of strings. Coerce before substring
// checks so `includes` is always String.prototype.includes.
function asString(value) {
  return typeof value === 'string' ? value : '';
}

function hasAadstsCode(err, codes) {
  const oauth = err.oauth || {};
  if (Array.isArray(oauth.error_codes)) {
    const found = oauth.error_codes.map(String);
    if (found.some((c) => codes.includes(c))) {
      return true;
    }
  }
  const haystack = `${asString(oauth.error_description)} ${asString(err.message)}`;
  return codes.some((code) => haystack.includes(`AADSTS${code}`));
}

/**
 * Predicate: is this a "requested scope isn't supported for this account"
 * rejection that warrants falling back to base scopes? Deliberately narrow —
 * a false positive silently and permanently strips shared-mailbox access.
 * @param {Error & {oauth?: object}} err
 * @returns {boolean}
 */
function isScopeConsentError(err) {
  if (!err) {
    return false;
  }
  const oauth = err.oauth || {};

  if (oauth.error === 'invalid_scope') {
    return true;
  }
  if (hasAadstsCode(err, SCOPE_UNSUPPORTED_AADSTS_CODES)) {
    return true;
  }
  // Azure named one of the `.Shared` scopes as the offending value.
  const description = asString(oauth.error_description);
  return config.SHARED_SCOPES.some((scope) => description.includes(scope));
}

/**
 * Predicate: consent required (AADSTS65001). Remediable via user/admin consent
 * — surface it, never downgrade the scope set.
 * @param {Error & {oauth?: object}} err
 * @returns {boolean}
 */
function isConsentRequiredError(err) {
  return Boolean(err) && hasAadstsCode(err, CONSENT_REQUIRED_AADSTS_CODES);
}

module.exports = {
  initiateDeviceCodeFlow,
  pollForToken,
  isScopeConsentError,
  isConsentRequiredError,
};
