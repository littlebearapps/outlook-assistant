/**
 * Microsoft Graph API helper functions
 */
const https = require('https');
const config = require('../config');
const mockData = require('./mock-data');
const { log, graphPathShape } = require('./logger');

/**
 * Guard for caller-supplied full URLs (nextLink/deltaLink continuations).
 * The bearer token is attached to every request, so only the configured
 * Graph host over HTTPS on the default port is allowed (GHSA-mqfm-wfjq-jxq2).
 * @param {string} url - Full URL about to be requested
 * @throws {Error} If the URL is malformed or not the Graph host
 */
function assertGraphUrl(url) {
  const allowed = new URL(config.GRAPH_API_ENDPOINT);
  let target;
  try {
    target = new URL(url);
  } catch {
    target = null;
  }

  const ok =
    target &&
    target.protocol === 'https:' &&
    target.hostname === allowed.hostname &&
    target.port === '' &&
    target.username === '' &&
    target.password === '';

  if (!ok) {
    throw new Error(
      'Refusing to call non-Graph URL: continuation links must be https://' +
        `${allowed.hostname}/ (check the deltaToken or nextLink value)`
    );
  }
}

/**
 * Fully percent-decode a value (bounded), so `%2e`, `%252e` etc. are seen as
 * the characters they eventually stand for. Malformed escapes stop decoding.
 * @param {string} value
 * @returns {string}
 */
function decodeFully(value) {
  let current = value;
  for (let i = 0; i < 5; i++) {
    let next;
    try {
      next = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Is this path segment a dot segment (`.` or `..`) in any encoding?
 * @param {string} segment
 * @returns {boolean}
 */
function isDotSegment(segment) {
  const decoded = decodeFully(String(segment)).trim();
  return decoded === '.' || decoded === '..';
}

/**
 * Reject relative Graph resource paths containing dot segments. Caller-supplied
 * IDs (message, folder, attachment, delta tokens) are interpolated into these
 * paths, and URL normalisation would otherwise let `..` walk the request to a
 * different Graph resource (another mailbox, another API version) than the
 * tool intended. Legitimate Graph IDs never contain a bare `.`/`..` segment.
 * @param {string} resourcePath - Relative path (query string, if any, ignored)
 * @throws {Error} If any segment is `.` or `..` (literal or percent-encoded)
 */
function assertSafeResourcePath(resourcePath) {
  const pathOnly = String(resourcePath).split('?')[0];
  if (pathOnly.split('/').some(isDotSegment)) {
    throw new Error(
      'Invalid resource path: IDs must not contain "." or ".." path segments'
    );
  }
}

/**
 * Build the request URL for a Graph resource path (or validate a full
 * continuation URL). Pure: never mutates `queryParams`, so retries and
 * callers that reuse the object always see the original `$filter`.
 * Host and dot-segment guards run here, once, before any attempt.
 * @param {string} path - Relative resource path, or a full nextLink/deltaLink URL
 * @param {object} [queryParams] - Query parameters (`$filter` gets OData-safe encoding)
 * @returns {string} Absolute URL
 * @throws {Error} If the full URL is not Graph, or the path has dot segments
 */
function buildGraphUrl(path, queryParams = {}) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    // Path is already a full URL (from pagination nextLink / deltaLink)
    assertGraphUrl(path);
    return path;
  }

  // Refuse dot segments before encoding: encodeURIComponent leaves `..`
  // intact, and the URL parser would then resolve it to a different resource.
  assertSafeResourcePath(path);
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  // $filter is encoded separately to ensure proper OData URI encoding
  const { $filter: filter, ...rest } = queryParams || {};
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) {
    params.append(key, value);
  }
  let queryString = params.toString();
  if (filter) {
    const encodedFilter = `$filter=${encodeURIComponent(filter)}`;
    queryString = queryString
      ? `${queryString}&${encodedFilter}`
      : encodedFilter;
  }

  return `${config.GRAPH_API_ENDPOINT}${encodedPath}${queryString ? `?${queryString}` : ''}`;
}

// --- Concurrency gate -------------------------------------------------------
// Graph throttles per app+mailbox; bulk tools fan out many calls at once.
// At most MAX_CONCURRENT_REQUESTS sends are in flight; the rest queue FIFO.
const MAX_CONCURRENT_REQUESTS = 4;
let inFlightRequests = 0;
const slotWaiters = [];

function acquireSlot() {
  if (inFlightRequests < MAX_CONCURRENT_REQUESTS) {
    inFlightRequests += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    slotWaiters.push(resolve);
  });
}

function releaseSlot() {
  const next = slotWaiters.shift();
  if (next) {
    next(); // hand the slot straight to the next waiter
  } else {
    inFlightRequests -= 1;
  }
}

/**
 * Perform a single HTTPS request (no retries). The body is read as UTF-8.
 * @param {object} options
 * @param {string} options.url
 * @param {string} options.method
 * @param {object} options.headers
 * @param {string|null} [options.body] - Serialised request body
 * @param {number} options.timeoutMs - Socket idle timeout
 * @returns {Promise<{status: number, headers: object, text: string}>}
 * @throws {Error} Network errors (with `.code`); timeouts have code `ETIMEDOUT`
 */
function sendOnce({ url, method, headers, body = null, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    const req = https.request(
      url,
      { method, headers, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        res.on('error', fail);
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode,
            headers: res.headers || {},
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.on('timeout', () => {
      const error = new Error(`Request timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      fail(error);
      if (typeof req.destroy === 'function') {
        req.destroy(error);
      }
    });
    req.on('error', fail);

    if (body !== null && body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

const RETRYABLE_STATUSES = new Set([429, 503, 504]);
const RETRY_STATUS_METHODS = new Set(['GET', 'PUT', 'DELETE', 'PATCH']);
const RETRYABLE_NETWORK_CODES = new Set(['ETIMEDOUT', 'ECONNRESET']);
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;
const MAX_RETRY_AFTER_SECONDS = 60;
// POST (sendMail, /send, …) must finish well inside an MCP client's ~60 s
// request timeout: if the client gives up while we sleep and the send later
// succeeds, the model may send again. So a POST only waits out a short 429.
const POST_MAX_RETRY_DELAY_MS = 10000;
const POST_MAX_TOTAL_SLEEP_MS = 20000;

/**
 * Can this response be retried for this method? POST (sendMail, /send,
 * createReply, move, $batch) is retried only on 429 — the request was
 * refused, so it cannot have taken effect. 503/504 may have been applied.
 */
function isRetryableStatus(method, status) {
  if (!RETRYABLE_STATUSES.has(status)) return false;
  return status === 429 || RETRY_STATUS_METHODS.has(method);
}

/** Retry-After in seconds, or null when absent/unparseable. */
function parseRetryAfterSeconds(headers) {
  const raw = headers['retry-after'];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Exponential backoff with full jitter for retry number `retry` (0-based). */
function backoffDelayMs(retry) {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** retry);
  return Math.floor(Math.random() * ceiling);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Send a request through the concurrency gate, retrying throttled and
 * transient failures: 429 (all methods) and 503/504 (GET/PUT/DELETE/PATCH)
 * up to MAX_RETRIES times, honouring Retry-After; GET also retries once on
 * ETIMEDOUT/ECONNRESET. A POST waits out a 429 only if that delay is
 * ≤ 10 s and its total sleep stays ≤ 20 s. The slot is released before any
 * backoff sleep.
 * @param {object} request - See sendOnce (timeoutMs defaults to config)
 * @returns {Promise<{status: number, headers: object, text: string}>} The
 *   final response (2xx, or the last non-retried error status)
 * @throws {Error} The network error of the final attempt
 */
async function sendWithRetry(request) {
  const method = String(request.method).toUpperCase();
  const timeoutMs = request.timeoutMs || config.REQUEST_TIMEOUT_MS;
  let networkRetryUsed = false;
  let totalSleepMs = 0;

  for (let retry = 0; ; retry++) {
    await acquireSlot();
    let response;
    let networkError;
    try {
      response = await sendOnce({ ...request, timeoutMs });
    } catch (error) {
      networkError = error;
    } finally {
      releaseSlot();
    }

    let delayMs;
    if (networkError) {
      const retryable =
        method === 'GET' &&
        !networkRetryUsed &&
        retry < MAX_RETRIES &&
        RETRYABLE_NETWORK_CODES.has(networkError.code);
      if (!retryable) throw networkError;
      networkRetryUsed = true;
      delayMs = backoffDelayMs(retry);
    } else {
      if (retry >= MAX_RETRIES || !isRetryableStatus(method, response.status)) {
        return response;
      }
      const retryAfter = parseRetryAfterSeconds(response.headers);
      if (retryAfter !== null && retryAfter > MAX_RETRY_AFTER_SECONDS) {
        return response; // fail fast rather than block for minutes
      }
      delayMs = retryAfter !== null ? retryAfter * 1000 : backoffDelayMs(retry);
      if (
        method === 'POST' &&
        (delayMs > POST_MAX_RETRY_DELAY_MS ||
          totalSleepMs + delayMs > POST_MAX_TOTAL_SLEEP_MS)
      ) {
        return response; // surface the 429 rather than outlast the client
      }
    }

    log.increment('graphRetries');
    log.debug(
      `[GRAPH-API] ${method} ${networkError ? networkError.code : response.status}; ` +
        `retry ${retry + 1}/${MAX_RETRIES} in ${delayMs} ms`
    );
    totalSleepMs += delayMs;
    await sleep(delayMs);
  }
}

/**
 * sendWithRetry, noting a final failure on the current tool call's log line
 * as status (or network error code), method and a PII-free path shape (#278).
 * @param {object} request - See sendWithRetry
 * @returns {Promise<{status: number, headers: object, text: string}>}
 */
async function requestWithRetry(request) {
  const method = String(request.method).toUpperCase();
  try {
    const response = await sendWithRetry(request);
    if (response.status >= 400) {
      log.note(
        'graph',
        `${response.status} ${method} ${graphPathShape(request.url)}`
      );
      log.debug(
        `[GRAPH-API] ${method} ${request.url} failed with ${response.status}: ${response.text}`
      );
    }
    return response;
  } catch (error) {
    log.note(
      'graph',
      `${error.code || 'network-error'} ${method} ${graphPathShape(request.url)}`
    );
    log.debug(`[GRAPH-API] ${method} ${request.url} failed:`, error);
    throw error;
  }
}

/**
 * Makes a request to the Microsoft Graph API
 * In test mode (USE_TEST_MODE=true), routes to mock data instead of the real API.
 * Throttled/transient responses are retried (see requestWithRetry); each
 * attempt times out after OUTLOOK_REQUEST_TIMEOUT_MS.
 * @param {string} accessToken - The access token for authentication
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - API endpoint path
 * @param {object} data - Data to send for POST/PUT requests
 * @param {object} queryParams - Query parameters (never mutated)
 * @param {object} extraHeaders - Additional headers (e.g. Prefer for immutable IDs)
 * @returns {Promise<object>} - The API response
 * @throws {Error} 'UNAUTHORIZED' if the server returns HTTP 401 (token expired or invalid)
 * @throws {Error} If the HTTP status is outside 2xx, or if JSON parsing or network fails
 */
async function callGraphAPI(
  accessToken,
  method,
  path,
  data = null,
  queryParams = {},
  extraHeaders = {}
) {
  // For test tokens, we'll simulate the API call
  if (config.USE_TEST_MODE && accessToken.startsWith('test_access_token_')) {
    return mockData.simulateGraphAPIResponse(method, path, data, queryParams);
  }

  let finalUrl;
  try {
    finalUrl = buildGraphUrl(path, queryParams);
  } catch (error) {
    log.debug('Error calling Graph API:', error);
    throw error;
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Add immutable IDs header when enabled globally
  if (config.USE_IMMUTABLE_IDS) {
    headers.Prefer = 'IdType="ImmutableId"';
  }

  // Merge any extra headers (caller overrides take precedence). `Prefer`
  // is multi-valued in HTTP (comma-separated); combine both values rather
  // than letting a caller Prefer (e.g. outlook.timezone) clobber the global
  // immutable-IDs Prefer, or vice versa.
  const combinedPrefer =
    headers.Prefer && extraHeaders.Prefer
      ? `${headers.Prefer}, ${extraHeaders.Prefer}`
      : null;
  Object.assign(headers, extraHeaders);
  if (combinedPrefer) {
    headers.Prefer = combinedPrefer;
  }

  const body =
    data && (method === 'POST' || method === 'PATCH' || method === 'PUT')
      ? JSON.stringify(data)
      : null;

  let response;
  try {
    response = await requestWithRetry({ url: finalUrl, method, headers, body });
  } catch (error) {
    const wrapped = new Error(
      `Network error during API call: ${error.message}`,
      { cause: error }
    );
    wrapped.code = error.code;
    throw wrapped;
  }

  if (response.status >= 200 && response.status < 300) {
    try {
      return JSON.parse(response.text || '{}');
    } catch (error) {
      throw new Error(`Error parsing API response: ${error.message}`, {
        cause: error,
      });
    }
  }
  if (response.status === 401) {
    // Token expired or invalid
    throw new Error('UNAUTHORIZED');
  }
  // Truncate response to avoid leaking sensitive data in error messages
  throw new Error(
    `API call failed with status ${response.status}: ${response.text.substring(0, 200)}`
  );
}

/**
 * Calls Graph API with pagination support to retrieve all results up to maxCount
 * @param {string} accessToken - The access token for authentication
 * @param {string} method - HTTP method (GET only for pagination)
 * @param {string} path - API endpoint path
 * @param {object} queryParams - Initial query parameters
 * @param {number} maxCount - Maximum number of items to retrieve (0 = all)
 * @returns {Promise<object>} - Combined API response with all items
 * @throws {Error} If method is not 'GET'
 * @throws {Error} If any page request fails for any other reason
 */
async function callGraphAPIPaginated(
  accessToken,
  method,
  path,
  queryParams = {},
  maxCount = 0
) {
  if (method !== 'GET') {
    throw new Error('Pagination only supports GET requests');
  }

  const allItems = [];
  let nextLink;
  let currentUrl = path;
  let currentParams = { ...queryParams };

  try {
    do {
      // Make API call
      const response = await callGraphAPI(
        accessToken,
        method,
        currentUrl,
        null,
        currentParams
      );

      // Add items from this page
      if (response.value && Array.isArray(response.value)) {
        allItems.push(...response.value);
      }

      // Check if we've reached the desired count
      if (maxCount > 0 && allItems.length >= maxCount) {
        break;
      }

      // Get next page URL
      nextLink = response['@odata.nextLink'];

      if (nextLink) {
        // Pass the full nextLink URL directly to callGraphAPI
        currentUrl = nextLink;
        currentParams = {}; // nextLink already contains all params
      }
    } while (nextLink);

    // Trim to exact count if needed
    const finalItems = maxCount > 0 ? allItems.slice(0, maxCount) : allItems;

    return {
      value: finalItems,
      '@odata.count': finalItems.length,
    };
  } catch (error) {
    log.debug('Error during pagination:', error);
    throw error;
  }
}

/**
 * Sends multiple Graph API requests in a single batch call ($batch).
 * Supports up to 20 requests per batch (Graph API limit).
 * @param {string} accessToken - The access token for authentication
 * @param {Array<{id: string, method: string, url: string, body?: object, headers?: object}>} requests - Batch requests
 * @returns {Promise<Array<{id: string, status: number, body: object}>>} - Array of responses
 */
async function callGraphAPIBatch(accessToken, requests) {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('Batch requests must be a non-empty array');
  }

  if (requests.length > 20) {
    throw new Error('Batch requests cannot exceed 20 (Graph API limit)');
  }

  // Test mode
  if (config.USE_TEST_MODE && accessToken.startsWith('test_access_token_')) {
    return requests.map((req) => ({
      id: req.id,
      status: 200,
      body: mockData.simulateGraphAPIResponse(
        req.method,
        req.url,
        req.body || null,
        {}
      ),
    }));
  }

  // Batch sub-request URLs are resolved by Graph itself — apply the same
  // dot-segment guard as single requests.
  for (const req of requests) {
    assertSafeResourcePath(req.url);
  }

  const batchPayload = {
    requests: requests.map((req) => ({
      id: req.id,
      method: req.method,
      url: req.url.startsWith('/') ? req.url : `/${req.url}`,
      ...(req.body && { body: req.body }),
      ...(req.headers && { headers: req.headers }),
    })),
  };

  const response = await callGraphAPI(
    accessToken,
    'POST',
    '$batch',
    batchPayload
  );

  return (response.responses || []).sort(
    (a, b) => parseInt(a.id) - parseInt(b.id)
  );
}

/**
 * Calls Graph API to get raw MIME content (for email export)
 * In test mode (USE_TEST_MODE=true), returns mock MIME content instead of calling the real API.
 * @param {string} accessToken - The access token for authentication
 * @param {string} emailId - The email ID to export
 * @param {string} [mailboxPrefix] - Resource prefix (`me` or `users/{email}`) for shared mailboxes. Defaults to `me`.
 * @returns {Promise<string>} - Raw MIME content as string
 * @throws {Error} 'UNAUTHORIZED' if the server returns HTTP 401 (token expired or invalid)
 * @throws {Error} If the HTTP status is outside 2xx or a network error occurs
 */
async function callGraphAPIRaw(accessToken, emailId, mailboxPrefix = 'me') {
  // Test mode: return mock MIME content
  if (config.USE_TEST_MODE && accessToken.startsWith('test_access_token_')) {
    return mockData.getMockMimeContent
      ? mockData.getMockMimeContent(emailId)
      : `MIME-Version: 1.0\nContent-Type: text/plain\n\nTest email content for ${emailId}`;
  }

  // `emailId` is encoded as a single segment, but a bare `.`/`..` id would
  // still be resolved as a dot segment — refuse it (and any in the prefix).
  assertSafeResourcePath(`${mailboxPrefix}/messages`);
  if (isDotSegment(emailId)) {
    throw new Error(
      'Invalid resource path: IDs must not contain "." or ".." path segments'
    );
  }

  const encodedPrefix = mailboxPrefix
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const path = `${encodedPrefix}/messages/${encodeURIComponent(emailId)}/$value`;

  let response;
  try {
    response = await requestWithRetry({
      url: `${config.GRAPH_API_ENDPOINT}${path}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'message/rfc822', // Request MIME format
      },
    });
  } catch (error) {
    const wrapped = new Error(
      `Network error during MIME export: ${error.message}`,
      { cause: error }
    );
    wrapped.code = error.code;
    throw wrapped;
  }

  if (response.status >= 200 && response.status < 300) {
    return response.text;
  }
  if (response.status === 401) {
    throw new Error('UNAUTHORIZED');
  }
  throw new Error(
    `MIME export failed with status ${response.status}: ${response.text.substring(0, 200)}`
  );
}

module.exports = {
  assertSafeResourcePath,
  callGraphAPI,
  callGraphAPIPaginated,
  callGraphAPIBatch,
  callGraphAPIRaw,
};
