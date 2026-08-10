#!/usr/bin/env node
/**
 * Outlook Assistant Server - Main entry point
 *
 * A Model Context Protocol server that provides access to
 * Microsoft Outlook through the Microsoft Graph API.
 */

// Handle `--version` / `-v` before requiring anything else so we don't load
// config, auth modules, or emit MCP startup logging just to print a version.
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const pkg = require('./package.json');
  process.stdout.write(`${pkg.name} v${pkg.version}\n`);
  process.exit(0);
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
