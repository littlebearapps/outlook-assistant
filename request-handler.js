/**
 * MCP request dispatcher for the Outlook Assistant server.
 *
 * Extracted from index.js so the dispatch + error-shaping logic is
 * unit-testable without starting the stdio transport. The SDK answers
 * `initialize` and `ping` itself and negotiates the protocol version; every
 * other request lands here.
 *
 * Two kinds of failure, kept apart (#276):
 * - Protocol errors are thrown as McpError, which the SDK sends as a real
 *   JSON-RPC error: unknown method (-32601), unknown tool (-32602), or a
 *   failure inside the dispatcher itself (-32603).
 * - Tool failures (bad arguments, a throwing handler) are returned as a
 *   visible tool-error result (`{ content: [...], isError: true }`) so the
 *   model can read them and correct itself. A content-less `{ error }` object
 *   would be coerced by the SDK into `{ content: [] }`, which clients render
 *   as EMPTY OUTPUT (#213).
 */
const { McpError, ErrorCode } = require('@modelcontextprotocol/sdk/types.js');
const { coerceArgsAgainstSchema } = require('./utils/schema-coerce');

/**
 * A visible tool-error result.
 * @param {string} text
 * @returns {{content: Array<{type: string, text: string}>, isError: true}}
 */
function toolErrorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * tools/list result: the public fields of every tool (never the handler).
 * @param {Array<object>} TOOLS
 */
function listTools(TOOLS) {
  console.error(`TOOLS COUNT: ${TOOLS.length}`);
  return {
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      ...(tool.title && { title: tool.title }),
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations && { annotations: tool.annotations }),
    })),
  };
}

/**
 * tools/call: validate arguments, then run the tool's handler.
 * @param {Array<object>} TOOLS
 * @param {object} [params]
 */
async function callTool(TOOLS, params) {
  const { name, arguments: args = {} } = params || {};
  console.error(`TOOL CALL: ${name}`);

  const tool = TOOLS.find((t) => t.name === name);
  if (!tool || !tool.handler) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
  }

  try {
    // Coerce + validate args against the tool's inputSchema before
    // dispatching. Catches array-as-string, boolean-as-string, unknown
    // params, and out-of-enum action values at the MCP boundary so
    // handlers receive properly-typed JS values. (#160, #162)
    if (tool.inputSchema) {
      const coerced = coerceArgsAgainstSchema(args, tool.inputSchema);
      if (coerced.error) {
        return toolErrorResult(
          `Invalid arguments for tool '${name}':\n${coerced.error}`
        );
      }
      return await tool.handler(coerced.args);
    }
    return await tool.handler(args);
  } catch (error) {
    console.error(`Error in tools/call:`, error);
    return toolErrorResult(`Error processing tool call: ${error.message}`);
  }
}

/**
 * Build the MCP fallbackRequestHandler for a given tool set.
 * @param {Array<{name: string, title?: string, description?: string, inputSchema?: object, annotations?: object, handler?: Function}>} TOOLS
 * @returns {(request: object) => Promise<object>}
 */
function createRequestHandler(TOOLS) {
  return async (request) => {
    const { method, params, id } = request;
    console.error(`REQUEST: ${method} [${id}]`);

    try {
      if (method === 'tools/list') return listTools(TOOLS);
      if (method === 'tools/call') return await callTool(TOOLS, params);
    } catch (error) {
      if (error instanceof McpError) throw error;
      console.error(`Error in fallbackRequestHandler:`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Error processing request: ${error.message}`
      );
    }

    throw new McpError(ErrorCode.MethodNotFound, `Method not found: ${method}`);
  };
}

module.exports = { createRequestHandler };
