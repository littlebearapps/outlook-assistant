#!/usr/bin/env node
/**
 * Outlook Assistant Server - Main entry point
 *
 * A Model Context Protocol server that provides access to
 * Microsoft Outlook through the Microsoft Graph API.
 */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  StdioServerTransport,
} = require('@modelcontextprotocol/sdk/server/stdio.js');
const config = require('./config');
const { coerceArgsAgainstSchema } = require('./utils/schema-coerce');

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

// Handle all requests
server.fallbackRequestHandler = async (request) => {
  try {
    const { method, params, id } = request;
    console.error(`REQUEST: ${method} [${id}]`);

    // Initialize handler
    if (method === 'initialize') {
      console.error(`INITIALIZE REQUEST: ID [${id}]`);
      return {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: TOOLS.reduce((acc, tool) => {
            acc[tool.name] = {};
            return acc;
          }, {}),
        },
        serverInfo: {
          name: config.SERVER_NAME,
          version: config.SERVER_VERSION,
        },
      };
    }

    // Tools list handler
    if (method === 'tools/list') {
      console.error(`TOOLS LIST REQUEST: ID [${id}]`);
      console.error(`TOOLS COUNT: ${TOOLS.length}`);
      console.error(`TOOLS NAMES: ${TOOLS.map((t) => t.name).join(', ')}`);

      return {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations && { annotations: tool.annotations }),
        })),
      };
    }

    // Required empty responses for other capabilities
    if (method === 'resources/list') return { resources: [] };
    if (method === 'prompts/list') return { prompts: [] };

    // Tool call handler
    if (method === 'tools/call') {
      try {
        const { name, arguments: args = {} } = params || {};

        console.error(`TOOL CALL: ${name}`);

        // Find the tool handler
        const tool = TOOLS.find((t) => t.name === name);

        if (tool && tool.handler) {
          // Coerce + validate args against the tool's inputSchema before
          // dispatching. Catches array-as-string, boolean-as-string, unknown
          // params, and out-of-enum action values at the MCP boundary so
          // handlers receive properly-typed JS values. (#160, #162)
          if (tool.inputSchema) {
            const coerced = coerceArgsAgainstSchema(args, tool.inputSchema);
            if (coerced.error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Invalid arguments for tool '${name}':\n${coerced.error}`,
                  },
                ],
                isError: true,
              };
            }
            return await tool.handler(coerced.args);
          }
          return await tool.handler(args);
        }

        // Tool not found
        return {
          error: {
            code: -32601,
            message: `Tool not found: ${name}`,
          },
        };
      } catch (error) {
        console.error(`Error in tools/call:`, error);
        return {
          error: {
            code: -32603,
            message: `Error processing tool call: ${error.message}`,
          },
        };
      }
    }

    // For any other method, return method not found
    return {
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  } catch (error) {
    console.error(`Error in fallbackRequestHandler:`, error);
    return {
      error: {
        code: -32603,
        message: `Error processing request: ${error.message}`,
      },
    };
  }
};

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
