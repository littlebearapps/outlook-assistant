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
  OUTLOOK_CLIENT_ID                 Azure app registration client ID
  OUTLOOK_CLIENT_SECRET             Client secret VALUE (not the Secret ID)
  OUTLOOK_AUTH_METHOD               device-code (default) | browser
  OUTLOOK_AUTH_AUDIENCE             common | consumers | organizations | <tenant-guid>
  OUTLOOK_MAX_EMAILS_PER_SESSION    Cap on sends per session
  OUTLOOK_ALLOWED_RECIPIENTS        Comma-separated recipient allowlist
  USE_TEST_MODE                     Set to "true" to run against mock data

Documentation: https://github.com/littlebearapps/outlook-assistant`;

  if (cliArgs.includes('--version') || cliArgs.includes('-v')) {
    console.log(require('./config').SERVER_VERSION);
    process.exit(0);
  }

  if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // Unrecognised arguments are a user error, not a reason to boot a server that
  // will then silently ignore them.
  console.error(
    `outlook-assistant: unrecognised argument '${cliArgs[0]}'\nRun 'outlook-assistant --help' for usage.`
  );
  process.exit(1);
}

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  StdioServerTransport,
} = require('@modelcontextprotocol/sdk/server/stdio.js');
const config = require('./config');
const { createRequestHandler } = require('./request-handler');

// Import module tools
const { authTools, setToolCount } = require('./auth');
const { calendarTools } = require('./calendar');
const { emailTools } = require('./email');
const { folderTools } = require('./folder');
const { rulesTools } = require('./rules');
const { contactsTools } = require('./contacts');
const { categoriesTools } = require('./categories');
const { settingsTools } = require('./settings');
const { advancedTools } = require('./advanced');

// Log startup information
console.error(`STARTING ${config.SERVER_NAME.toUpperCase()} MCP SERVER`);
console.error(`Test mode is ${config.USE_TEST_MODE ? 'enabled' : 'disabled'}`);

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

// Combine all tools
const TOOLS = [
  ...authTools,
  ...calendarTools,
  ...emailTools,
  ...folderTools,
  ...rulesTools,
  ...contactsTools,
  ...categoriesTools,
  ...settingsTools,
  ...advancedTools,
];

// Set dynamic tool count for auth about handler
setToolCount(TOOLS.length);

// Create server with tools capabilities
const server = new Server(
  { name: config.SERVER_NAME, version: config.SERVER_VERSION },
  {
    capabilities: {
      tools: TOOLS.reduce((acc, tool) => {
        acc[tool.name] = {};
        return acc;
      }, {}),
    },
  }
);

// Handle all requests. Dispatch + error-shaping logic lives in
// request-handler.js so it is unit-testable without starting the transport.
server.fallbackRequestHandler = createRequestHandler(TOOLS);

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
