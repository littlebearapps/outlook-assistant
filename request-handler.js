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
const config = require('./config');
const { coerceArgsAgainstSchema } = require('./utils/schema-coerce');
const { readOnlyRefusal } = require('./utils/read-only');
const { riskMeta, supportsDryRun, TOOL_RISK } = require('./utils/risk-classes');
const { DRY_RUN_LABEL } = require('./utils/safety');
const { toolError } = require('./utils/tool-error');
const { log, withCallContext, formatNoteValue } = require('./utils/logger');

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
  log.debug(`tools/list: ${TOOLS.length} tools`);
  return {
    tools: TOOLS.map((tool) => {
      // Client-specific flags derived from the risk map (#271), e.g.
      // Claude's anthropic/requiresUserInteraction. Others ignore them.
      const meta = riskMeta(tool.name);
      return {
        name: tool.name,
        ...(tool.title && { title: tool.title }),
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations && { annotations: tool.annotations }),
        ...(meta && { _meta: meta }),
      };
    }),
  };
}

/**
 * The refusal for `dryRun: true` on a call that doesn't honour it (#274), or
 * null. Handlers for those actions ignore the flag and really write, so the
 * call never reaches them.
 * @param {string} toolName
 * @param {object} args - validated arguments
 */
function dryRunRefusal(toolName, args) {
  if (args.dryRun !== true || supportsDryRun(toolName, args.action)) {
    return null;
  }
  const action = args.action ?? TOOL_RISK[toolName]?.defaultAction;
  const call = action ? `${toolName} action=${action}` : toolName;
  return toolError(
    `dryRun is not supported for ${call}; nothing was changed.`,
    {
      nextStep:
        'Describe the change to the user and ask for confirmation, then call it without dryRun.',
    }
  );
}

/**
 * Mark a supported dry run's result as a preview: `_meta.dryRun` and the
 * DRY_RUN_LABEL first line, for handlers that don't set them themselves
 * (send-email, draft create, manage-rules create/update).
 * @param {object} result
 */
function labelDryRun(result) {
  if (!result || result.isError) return result;
  const content = Array.isArray(result.content) ? [...result.content] : [];
  const first = content[0];
  if (first?.type === 'text' && !first.text.startsWith(DRY_RUN_LABEL)) {
    content[0] = { ...first, text: `${DRY_RUN_LABEL}\n\n${first.text}` };
  }
  return { ...result, content, _meta: { ...result._meta, dryRun: true } };
}

/**
 * Run a tool's handler with validated arguments, unless read-only mode
 * (#271) or an unsupported dryRun (#274) refuses the call first. Read-only
 * mode is checked first, so it refuses even a supported dry run of a
 * non-read call.
 * @param {object} tool
 * @param {object} args
 */
async function runTool(tool, args) {
  if (config.READ_ONLY) {
    const refusal = readOnlyRefusal(tool.name, args);
    if (refusal) return refusal;
  }
  const refusal = dryRunRefusal(tool.name, args);
  if (refusal) return refusal;
  const result = await tool.handler(args);
  return args.dryRun === true ? labelDryRun(result) : result;
}

/**
 * The action to show on the call line: only a value from the tool's own
 * `action` enum, `?` for anything else, so free text never reaches the log.
 * @param {object|undefined} tool
 * @param {object} args
 * @returns {string|undefined}
 */
function loggableAction(tool, args) {
  const action = args && args.action;
  if (action === undefined) return undefined;
  const allowed = tool?.inputSchema?.properties?.action?.enum;
  return Array.isArray(allowed) && allowed.includes(action) ? action : '?';
}

/**
 * The one default-level line per tool call (#278): tool name, action,
 * outcome and duration, plus any notes (e.g. a Graph status) collected
 * during the call. Never the arguments.
 */
function logToolCall({ tool, action, outcome, startedAt, notes }) {
  const parts = [`tool=${tool}`];
  if (action !== undefined) parts.push(`action=${action}`);
  parts.push(`outcome=${outcome}`, `ms=${Date.now() - startedAt}`);
  for (const [key, value] of notes) {
    parts.push(`${key}=${formatNoteValue(value)}`);
  }
  log.info(parts.join(' '));
}

/**
 * tools/call: validate arguments, then run the tool's handler. Logs one
 * line per call (see logToolCall).
 * @param {Array<object>} TOOLS
 * @param {object} [params]
 */
function callTool(TOOLS, params) {
  const { name, arguments: args = {} } = params || {};
  const tool = TOOLS.find((t) => t.name === name);
  const startedAt = Date.now();

  return withCallContext(async (ctx) => {
    const line = {
      tool: tool ? name : '?',
      action: loggableAction(tool, args),
      startedAt,
      notes: ctx.notes,
    };
    if (!tool || !tool.handler) {
      logToolCall({ ...line, outcome: 'unknown-tool' });
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    log.debug(
      `tools/call ${name} args: ${Object.keys(args || {}).join(', ') || '(none)'}`
    );

    const { result, error } = await runToolCall(tool, name, args);
    if (error) {
      // Class name only (e.g. TypeError): the message can carry user data.
      const errorClass = /^[A-Za-z]{1,40}$/.test(error?.name)
        ? error.name
        : 'Error';
      ctx.notes.set('error', errorClass);
      logToolCall({ ...line, outcome: 'thrown' });
    } else {
      logToolCall({ ...line, outcome: result?.isError ? 'isError' : 'ok' });
    }
    return result;
  });
}

/**
 * Coerce and validate the arguments, then run the handler.
 * @returns {Promise<{result: object, error?: Error}>}
 */
async function runToolCall(tool, name, args) {
  try {
    // Coerce + validate args against the tool's inputSchema before
    // dispatching. Catches array-as-string, boolean-as-string, unknown
    // params, and out-of-enum action values at the MCP boundary so
    // handlers receive properly-typed JS values. (#160, #162)
    if (tool.inputSchema) {
      const coerced = coerceArgsAgainstSchema(args, tool.inputSchema);
      if (coerced.error) {
        return {
          result: toolErrorResult(
            `Invalid arguments for tool '${name}':\n${coerced.error}`
          ),
        };
      }
      return { result: await runTool(tool, coerced.args) };
    }
    return { result: await runTool(tool, args) };
  } catch (error) {
    log.debug('Error in tools/call:', error);
    return {
      result: toolErrorResult(`Error processing tool call: ${error.message}`),
      error,
    };
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
    log.debug(`REQUEST: ${method} [${id}]`);

    try {
      if (method === 'tools/list') return listTools(TOOLS);
      if (method === 'tools/call') return await callTool(TOOLS, params);
    } catch (error) {
      if (error instanceof McpError) throw error;
      log.info(`Error in fallbackRequestHandler: ${error.name || 'Error'}`);
      log.debug('Error in fallbackRequestHandler:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Error processing request: ${error.message}`
      );
    }

    throw new McpError(ErrorCode.MethodNotFound, `Method not found: ${method}`);
  };
}

module.exports = { createRequestHandler };
