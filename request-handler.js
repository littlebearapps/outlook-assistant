/**
 * MCP request dispatcher for the Outlook Assistant server.
 *
 * Extracted from index.js so the dispatch + error-shaping logic is
 * unit-testable without starting the stdio transport.
 *
 * IMPORTANT (#213): a `tools/call` that fails MUST return a visible MCP
 * tool-error result (`{ content: [...], isError: true }`). Returning a
 * content-less `{ error: {...} }` object gets coerced by the SDK into
 * `{ content: [] }`, which the client renders as EMPTY OUTPUT — the exact
 * symptom reported for device-code auth in a remote connector session.
 */
const config = require('./config');
const { coerceArgsAgainstSchema } = require('./utils/schema-coerce');

/**
 * Build the MCP fallbackRequestHandler for a given tool set.
 * @param {Array<{name: string, description?: string, inputSchema?: object, annotations?: object, handler?: Function}>} TOOLS
 * @returns {(request: object) => Promise<object>}
 */
function createRequestHandler(TOOLS) {
  return async (request) => {
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

          // Tool not found — return visible isError content, not a
          // content-less { error } (which renders as empty output). (#213)
          return {
            content: [
              {
                type: 'text',
                text: `Tool not found: ${name}`,
              },
            ],
            isError: true,
          };
        } catch (error) {
          console.error(`Error in tools/call:`, error);
          // Surface the failure as visible tool-error content so it is not
          // silently rendered as empty output by the client. (#213)
          return {
            content: [
              {
                type: 'text',
                text: `Error processing tool call: ${error.message}`,
              },
            ],
            isError: true,
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
}

module.exports = { createRequestHandler };
