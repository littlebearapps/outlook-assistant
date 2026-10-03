/**
 * Read-only mode (OUTLOOK_READ_ONLY, #271).
 *
 * When on, the dispatcher refuses every tool call whose risk class
 * (utils/risk-classes.js) isn't `read`, after argument validation and before
 * the handler runs, so nothing reaches Graph and nothing is written locally.
 *
 * - Dry runs are refused too: whether a tool honours `dryRun` varies by tool
 *   and action, so the gate never relies on it.
 * - A call with no risk class (an unknown tool or action) is refused: the
 *   gate fails closed.
 * - The `auth` tool is exempt. Signing in only writes the local token file,
 *   and without it no read tool can work.
 */
const { TOOL_RISK, classify } = require('./risk-classes');
const { toolError } = require('./tool-error');

/** Tools that run in read-only mode whatever their class. */
const READ_ONLY_EXEMPT = new Set(['auth']);

/** What a call of each class would do, for the refusal message. */
const EFFECTS = {
  reversible: 'change data in the mailbox or write a local file',
  outward: 'send or notify other people',
  destructive: 'delete something that may not be recoverable',
  persistent:
    'set up something that keeps acting after this call (rules, forwarding or automatic replies)',
};

const NEXT_STEP =
  'Tell the user this change is blocked by read-only mode; do not retry it or try another tool. To allow changes, the user can unset OUTLOOK_READ_ONLY in the MCP server configuration and restart the server.';

/**
 * The refusal for a tool call in read-only mode, or null if it may run.
 * @param {string} toolName
 * @param {object} [args] - validated arguments (only `action` is read)
 * @returns {{content: Array<{type: 'text', text: string}>, isError: true}|null}
 */
function readOnlyRefusal(toolName, args = {}) {
  if (READ_ONLY_EXEMPT.has(toolName)) return null;
  const riskClass = classify(toolName, args.action);
  if (riskClass === 'read') return null;

  // Name the action that would run, including a tool's default action.
  const action = args.action ?? TOOL_RISK[toolName]?.defaultAction;
  const call = action ? `${toolName} action=${action}` : toolName;
  const effect = EFFECTS[riskClass] || 'make a change that is not classified';
  return toolError(
    `Outlook Assistant is in read-only mode (OUTLOOK_READ_ONLY). ${call} would ${effect}; nothing was changed.`,
    { nextStep: NEXT_STEP }
  );
}

module.exports = { readOnlyRefusal, READ_ONLY_EXEMPT };
