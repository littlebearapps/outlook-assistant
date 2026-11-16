/**
 * OData helper functions for Microsoft Graph API
 */

/**
 * Escapes a string for use in OData queries
 * @param {string} str - The string to escape
 * @returns {string} - The escaped string
 */
function escapeODataString(str) {
  if (!str) return str;

  // Replace single quotes with double single quotes (OData escaping)
  return str.replace(/'/g, "''");
}

/**
 * Escapes text for use inside a double-quoted Graph `$search` phrase.
 * Graph requires `"` and `\` inside the phrase to be backslash-escaped;
 * backslashes go first so the escapes added for quotes are not doubled. (#251)
 * @param {string} str - Raw user text
 * @returns {string} - Text safe to place between the phrase's quotes
 */
function escapeSearchPhrase(str) {
  if (!str) return str;
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Wraps user text as a double-quoted Graph `$search` phrase, escaping it.
 * For caller-written `$search` expressions use quoteSearchExpression.
 * @param {string} str - Raw user text
 * @returns {string} - e.g. `Sam "the man" Lee` → `"Sam \"the man\" Lee"`
 */
function quoteSearchPhrase(str) {
  return `"${escapeSearchPhrase(str)}"`;
}

/**
 * Whether a `$search` expression is already one double-quoted string: it
 * opens and closes with `"` and every `"` in between is backslash-escaped.
 * `"a" OR "b"` is not (two strings), nor is `"a\"` (the last quote is escaped).
 * @param {string} expr - Trimmed expression
 * @returns {boolean}
 */
function isWholeQuotedSearch(expr) {
  if (
    !expr ||
    expr.length < 2 ||
    !expr.startsWith('"') ||
    !expr.endsWith('"')
  ) {
    return false;
  }
  const inner = expr.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\') {
      // A backslash escapes the next character; a trailing one would escape
      // the closing quote.
      if (i === inner.length - 1) return false;
      i++;
    } else if (inner[i] === '"') {
      return false;
    }
  }
  return true;
}

/**
 * Puts a caller-written `$search` expression in the one form Graph reads as
 * KQL: a single double-quoted string. Unquoted, a field scope or comparison
 * (`from:x`, `received>=…`) is a 400 syntax error, and a multi-word
 * expression (`invoice OR receipt`) is answered with recent mail, unfiltered
 * (measured on a personal mailbox, #333). An expression that is already one
 * quoted string is returned as written; anything else is wrapped, with the
 * caller's own `"` and `\` escaped so they stay inside it.
 * @param {string} expr - Trimmed expression
 * @returns {string} - e.g. `subject:"a b"` → `"subject:\"a b\""`
 */
function quoteSearchExpression(expr) {
  return isWholeQuotedSearch(expr) ? expr : quoteSearchPhrase(expr);
}

/**
 * Builds an OData filter from filter conditions
 * @param {Array<string>} conditions - Array of filter conditions
 * @returns {string} - Combined OData filter expression
 */
function buildODataFilter(conditions) {
  if (!conditions || conditions.length === 0) {
    return '';
  }

  return conditions.join(' and ');
}

module.exports = {
  escapeODataString,
  escapeSearchPhrase,
  quoteSearchPhrase,
  isWholeQuotedSearch,
  quoteSearchExpression,
  buildODataFilter,
};
