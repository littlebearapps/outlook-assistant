#!/usr/bin/env node
/**
 * Outlook Assistant Server - Main entry point
 *
 * A Model Context Protocol server that provides access to
 * Microsoft Outlook through the Microsoft Graph API.
 */
// CLI flag handling (#68).
//
// Deliberately the first thing that runs: it must complete before the SDK
// imports, before the auth modules load, and before the startup banner below
// writes to stderr — otherwise `--version` output is buried in server noise and
// the process never exits (the SIGTERM handler below keeps it alive).
//
// `config.js` is required lazily here so this costs nothing on the normal
// server path; it is the single source of truth for the version, which it
// reads from package.json.
const cliArgs = process.argv.slice(2);
if (cliArgs.length > 0) {
  const HELP_TEXT = `outlook-assistant — MCP server for Microsoft Outlook via the Microsoft Graph API.

Usage:
  outlook-assistant [options]

Options:
  -v, --version   Print the version and exit
  -h, --help      Show this help and exit

With no options the server starts and speaks the Model Context Protocol over
stdio. It is normally launched by an MCP client (Claude Desktop, Claude Code)
rather than run by hand — started from a terminal it will simply wait on stdin.

Key environment variables:
  OUTLOOK_CLIENT_ID                 Azure Application (client) ID. If you can't set env
                                    vars, pass it to the auth tool instead (action=authenticate
                                    clientId=<id>); it's saved to ~/.outlook-assistant-config.json
  OUTLOOK_CLIENT_SECRET             Client secret VALUE (not the Secret ID); browser flow only
  OUTLOOK_AUTH_METHOD               device-code (default) | browser
  OUTLOOK_AUTH_AUDIENCE             common | consumers | organizations | <tenant-guid>
  OUTLOOK_SHARED_MAILBOX            Opt in to shared mailboxes: read | true (work/school only)
  OUTLOOK_READ_ONLY                 Set to "true" to refuse every tool call that would change,
                                    send or delete anything (reads and sign-in still work)
  OUTLOOK_ALLOWED_RECIPIENTS        Comma-separated recipient allowlist
  OUTLOOK_MAX_EMAILS_PER_SESSION    Default cap per session for every rate-limited tool
                                    (send-email, draft, manage-rules); 0 or unset = no cap
  OUTLOOK_MAX_<TOOL>_PER_SESSION    Per-tool cap overriding the default, tool name in upper
                                    case with _ for -, e.g. OUTLOOK_MAX_SEND_EMAIL_PER_SESSION
  OUTLOOK_DEFAULT_TIMEZONE          IANA timezone for event times (default Australia/Melbourne)
  OUTLOOK_IMMUTABLE_IDS             Set to "true" for message IDs that survive folder moves
  OUTLOOK_SEARCH_SCAN_LIMIT         Local search fallback window (default 500, max 5000)
  OUTLOOK_REQUEST_TIMEOUT_MS        Graph request inactivity timeout (default 60000)
  OUTLOOK_DEBUG                     Set to "true" for detailed stderr logs (addresses redacted)
  OUTLOOK_EXPORT_DIR                Extra folder export/attachment downloads may write to
                                    (besides the temp directory, ~/Downloads, ~/Documents)
  USE_TEST_MODE                     Set to "true" to run against mock data

Documentation: https://github.com/littlebearapps/outlook-assistant`;

  const KNOWN_FLAGS = new Set(['--version', '-v', '--help', '-h']);

  // Validate every argument before acting on any of them. Checking for a
  // recognised flag first would let `--version --nope` succeed and silently
  // swallow the typo — an unrecognised argument is a user error regardless of
  // what else is on the command line.
  const unknown = cliArgs.find((arg) => !KNOWN_FLAGS.has(arg));
  if (unknown) {
    console.error(
      `outlook-assistant: unrecognised argument '${unknown}'\nRun 'outlook-assistant --help' for usage.`
    );
    process.exit(1);
  }

  if (cliArgs.includes('--version') || cliArgs.includes('-v')) {
    console.log(require('./config').SERVER_VERSION);
    process.exit(0);
  }

  console.log(HELP_TEXT);
  process.exit(0);
}

const {
  StdioServerTransport,
} = require('@modelcontextprotocol/sdk/server/stdio.js');
const config = require('./config');
const { createServer } = require('./server');

const { setToolCount } = require('./auth');
const { TOOLS } = require('./tools');
const { isDebugEnabled } = require('./utils/logger');

// Log startup information
console.error(
  `STARTING ${config.SERVER_NAME.toUpperCase()} MCP SERVER v${config.SERVER_VERSION}`
);
console.error(`Test mode is ${config.USE_TEST_MODE ? 'enabled' : 'disabled'}`);
if (isDebugEnabled()) {
  console.error(
    'Debug logging is on (OUTLOOK_DEBUG): stderr includes search terms, subjects and Graph errors, with addresses and IDs redacted.'
  );
}

// F-1 / F-48: warn at startup when safety belts are unset. Mirrors the
// warning surfaced by `auth action=about`. Visible to operators reading
// stderr; AI clients reading the JSON-RPC stream are unaffected.
if (
  !process.env.OUTLOOK_MAX_EMAILS_PER_SESSION &&
  !process.env.OUTLOOK_ALLOWED_RECIPIENTS &&
  !config.USE_TEST_MODE
) {
  console.error(
    '⚠ Safety belts not configured. Consider setting OUTLOOK_MAX_EMAILS_PER_SESSION and OUTLOOK_ALLOWED_RECIPIENTS in your .mcp.json env block for safer AI-assisted sending. See `auth action=about` for details.'
  );
}

// Set dynamic tool count for auth about handler
setToolCount(TOOLS.length);

const server = createServer(TOOLS);

// Make the script executable
process.on('SIGTERM', () => {
  console.error('SIGTERM received but staying alive');
});

// Start the server
const transport = new StdioServerTransport();
server
  .connect(transport)
  .then(() => console.error(`${config.SERVER_NAME} connected and listening`))
  .catch((error) => {
    console.error(`Connection error: ${error.message}`);
    process.exit(1);
  });
