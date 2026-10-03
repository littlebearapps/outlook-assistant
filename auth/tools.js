/**
 * Authentication-related tools for the Outlook Assistant server
 */
const config = require('../config');
const { getAuthErrorHints } = require('./auth-errors');
const fs = require('fs');
const path = require('path');
const tokenManager = require('./token-manager');
const {
  CONFIG_FILE_NAME,
  isValidClientId,
  saveClientId,
  getEnvClientId,
  getClientIdSource,
} = require('./client-config');
const {
  initiateDeviceCodeFlow,
  pollForToken,
  isScopeConsentError,
  isConsentRequiredError,
} = require('./device-code');
const { toolMetadata } = require('../utils/risk-classes');
const { toolError } = require('../utils/tool-error');

// Path for persisting device code state across MCP server restarts
const DEVICE_CODE_STATE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.outlook-assistant-pending-auth.json'
);

const SETUP_GUIDE_URL =
  'https://github.com/littlebearapps/outlook-assistant/blob/main/docs/how-to/getting-started/connect-outlook-to-claude.md';
const SAVED_CONFIG_DISPLAY_PATH = `~/${CONFIG_FILE_NAME}`;

/**
 * Error shown when no client ID resolves (no env var, nothing saved). Written
 * for the AI client: it tells it what to ask the user and which call to make.
 * @returns {object} - MCP response ({ content, isError: true })
 */
function buildMissingClientIdResponse() {
  return {
    content: [
      {
        type: 'text',
        text: [
          'Error: OUTLOOK_CLIENT_ID is not configured, so sign-in cannot start.',
          '',
          '1. Ask the user for the **Application (client) ID** of their Azure app registration (Azure portal → App registrations → their app → Overview). It is a GUID such as `00000000-0000-0000-0000-000000000000`.',
          `2. Call \`auth action=authenticate clientId=<id>\`. The ID is saved to \`${SAVED_CONFIG_DISPLAY_PATH}\` (it is not a secret) and device-code sign-in starts.`,
          '',
          'The client secret is not needed for device-code sign-in (the default); only the browser flow uses it.',
          `No app registration yet? Follow the setup guide: ${SETUP_GUIDE_URL}`,
          'Alternatively, set OUTLOOK_CLIENT_ID in the MCP server environment and restart it.',
        ].join('\n'),
      },
    ],
    isError: true,
  };
}

/**
 * Validate and save a client ID supplied via `auth action=authenticate`.
 * @param {unknown} clientId
 * @returns {{error: object}|{saved: string}} - An MCP error response, or the saved ID
 */
function applyClientIdArg(clientId) {
  if (!isValidClientId(clientId)) {
    return {
      error: {
        content: [
          {
            type: 'text',
            text: [
              'Error: `clientId` is not a valid Azure Application (client) ID.',
              '',
              'It must be the GUID shown as **Application (client) ID** on the app registration Overview page in the Azure portal, e.g. `00000000-0000-0000-0000-000000000000`. Do not use the Directory (tenant) ID, the Object ID or a client secret.',
              `Setup guide: ${SETUP_GUIDE_URL}`,
            ].join('\n'),
          },
        ],
        isError: true,
      },
    };
  }

  const env = getEnvClientId();
  if (env && env.value.trim().toLowerCase() !== clientId.trim().toLowerCase()) {
    return {
      error: {
        content: [
          {
            type: 'text',
            text: [
              `Error: the ${env.name} environment variable is set to a different client ID, and it takes precedence over a saved one, so the \`clientId\` you supplied would be ignored.`,
              '',
              `To use the new ID, change or remove ${env.name} in the MCP server configuration, restart the server, then call \`auth action=authenticate\` again. Nothing was saved.`,
            ].join('\n'),
          },
        ],
        isError: true,
      },
    };
  }

  try {
    return { saved: saveClientId(clientId) };
  } catch (error) {
    return {
      error: {
        content: [
          {
            type: 'text',
            text: `Error: could not save the client ID to ${SAVED_CONFIG_DISPLAY_PATH}: ${error.message}`,
          },
        ],
        isError: true,
      },
    };
  }
}

/**
 * Client ID row for `auth about`. The ID itself is never shown.
 * @returns {string}
 */
function describeClientIdStatus() {
  const source = getClientIdSource();
  if (source === 'env') {
    return `Configured (environment: ${getEnvClientId().name})`;
  }
  if (source === 'saved') {
    return `Configured (saved in ${SAVED_CONFIG_DISPLAY_PATH})`;
  }
  return 'Not set (run `auth action=authenticate clientId=<Application (client) ID>`)';
}

// Dynamic tool count — set by index.js after TOOLS array is built
let _toolCount = 0;
function setToolCount(count) {
  _toolCount = count;
}

/**
 * Scopes recorded as granted in a stored token object. Prefers the
 * `granted_scopes` array; falls back to the token response's `scope` string
 * (token files written before granted_scopes existed). Full-URI forms such as
 * `https://graph.microsoft.com/Mail.Read` are reduced to the bare scope name.
 * @param {object|null} tokens
 * @returns {string[]|null} - null when no token is stored
 */
function grantedScopesOf(tokens) {
  if (!tokens) return null;
  let raw = [];
  if (Array.isArray(tokens.granted_scopes) && tokens.granted_scopes.length) {
    raw = tokens.granted_scopes;
  } else if (typeof tokens.scope === 'string') {
    raw = tokens.scope.split(' ');
  }
  return raw.map((scope) => String(scope).split('/').pop()).filter(Boolean);
}

/**
 * Human-readable shared-mailbox status for `auth about`.
 * @param {string[]|null} granted - Granted scopes, or null when signed out
 * @returns {string}
 */
function describeSharedMailboxStatus(granted) {
  if (config.SHARED_MAILBOX_MODE === 'off' || !config.SHARED_SCOPES.length) {
    return 'Disabled (opt-in, work/school only: set `OUTLOOK_SHARED_MAILBOX=read` or `=true`, restart, then `auth action=authenticate force=true`)';
  }
  const lowerGranted = (granted || []).map((s) => s.toLowerCase());
  const parts = config.SHARED_SCOPES.map(
    (scope) =>
      `${scope} ${lowerGranted.includes(scope.toLowerCase()) ? 'granted' : 'not granted'}`
  );
  let status = `Enabled (${config.SHARED_MAILBOX_MODE}): ${parts.join(', ')}`;
  if (!granted) {
    status += ' (not signed in)';
  } else if (parts.some((p) => p.endsWith('not granted'))) {
    status +=
      ' (re-authenticate with `auth action=authenticate force=true`; personal accounts cannot be granted these)';
  }
  return status;
}

/**
 * About tool handler
 * @returns {object} - MCP response
 */
async function handleAbout() {
  const scopes = config.AUTH_CONFIG.scopes.filter(
    (s) => s !== 'offline_access'
  );
  const testMode = config.USE_TEST_MODE ? 'Enabled' : 'Disabled';
  const rateLimitConfigured = Boolean(
    process.env.OUTLOOK_MAX_EMAILS_PER_SESSION
  );
  const allowlistConfigured = Boolean(process.env.OUTLOOK_ALLOWED_RECIPIENTS);
  const rateLimit =
    process.env.OUTLOOK_MAX_EMAILS_PER_SESSION || 'Unlimited (no limit set)';
  const allowlist =
    process.env.OUTLOOK_ALLOWED_RECIPIENTS || 'None (all recipients allowed)';

  // F-2: surface the authenticated user's email so callers and AI
  // agents can confirm which mailbox is connected. Uses a single
  // GET /me round-trip when a valid token is available; degrades
  // gracefully when not authenticated.
  let identity = 'Not authenticated (run `auth action=authenticate`)';
  // Granted scopes come from the stored token file (scope names only — the
  // tokens themselves are never surfaced).
  let granted = null;
  try {
    const { tokenStorage } = require('./index');
    if (tokenStorage && typeof tokenStorage.getTokens === 'function') {
      granted = grantedScopesOf(await tokenStorage.getTokens());
    }
  } catch (_e) {
    // Leave granted as unknown
  }
  try {
    const { ensureAuthenticated } = require('./index');
    const { callGraphAPI } = require('../utils/graph-api');
    const token = await ensureAuthenticated();
    const me = await callGraphAPI(token, 'GET', 'me', null, {
      $select: 'userPrincipalName,mail,displayName',
    });
    const upn = me.mail || me.userPrincipalName;
    identity = me.displayName ? `${me.displayName} <${upn}>` : upn;
  } catch (_e) {
    // Leave default identity message in place
  }

  const lines = [
    `# Outlook Assistant Server v${config.SERVER_VERSION}\n`,
    `Provides access to Microsoft Outlook email, calendar, and contacts through Microsoft Graph API.\n`,
    `## Diagnostics\n`,
    `| Setting | Value |`,
    `|---------|-------|`,
    `| Mailbox | ${identity} |`,
    `| Client ID | ${describeClientIdStatus()} |`,
    `| Tools | ${_toolCount} across 9 modules |`,
    `| Modules | auth, email, calendar, folder, rules, contacts, categories, settings, advanced |`,
    `| Timezone | ${config.DEFAULT_TIMEZONE} |`,
    `| Test Mode | ${testMode} |`,
    `| Rate Limit | ${rateLimit} |`,
    `| Recipient Allowlist | ${allowlist} |`,
    `| Scopes | ${scopes.length} configured |`,
    `| Shared mailboxes | ${describeSharedMailboxStatus(granted)} |`,
    ``,
    `**Configured scopes**: ${scopes.join(', ')}`,
    `**Granted scopes**: ${granted ? granted.filter((s) => s !== 'offline_access').join(', ') || 'none recorded' : 'not signed in'}`,
  ];

  // F-1 / F-48: warn when no safety belts are wired up. AI-assisted
  // sending is significantly safer with a session rate limit and a
  // recipient allowlist; both are off by default.
  if (!rateLimitConfigured || !allowlistConfigured) {
    lines.push('');
    lines.push('## ⚠ Safety Belts Not Configured\n');
    lines.push(
      'No rate limit or recipient allowlist is set. For safer AI-assisted sending, add to your `.mcp.json` env block:'
    );
    lines.push('```');
    if (!rateLimitConfigured) {
      lines.push('OUTLOOK_MAX_EMAILS_PER_SESSION=10');
    }
    if (!allowlistConfigured) {
      lines.push(
        'OUTLOOK_ALLOWED_RECIPIENTS=your-domain.com,trusted@example.com'
      );
    }
    lines.push('```');
  }

  return {
    content: [
      {
        type: 'text',
        text: lines.join('\n'),
      },
    ],
  };
}

/**
 * Authentication tool handler — supports browser redirect and device code flow.
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleAuthenticate(args) {
  // For test mode, create a test token
  if (config.USE_TEST_MODE) {
    tokenManager.createTestTokens();
    return {
      content: [
        {
          type: 'text',
          text: 'Successfully authenticated with Microsoft Graph API (test mode)',
        },
      ],
    };
  }

  // Optional runtime client ID (for clients that can't set env vars, e.g.
  // plugin marketplaces): validate, refuse if an env var would override it,
  // save, then carry on with the normal flow.
  // null / blank counts as not supplied: some clients send empty optionals.
  let savedPrefix;
  const suppliedClientId = args?.clientId;
  if (
    suppliedClientId !== undefined &&
    suppliedClientId !== null &&
    String(suppliedClientId).trim() !== ''
  ) {
    const result = applyClientIdArg(suppliedClientId);
    if (result.error) {
      return result.error;
    }
    savedPrefix = `Saved your Azure Application (client) ID to \`${SAVED_CONFIG_DISPLAY_PATH}\`.`;
  }

  const method = args?.method || config.AUTH_CONFIG.defaultAuthMethod;

  if (method === 'device-code') {
    return handleDeviceCodeAuth(savedPrefix);
  }

  // Browser redirect flow (existing behaviour)
  const clientId = config.AUTH_CONFIG.clientId;
  if (!clientId) {
    return buildMissingClientIdResponse();
  }
  const authUrl = `${config.AUTH_CONFIG.authServerUrl}/auth?client_id=${encodeURIComponent(clientId)}`;
  const lines = [];
  if (savedPrefix) {
    lines.push(savedPrefix, '');
  }
  lines.push(
    `Authentication required. Please visit the following URL to authenticate with Microsoft: ${authUrl}\n\nAfter authentication, you will be redirected back to this application.\n\nNote: The auth server must be running on port 3333. If working remotely, consider using method=device-code instead.`
  );
  if (getClientIdSource() !== 'env') {
    lines.push(
      '',
      'The browser flow also needs the client secret: the auth server (`npm run auth-server`) reads OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET from its own environment and does not use a saved client ID. Device-code sign-in (the default) needs only the client ID.'
    );
  }
  return {
    content: [
      {
        type: 'text',
        text: lines.join('\n'),
      },
    ],
  };
}

// In-memory state for pending device code flow (also persisted to disk)
let pendingDeviceCode = null;

/**
 * Save device code state to disk so it survives MCP server restarts.
 * Uses mode 0o600 (owner-only) — same as token file.
 * @param {object|null} state - Device code state or null to delete
 */
function saveDeviceCodeState(state) {
  try {
    if (state) {
      fs.writeFileSync(DEVICE_CODE_STATE_PATH, JSON.stringify(state), {
        mode: 0o600,
      });
    } else if (fs.existsSync(DEVICE_CODE_STATE_PATH)) {
      fs.unlinkSync(DEVICE_CODE_STATE_PATH);
    }
  } catch (error) {
    console.error(
      `[AUTH] Failed to ${state ? 'save' : 'clean up'} device code state: ${error.message}`
    );
  }
}

/**
 * Load device code state from disk (fallback when in-memory state is lost).
 * Returns null if no state exists or if the state has expired.
 * @returns {object|null}
 */
function loadDeviceCodeState() {
  try {
    if (!fs.existsSync(DEVICE_CODE_STATE_PATH)) {
      return null;
    }
    const state = JSON.parse(fs.readFileSync(DEVICE_CODE_STATE_PATH, 'utf8'));
    if (Date.now() > state.expiresAt) {
      console.error('[AUTH] Persisted device code has expired, cleaning up');
      saveDeviceCodeState(null);
      return null;
    }
    return state;
  } catch (error) {
    console.error(`[AUTH] Failed to load device code state: ${error.message}`);
    return null;
  }
}

/**
 * Device code flow step 1 — request a code for the user to enter.
 * Returns the code + URL immediately. Call device-code-complete to finish.
 * State is persisted to disk so it survives MCP server restarts.
 * @param {string} [prefix] - Optional leading line (e.g. "client ID saved")
 * @returns {object} - MCP response
 */
async function handleDeviceCodeAuth(prefix) {
  const clientId = config.AUTH_CONFIG.clientId;
  if (!clientId) {
    return buildMissingClientIdResponse();
  }

  console.error('[AUTH] Starting device code flow...');
  // Attempt the configured scope set (base, plus `.Shared` when
  // OUTLOOK_SHARED_MAILBOX opts in). If the account can't consent to
  // `.Shared`, handleDeviceCodeComplete re-issues with base scopes.
  return initiateDeviceCode(config.AUTH_CONFIG.scopes, 'full', prefix);
}

/**
 * Shared helper: request a device code for a given scope set, persist the
 * pending state (tagging which scope set was used so the completion step can
 * decide whether a fallback is still available), and build the MCP response.
 * @param {string[]} scopes - OAuth scopes to request
 * @param {'full'|'base'} scopesUsed - Label recording which scope set was used
 * @param {string} [prefix] - Optional leading line (used for the fallback case)
 * @returns {Promise<object>} - MCP response
 */
async function initiateDeviceCode(scopes, scopesUsed, prefix) {
  const clientId = config.AUTH_CONFIG.clientId;

  // #213 — initiation can throw (blocked network egress in a sandboxed
  // connector, AADSTS9002331 audience mismatch, invalid_client, non-JSON
  // proxy page). Without this guard the exception propagates to the
  // top-level dispatcher, which returns a content-less error and the client
  // renders EMPTY OUTPUT. Mirror the try/catch that step 2
  // (handleDeviceCodeComplete) already has, and surface actionable hints.
  let response;
  try {
    response = await initiateDeviceCodeFlow(clientId, scopes);
  } catch (error) {
    // The `.Shared` scopes can also be rejected when the code is requested
    // (before sign-in). Same single fallback as at completion.
    if (
      config.SHARED_SCOPES.length > 0 &&
      scopesUsed === 'full' &&
      !isConsentRequiredError(error) &&
      isScopeConsentError(error)
    ) {
      console.error(
        '[AUTH] Shared-mailbox scopes rejected at device-code request; retrying with base scopes.'
      );
      return initiateDeviceCode(
        config.AUTH_CONFIG.fallbackScopes,
        'base',
        "Your account doesn't support shared-mailbox access; signing in with the standard scopes instead."
      );
    }
    return buildDeviceCodeErrorResponse(error);
  }

  // Store in memory and persist to disk. The client ID is recorded because
  // the device code is bound to it: completion must poll with the same one.
  pendingDeviceCode = {
    deviceCode: response.deviceCode,
    interval: response.interval,
    expiresIn: response.expiresIn,
    expiresAt: Date.now() + response.expiresIn * 1000,
    scopesUsed,
    clientId,
  };
  saveDeviceCodeState(pendingDeviceCode);

  console.error(
    `[AUTH] Device code (${scopesUsed} scopes): ${response.userCode}, expires in ${response.expiresIn}s`
  );

  const lines = [];
  if (prefix) {
    lines.push(prefix, '');
  }
  lines.push(
    `## Device Code Authentication\n`,
    `Visit: **${response.verificationUri}**`,
    `Enter code: **${response.userCode}**\n`,
    `The code expires in ${Math.floor(response.expiresIn / 60)} minutes.\n`,
    `After entering the code and signing in, call this tool again with \`action=device-code-complete\` to finish authentication.`
  );

  return {
    content: [
      {
        type: 'text',
        text: lines.join('\n'),
      },
    ],
  };
}

/**
 * Build a visible, actionable MCP error result for a failed device-code
 * initiation. Adds remediation hints for the common remote-connector
 * failure modes. (#213)
 * @param {Error} error
 * @returns {object} - MCP response ({ content, isError: true })
 */
function buildDeviceCodeErrorResponse(error) {
  const msg = (error && error.message) || String(error);
  const code = error && error.code;
  // Shared AADSTS hint table (#69) so this path and the token-endpoint paths in
  // token-storage.js cannot drift apart.
  const hints = getAuthErrorHints(msg);

  if (
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    /timed out|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|network|Failed to parse response/i.test(
      msg
    )
  ) {
    hints.push(
      'Could not reach `login.microsoftonline.com`. Outbound network access may be blocked in this environment (e.g. a sandboxed connector or corporate proxy). Check egress/firewall/proxy settings.'
    );
  }

  const lines = ['## Device Code Authentication Failed', '', `Error: ${msg}`];
  if (hints.length) {
    lines.push('', 'Suggested fixes:', ...hints.map((h) => `- ${h}`));
  }

  console.error(`[AUTH] Device code initiation failed: ${msg}`);

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    isError: true,
  };
}

/**
 * Device code flow step 2 — poll until the user completes authentication.
 * Checks in-memory state first, falls back to disk-persisted state.
 * @returns {object} - MCP response
 */
async function handleDeviceCodeComplete() {
  // Try in-memory first, fall back to disk (survives server restarts)
  if (!pendingDeviceCode) {
    pendingDeviceCode = loadDeviceCodeState();
  }

  if (!pendingDeviceCode) {
    return toolError('No pending device code flow.', {
      nextStep: 'Start one with the `auth` tool with action=authenticate.',
    });
  }

  if (Date.now() > pendingDeviceCode.expiresAt) {
    pendingDeviceCode = null;
    saveDeviceCodeState(null);
    return toolError(
      'Device code has expired. Please start a new authentication with action=authenticate.'
    );
  }

  // Poll with the client ID the code was issued to (older state files don't
  // record it, so fall back to the current one).
  const clientId = pendingDeviceCode.clientId || config.AUTH_CONFIG.clientId;
  if (!clientId) {
    pendingDeviceCode = null;
    saveDeviceCodeState(null);
    return buildMissingClientIdResponse();
  }
  // Capture which scope set this pending flow attempted, before any mutation.
  const scopesUsed = pendingDeviceCode.scopesUsed || 'full';
  // The scopes we attempted — used as the granted_scopes fallback when the
  // token response omits `scope`.
  const attemptedScopes =
    scopesUsed === 'base'
      ? config.AUTH_CONFIG.fallbackScopes
      : config.AUTH_CONFIG.scopes;

  try {
    console.error('[AUTH] Polling for device code completion...');
    const tokenResponse = await pollForToken(
      clientId,
      pendingDeviceCode.deviceCode,
      pendingDeviceCode.interval,
      Math.ceil((pendingDeviceCode.expiresAt - Date.now()) / 1000)
    );

    pendingDeviceCode = null;
    saveDeviceCodeState(null);

    // Save tokens using TokenStorage — mark as device-code auth
    const TokenStorage = require('./token-storage');
    const tokenStorage = new TokenStorage({
      clientId,
      clientSecret: config.AUTH_CONFIG.clientSecret,
      tokenStorePath: config.AUTH_CONFIG.tokenStorePath,
      scopes: config.AUTH_CONFIG.scopes,
      tokenEndpoint: config.AUTH_CONFIG.tokenEndpoint,
    });

    // Persist the GRANTED scopes so token refresh re-requests exactly what was
    // granted (not the full configured set) — otherwise a base-only fallback
    // would re-request `.Shared` on refresh ~1h later and log the user out.
    const grantedScopes = tokenResponse.scope
      ? tokenResponse.scope.split(' ').filter(Boolean)
      : attemptedScopes;

    tokenStorage.tokens = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_in: tokenResponse.expires_in,
      expires_at: Date.now() + tokenResponse.expires_in * 1000,
      scope: tokenResponse.scope,
      granted_scopes: grantedScopes,
      token_type: tokenResponse.token_type,
      auth_method: 'device-code',
    };
    await tokenStorage._saveTokensToFile();

    console.error('[AUTH] Device code flow completed successfully.');

    return {
      content: [
        {
          type: 'text',
          text: 'Authentication successful! Tokens saved. You can now use Outlook tools.',
        },
      ],
    };
  } catch (error) {
    // Scope-consent rejection while attempting the FULL set → re-issue with
    // base scopes. This is the personal-account path: one extra device code.
    // Only meaningful when shared-mailbox support is on: with the flag off the
    // attempted set already IS the base set, so there is nothing to drop.
    // Consent-required (AADSTS65001) is checked first: it is remediable and
    // must surface below, never trigger a silent downgrade.
    if (
      config.SHARED_SCOPES.length > 0 &&
      scopesUsed === 'full' &&
      !isConsentRequiredError(error) &&
      isScopeConsentError(error)
    ) {
      console.error(
        '[AUTH] Shared-mailbox scopes rejected; falling back to base scopes.'
      );
      // Do NOT clear pendingDeviceCode — initiateDeviceCode replaces it.
      try {
        const fallbackResponse = await initiateDeviceCode(
          config.AUTH_CONFIG.fallbackScopes,
          'base',
          "Your account doesn't support shared-mailbox access; enter this new code to finish signing in."
        );
        // initiateDeviceCode reports its own failures as { isError: true }
        // instead of throwing. Clear the rejected full-scope pending state so
        // a later completion attempt doesn't retry it.
        if (fallbackResponse && fallbackResponse.isError) {
          pendingDeviceCode = null;
          saveDeviceCodeState(null);
        }
        return fallbackResponse;
      } catch (reissueError) {
        pendingDeviceCode = null;
        saveDeviceCodeState(null);
        return toolError(`Authentication failed: ${reissueError.message}`);
      }
    }

    pendingDeviceCode = null;
    saveDeviceCodeState(null);

    // Consent required (AADSTS65001) — remediable, so surface it instead of
    // silently downgrading to base scopes (which would strip shared-mailbox
    // access for every future refresh).
    // Only when the shared scopes were requested — otherwise the generic
    // path below (with its AADSTS hint table) is unchanged.
    if (config.SHARED_SCOPES.length > 0 && isConsentRequiredError(error)) {
      return toolError(
        [
          'Authentication failed: consent was not granted (AADSTS65001).',
          '',
          `An administrator may need to grant consent for the shared-mailbox scopes (${config.SHARED_SCOPES.join(', ')}), or re-run \`auth action=authenticate\` and approve every requested permission.`,
          'If your organisation will not consent to them, unset OUTLOOK_SHARED_MAILBOX and restart the server to sign in with the standard scopes.',
          'No scopes were changed — your configured capability is unchanged.',
        ].join('\n')
      );
    }

    return toolError(`Authentication failed: ${error.message}`);
  }
}

/**
 * Check authentication status — attempts token refresh if expired.
 * @returns {object} - MCP response
 */
async function handleCheckAuthStatus() {
  console.error('[CHECK-AUTH-STATUS] Starting authentication status check');

  // Use TokenStorage for accurate status (includes refresh attempt)
  const TokenStorage = require('./token-storage');
  const tokenStorage = new TokenStorage({
    clientId: config.AUTH_CONFIG.clientId,
    clientSecret: config.AUTH_CONFIG.clientSecret,
    tokenStorePath: config.AUTH_CONFIG.tokenStorePath,
    scopes: config.AUTH_CONFIG.scopes,
    tokenEndpoint: config.AUTH_CONFIG.tokenEndpoint,
  });

  const accessToken = await tokenStorage.getValidAccessToken();

  if (!accessToken) {
    console.error('[CHECK-AUTH-STATUS] No valid access token');
    const text =
      getClientIdSource() === 'none'
        ? `Not authenticated. No Azure Application (client) ID is configured yet: ask the user for the Application (client) ID of their Azure app registration, then call \`auth action=authenticate clientId=<id>\`. Setup guide: ${SETUP_GUIDE_URL}`
        : 'Not authenticated';
    return {
      content: [{ type: 'text', text }],
    };
  }

  const expiresAt = tokenStorage.getExpiryTime();
  const expiresIn = expiresAt
    ? Math.round((expiresAt - Date.now()) / 60000)
    : 'unknown';

  console.error(
    `[CHECK-AUTH-STATUS] Authenticated, token expires in ~${expiresIn} min`
  );

  return {
    content: [
      {
        type: 'text',
        text: `Authenticated and ready (token expires in ~${expiresIn} minutes)`,
      },
    ],
  };
}

// Tool definitions
const authTools = [
  {
    name: 'auth',
    description:
      'Manage authentication with the Microsoft Graph API. action=`status` (default) returns the current auth state and auto-refreshes the access token if it\'s expired but the refresh token is still valid (~90-day window) — call this first to check before other tools. action=`authenticate` starts the OAuth flow: with `method: "device-code"` (default, works headlessly) it returns a code + URL for the user to visit; with `method: "browser"` it opens the local auth server on :3333 (run `npm run auth-server` first). Pass `force: true` to re-authenticate over an existing valid session. If sign-in reports that OUTLOOK_CLIENT_ID is not configured, ask the user for their Azure Application (client) ID and pass it as `clientId`. action=`device-code-complete` finishes device-code auth after the user enters the code in their browser — call this once authentication shows as successful in the browser. action=`about` returns server version, configured audience, scope list, and other diagnostic info. Tokens persist to `~/.outlook-assistant-tokens.json` and survive server restarts.',
    ...toolMetadata('auth', 'Authentication'),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'authenticate', 'device-code-complete', 'about'],
          description: 'Action to perform (default: status)',
        },
        method: {
          type: 'string',
          enum: ['device-code', 'browser'],
          description:
            'Auth method for action=authenticate. device-code (default): no auth server needed, works remotely. browser: traditional OAuth redirect via port 3333.',
        },
        force: {
          type: 'boolean',
          description:
            'Force re-authentication even if already authenticated (action=authenticate only)',
        },
        clientId: {
          type: 'string',
          description:
            "Optional, action=authenticate only. The user's Azure Application (client) ID (a GUID from the app registration's Overview page). Saved to `~/.outlook-assistant-config.json` and used from then on; it is not a secret. The OUTLOOK_CLIENT_ID environment variable takes precedence when set.",
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: async (args) => {
      const action = args.action || 'status';
      switch (action) {
        case 'authenticate':
          return handleAuthenticate(args);
        case 'device-code-complete':
          return handleDeviceCodeComplete();
        case 'about':
          return handleAbout();
        case 'status':
          return handleCheckAuthStatus();
        default:
          return toolError(
            `Unknown action '${action}'. Valid actions: status, authenticate, device-code-complete, about.`
          );
      }
    },
  },
];

module.exports = {
  authTools,
  setToolCount,
  handleAbout,
  handleAuthenticate,
  handleDeviceCodeAuth,
  handleDeviceCodeComplete,
  handleCheckAuthStatus,
};
