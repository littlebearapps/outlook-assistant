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
    await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));

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
      default:
        throw new Error(
          body.error_description ||
            `Token polling failed: ${body.error || `status ${statusCode}`}`
        );
    }
  }

  throw new Error(
    'Device code expired. Please restart the authentication process.'
  );
}

module.exports = {
  initiateDeviceCodeFlow,
  pollForToken,
};
