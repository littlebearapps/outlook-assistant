/**
 * Authentication-related tools for the Outlook Assistant server
 */
const config = require('../config');
const fs = require('fs');
const path = require('path');
const tokenManager = require('./token-manager');
const { initiateDeviceCodeFlow, pollForToken } = require('./device-code');
const {
  ClientCredentialsProvider,
  validateClientCredentialsConfig,
} = require('./client-credentials');

// Path for persisting device code state across MCP server restarts
const DEVICE_CODE_STATE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.outlook-assistant-pending-auth.json'
);

// Dynamic tool count — set by index.js after TOOLS array is built
let _toolCount = 0;
function setToolCount(count) {
  _toolCount = count;
}

/**
 * About tool handler
 * @returns {object} - MCP response
 */
async function handleAbout() {
  const authMethod = config.AUTH_CONFIG.defaultAuthMethod;
  const isAppOnly = authMethod === 'client-credentials';
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
  let identity = isAppOnly
    ? `App-only target: ${config.CLIENT_CREDENTIALS_CONFIG?.targetUser || 'not configured'}`
    : 'Not authenticated (run `auth action=authenticate`)';
  try {
    const { ensureAuthenticated } = require('./index');
    const { callGraphAPI } = require('../utils/graph-api');
    const token = await ensureAuthenticated();
    const me = await callGraphAPI(token, 'GET', 'me', null, {
      $select: 'userPrincipalName,mail,displayName',
    });
    const upn = me.mail || me.userPrincipalName;
    const mailbox = me.displayName ? `${me.displayName} <${upn}>` : upn;
    identity = isAppOnly ? `App-only target: ${mailbox}` : mailbox;
  } catch (_e) {
    // Leave default identity message in place
  }

  const lines = [
    `# Outlook Assistant Server v${config.SERVER_VERSION}\n`,
    `Provides access to Microsoft Outlook email, calendar, and contacts through Microsoft Graph API.\n`,
    `## Diagnostics\n`,
    `| Setting | Value |`,
    `|---------|-------|`,
    `| Auth Method | ${authMethod} |`,
    `| Mailbox | ${identity} |`,
    `| Tools | ${_toolCount} across 10 modules |`,
    `| Modules | auth, email, calendar, folder, rules, contacts, categories, settings, advanced, tasks |`,
    `| Timezone | ${config.DEFAULT_TIMEZONE} |`,
    `| Test Mode | ${testMode} |`,
    `| Rate Limit | ${rateLimit} |`,
    `| Recipient Allowlist | ${allowlist} |`,
    `| Scopes | ${isAppOnly ? 'Application .default' : `${scopes.length} configured`} |`,
    ``,
    `**Scopes**: ${isAppOnly ? config.CLIENT_CREDENTIALS_SCOPE : scopes.join(', ')}`,
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
  const method = args?.method || config.AUTH_CONFIG.defaultAuthMethod;

  // For test mode, create a test token
  if (config.USE_TEST_MODE) {
    if (method === 'client-credentials') {
      return {
        content: [
          {
            type: 'text',
            text: 'Successfully authenticated with Microsoft Graph API using client credentials (test mode)',
          },
        ],
      };
    }
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

  if (method === 'device-code') {
    return handleDeviceCodeAuth();
  }

  if (method === 'client-credentials') {
    try {
      validateClientCredentialsConfig({
        authConfig: config.AUTH_CONFIG,
        clientCredentialsConfig: config.CLIENT_CREDENTIALS_CONFIG,
      });
      const provider = new ClientCredentialsProvider({
        tenantId: config.CLIENT_CREDENTIALS_CONFIG.tenantId,
        clientId: config.AUTH_CONFIG.clientId,
        certPath: config.CLIENT_CREDENTIALS_CONFIG.certPath,
        keyPath: config.CLIENT_CREDENTIALS_CONFIG.keyPath,
        targetUser: config.CLIENT_CREDENTIALS_CONFIG.targetUser,
      });
      await provider.getValidAccessToken();
      return {
        content: [
          {
            type: 'text',
            text: `Authentication successful with client credentials (app-only). Target mailbox: ${config.CLIENT_CREDENTIALS_CONFIG.targetUser}.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Client credentials authentication failed: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Browser redirect flow (existing behaviour)
  const authUrl = `${config.AUTH_CONFIG.authServerUrl}/auth?client_id=${config.AUTH_CONFIG.clientId}`;
  return {
    content: [
      {
        type: 'text',
        text: `Authentication required. Please visit the following URL to authenticate with Microsoft: ${authUrl}\n\nAfter authentication, you will be redirected back to this application.\n\nNote: The auth server must be running on port 3333. If working remotely, consider using method=device-code instead.`,
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
 * @returns {object} - MCP response
 */
async function handleDeviceCodeAuth() {
  const clientId = config.AUTH_CONFIG.clientId;
  if (!clientId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: OUTLOOK_CLIENT_ID is not configured.',
        },
      ],
    };
  }

  console.error('[AUTH] Starting device code flow...');
  const response = await initiateDeviceCodeFlow(
    clientId,
    config.AUTH_CONFIG.scopes
  );

  // Store in memory and persist to disk
  pendingDeviceCode = {
    deviceCode: response.deviceCode,
    interval: response.interval,
    expiresIn: response.expiresIn,
    expiresAt: Date.now() + response.expiresIn * 1000,
  };
  saveDeviceCodeState(pendingDeviceCode);

  console.error(
    `[AUTH] Device code: ${response.userCode}, expires in ${response.expiresIn}s`
  );

  return {
    content: [
      {
        type: 'text',
        text: [
          `## Device Code Authentication\n`,
          `Visit: **${response.verificationUri}**`,
          `Enter code: **${response.userCode}**\n`,
          `The code expires in ${Math.floor(response.expiresIn / 60)} minutes.\n`,
          `After entering the code and signing in, call this tool again with \`action=device-code-complete\` to finish authentication.`,
        ].join('\n'),
      },
    ],
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
    return {
      content: [
        {
          type: 'text',
          text: 'No pending device code flow. Call authenticate with method=device-code first.',
        },
      ],
    };
  }

  if (Date.now() > pendingDeviceCode.expiresAt) {
    pendingDeviceCode = null;
    saveDeviceCodeState(null);
    return {
      content: [
        {
          type: 'text',
          text: 'Device code has expired. Please start a new authentication with action=authenticate.',
        },
      ],
    };
  }

  const clientId = config.AUTH_CONFIG.clientId;

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
      clientId: config.AUTH_CONFIG.clientId,
      clientSecret: config.AUTH_CONFIG.clientSecret,
      tokenStorePath: config.AUTH_CONFIG.tokenStorePath,
      scopes: config.AUTH_CONFIG.scopes,
      tokenEndpoint: config.AUTH_CONFIG.tokenEndpoint,
    });

    tokenStorage.tokens = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_in: tokenResponse.expires_in,
      expires_at: Date.now() + tokenResponse.expires_in * 1000,
      scope: tokenResponse.scope,
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
    pendingDeviceCode = null;
    saveDeviceCodeState(null);
    return {
      content: [
        {
          type: 'text',
          text: `Authentication failed: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Check authentication status — attempts token refresh if expired.
 * @returns {object} - MCP response
 */
async function handleCheckAuthStatus() {
  console.error('[CHECK-AUTH-STATUS] Starting authentication status check');

  if (config.AUTH_CONFIG.defaultAuthMethod === 'client-credentials') {
    try {
      const {
        clientCredentialsProvider,
        validateActiveAuthConfig,
      } = require('./index');
      validateActiveAuthConfig();
      const accessToken = await clientCredentialsProvider.getValidAccessToken();
      if (!accessToken) {
        return {
          content: [{ type: 'text', text: 'Not authenticated' }],
        };
      }
      const expiresAt = clientCredentialsProvider.getExpiryTime();
      const expiresIn = expiresAt
        ? Math.round((expiresAt - Date.now()) / 60000)
        : 'unknown';
      return {
        content: [
          {
            type: 'text',
            text: `Authenticated with client credentials (app-only) for ${config.CLIENT_CREDENTIALS_CONFIG.targetUser} (token expires in ~${expiresIn} minutes)`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Not authenticated with client credentials: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

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
    return {
      content: [{ type: 'text', text: 'Not authenticated' }],
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
      'Manage authentication with the Microsoft Graph API. action=`status` (default) returns the current auth state and auto-refreshes the access token if possible — call this first to check before other tools. action=`authenticate` starts auth: `method: "device-code"` (default, delegated/headless) returns a code + URL; `method: "browser"` uses the local auth server on :3333; `method: "client-credentials"` validates certificate-based app-only auth configured via OUTLOOK_TENANT_ID, OUTLOOK_CERT_PATH, OUTLOOK_KEY_PATH, and OUTLOOK_TARGET_USER. action=`device-code-complete` finishes device-code auth after browser sign-in. action=`about` returns server version, auth method, configured audience, scopes, and diagnostics. Delegated tokens persist to `~/.outlook-assistant-tokens.json`; app-only tokens are cached in memory only.',
    annotations: {
      title: 'Authentication',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
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
          enum: ['device-code', 'browser', 'client-credentials'],
          description:
            'Auth method for action=authenticate. device-code (default): no auth server needed, works remotely. browser: traditional OAuth redirect via port 3333. client-credentials: certificate-based app-only auth for work/school tenants.',
        },
        force: {
          type: 'boolean',
          description:
            'Force re-authentication even if already authenticated (action=authenticate only)',
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
          return {
            content: [
              {
                type: 'text',
                text: `Unknown action '${action}'. Valid actions: status, authenticate, device-code-complete, about.`,
              },
            ],
          };
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
