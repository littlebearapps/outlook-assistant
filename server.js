/**
 * MCP server factory: builds the SDK Server for the tool registry.
 *
 * Kept apart from index.js (CLI flags, startup warnings, stdio transport) so
 * protocol behaviour can be tested over an in-memory transport.
 */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const config = require('./config');
const { createRequestHandler } = require('./request-handler');
const { TOOLS } = require('./tools');

/**
 * @param {Array<object>} [tools] - tool definitions (default: the registry)
 * @returns {Server}
 */
function createServer(tools = TOOLS) {
  const server = new Server(
    { name: config.SERVER_NAME, version: config.SERVER_VERSION },
    {
      // Spec shape: the tool list never changes at runtime. Nothing else
      // (resources, prompts, logging) is declared, so those methods return
      // -32601 rather than empty stubs. (#276)
      capabilities: { tools: { listChanged: false } },
    }
  );

  // Handle all requests. Dispatch + error-shaping logic lives in
  // request-handler.js so it is unit-testable without starting the transport.
  server.fallbackRequestHandler = createRequestHandler(tools);
  return server;
}

module.exports = { createServer };
