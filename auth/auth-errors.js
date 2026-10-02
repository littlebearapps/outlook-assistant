/**
 * Azure AD (AADSTS) error translation.
 *
 * Microsoft's identity platform returns accurate but unfriendly errors: the
 * error_description is a wall of prose ending in a correlation ID, and the
 * single most common setup mistake — pasting the client secret's *ID* instead
 * of its *Value* — surfaces only as `AADSTS7000215: Invalid client secret
 * provided`. (#69)
 *
 * This module maps known codes to actionable remediation text. It only ever
 * *adds* to the original message; the raw Azure error is always preserved so
 * that searching for the code still works.
 */

/**
 * Known Azure error signatures and their remediation hints.
 * Ordered most-specific first; every matching entry contributes a hint.
 */
const AUTH_ERROR_HINTS = [
  {
    // The Secret ID vs Secret Value mistake. First row of docs/troubleshooting.md.
    test: /AADSTS7000215/i,
    hint:
      'Invalid client secret. The usual cause is pasting the **Secret ID** (a UUID like `a1b2c3d4-…`) instead of the **Secret Value** (a longer string with mixed case and symbols). ' +
      'In Azure → App registrations → your app → Certificates & secrets → Client secrets, copy the *Value* column into `OUTLOOK_CLIENT_SECRET`. ' +
      'The Secret Value is shown only once, when the secret is created — if you have navigated away it can no longer be read, so create a new secret. ' +
      'An expired secret produces this same error, so check the Expires column too. ' +
      'See docs/guides/azure-setup.md#4-create-a-client-secret.',
  },
  {
    test: /AADSTS9002331|personal.*account/i,
    hint: 'This app registration appears to accept personal Microsoft accounts only. Set `OUTLOOK_AUTH_AUDIENCE=consumers` (or the correct tenant GUID) in your MCP env and retry.',
  },
  {
    test: /AADSTS7000218|unauthorized_client|invalid_client/i,
    // AADSTS7000215 is also delivered as error=invalid_client, but it means the
    // secret is wrong, not that public client flows are disabled. Suppress the
    // generic hint so the specific one above is not drowned out.
    notWhen: /AADSTS7000215/i,
    hint: "Enable 'Allow public client flows' under Azure → App registration → Authentication → Advanced settings, and add the `nativeclient` redirect URI (Mobile and desktop applications platform).",
  },
  {
    test: /AADSTS700016/i,
    hint: 'The application was not found in this directory. Check `OUTLOOK_CLIENT_ID` matches the Application (client) ID in Azure, and that `OUTLOOK_AUTH_AUDIENCE` targets the right tenant.',
  },
  {
    test: /invalid_grant|AADSTS700082|AADSTS50173/i,
    hint: 'The refresh token is expired or has been revoked (refresh tokens last ~90 days). Re-authenticate with the `auth` tool: `action=authenticate`, then `action=device-code-complete`.',
  },
];

/** Normalise an Error or string into a searchable message. */
function toMessage(input) {
  if (input === null || input === undefined) return '';
  if (input instanceof Error) return input.message || String(input);
  if (typeof input === 'object' && input.message) return String(input.message);
  return String(input);
}

/**
 * Return remediation hints for a Microsoft auth error.
 * @param {Error|string|null|undefined} input - Error or error_description
 * @returns {string[]} - Zero or more hints; empty when the error is unknown
 */
function getAuthErrorHints(input) {
  const msg = toMessage(input);
  if (!msg) return [];
  return AUTH_ERROR_HINTS.filter(
    (e) => e.test.test(msg) && !(e.notWhen && e.notWhen.test(msg))
  ).map((e) => e.hint);
}

/**
 * Append any known remediation hints to an auth error message.
 * Returns the message unchanged when nothing is known, so callers can use this
 * unconditionally without polluting unrelated errors.
 * @param {Error|string} input
 * @returns {string}
 */
function describeAuthError(input) {
  const msg = toMessage(input);
  const hints = getAuthErrorHints(msg);
  if (!hints.length) return msg;
  return [msg, '', 'Suggested fixes:', ...hints.map((h) => `- ${h}`)].join(
    '\n'
  );
}

module.exports = { getAuthErrorHints, describeAuthError, AUTH_ERROR_HINTS };
