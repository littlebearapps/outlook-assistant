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
 * Not for caller-written `$search` expressions, which pass through as-is.
 * @param {string} str - Raw user text
 * @returns {string} - e.g. `Sam "the man" Lee` → `"Sam \"the man\" Lee"`
 */
function quoteSearchPhrase(str) {
  return `"${escapeSearchPhrase(str)}"`;
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
  buildODataFilter,
};
