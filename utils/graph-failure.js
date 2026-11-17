/**
 * What a failed Microsoft Graph call means, by HTTP status and Graph error
 * code, and the tool errors for the two the caller has to act on (401, 403).
 * Shared by the search ladder (#331) and the listing paths (#341).
 */
const { toolError, authRequiredError } = require('./tool-error');

/**
 * The 400s by which Graph says "I don't support this request shape": an
 * answer, after which the next step of the ladder is the right move.
 */
const REFUSAL_CODES = new Set([
  'InefficientFilter',
  'ErrorInvalidUrlQueryFilter',
  'SearchWithFilter',
  'SearchWithOrderBy',
]);

/**
 * The messages the Graph client (`utils/graph-api.js`) gives a failed
 * response: `API call failed with status NNN: <body>` and, for a MIME export,
 * `MIME export failed with status NNN: <body>`. A 401 is the bare
 * `UNAUTHORIZED`.
 */
const CLIENT_FAILURE = /^(?:API call|MIME export) failed with status (\d{3}):/;

/**
 * HTTP status and Graph error code of a failed call, where it has them. The
 * error's own `status`/`graphCode` come first. They are read from the message
 * only when it is one of the client's own (an older path or a mock without
 * the properties), never from other text: a folder-not-found message quotes
 * the caller's folder name, and a folder called "status 403" is not a 403.
 */
function failureDetails(error) {
  const message = String(error?.message || '');
  const fromClient = CLIENT_FAILURE.exec(message);
  let status = Number(error?.status) || null;
  if (!status) {
    if (fromClient) status = Number(fromClient[1]);
    else if (message === 'UNAUTHORIZED') status = 401;
  }
  let code = error?.graphCode || null;
  if (!code) {
    const match =
      fromClient && /"code"\s*:\s*"([A-Za-z0-9_.-]+)"/.exec(message);
    code = match ? match[1] : error?.code || null;
  }
  return { status, code, message };
}

/**
 * What a failed request means for the search:
 * - `refusal`: a recognised 400 for an unsupported shape. Graph answered.
 * - `auth` (401) and `forbidden` (403): the caller has to act; the search
 *   must stop with an error, not come back empty.
 * - `failure`: everything else (5xx, throttling, 404, a timeout, a network
 *   error, anything unrecognised). Nothing was learned, so the search is
 *   incomplete. Unknown errors land here on purpose: treating them as an
 *   answer is how a failure used to become "no message matches".
 * @returns {'refusal'|'auth'|'forbidden'|'failure'}
 */
function classifyFailure(error) {
  const { status, code, message } = failureDetails(error);
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 400) {
    if (REFUSAL_CODES.has(code)) return 'refusal';
    if (/syntax error/i.test(message)) return 'refusal';
  }
  return 'failure';
}

/** "503 ServiceUnavailable": status and code only, never the response body. */
function failureLabel(error) {
  const { status, code } = failureDetails(error);
  return [status, code].filter(Boolean).join(' ') || 'no response';
}

/**
 * Graph answered 403: a permission or policy decision the caller has to see.
 * The search ladder used to absorb it and come back with "no emails found".
 * @param {Error} error - The failed call
 * @param {string|null} [sharedMailbox] - The shared mailbox the call targeted
 * @param {string} [what] - What was refused, as the message names it
 */
function forbiddenError(error, sharedMailbox, what = 'search') {
  const label = failureLabel(error);
  const nextStep =
    'Run `auth` with action=about to check the signed-in account and the granted scopes. A 403 is a permission or policy decision: report it, and do not retry through another tool or address.';
  if (sharedMailbox) {
    return toolError(
      `Access denied to shared mailbox "${sharedMailbox}" (${label}).\n\n**Possible causes:**\n- You don't have access to this shared mailbox\n- The Mail.Read.Shared permission is not granted\n- The shared mailbox address is incorrect`,
      { nextStep }
    );
  }
  return toolError(`Microsoft Graph refused this ${what} (${label}).`, {
    nextStep,
  });
}

/**
 * The tool error for a call Graph answered with a 401 or a 403, or null for
 * any other error, which the handler reports in its own words. (#341)
 * @param {Error} error - The failed call
 * @param {string|null} sharedMailbox - The shared mailbox the call targeted
 * @param {string} what - What was refused, as the 403 message names it
 * @returns {object|null}
 */
function accessError(error, sharedMailbox, what) {
  const kind = classifyFailure(error);
  if (kind === 'auth') return authRequiredError();
  if (kind === 'forbidden') return forbiddenError(error, sharedMailbox, what);
  return null;
}

/**
 * Graph refused to send or draft as a shared mailbox: a 403, or a send-as
 * denial under any status. Null for every other error, and for calls on the
 * signed-in user's own mailbox, which the handler reports in its own words.
 * @param {Error} error - The failed call
 * @param {string|null} sharedMailbox - The shared mailbox the call acted as
 * @param {string} what - What was refused, e.g. "sending email"
 * @returns {object|null}
 */
function sharedSendError(error, sharedMailbox, what) {
  if (!sharedMailbox) return null;
  const { status, code } = failureDetails(error);
  if (status !== 403 && code !== 'ErrorSendAsDenied') return null;
  return toolError(
    `Microsoft Graph refused this call (${what}) as shared mailbox "${sharedMailbox}" (${failureLabel(error)}).\n\n**Possible causes:**\n- Your account has neither "Send As" nor "Send on Behalf" on this mailbox in Exchange\n- Mail.Send.Shared (sending) or Mail.ReadWrite.Shared (drafts) is not granted to the token\n- You have no delegate access to the mailbox, or the address is wrong`,
    {
      nextStep:
        'Run `auth` with action=about to check the granted scopes; re-authenticate with `auth action=authenticate force=true` if Mail.Send.Shared is missing. Otherwise an Exchange admin has to grant "Send As" (mail shows the shared address as sender) or "Send on Behalf" (mail shows "you on behalf of the shared address"). A 403 is final: report it, and do not resend from another mailbox or tool.',
    }
  );
}

module.exports = {
  sharedSendError,
  failureDetails,
  classifyFailure,
  failureLabel,
  forbiddenError,
  accessError,
};
