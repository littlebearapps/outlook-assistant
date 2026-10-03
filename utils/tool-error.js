/**
 * Tool-error results (#275).
 *
 * A failed tool call must come back as `{ content, isError: true }`.
 * Without the flag, clients and models read the failure as a success.
 * Every handler error goes through these helpers, and should say what to do
 * next.
 */

/** What to do when a call fails because nobody is signed in. */
const AUTH_NEXT_STEP =
  'Sign in with the `auth` tool with action=authenticate, then retry this call.';

/**
 * A visible MCP tool error.
 * @param {string} message - what went wrong
 * @param {{nextStep?: string}} [options] - what the caller should do next
 * @returns {{content: Array<{type: 'text', text: string}>, isError: true}}
 */
function toolError(message, { nextStep } = {}) {
  const text = nextStep ? `${message}\n\nNext step: ${nextStep}` : message;
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * The error for a call made while signed out (or with a rejected token).
 * @returns {{content: Array<{type: 'text', text: string}>, isError: true}}
 */
function authRequiredError() {
  return toolError('Authentication required.', { nextStep: AUTH_NEXT_STEP });
}

module.exports = { toolError, authRequiredError, AUTH_NEXT_STEP };
