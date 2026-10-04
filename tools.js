/**
 * Tool registry: every tool the server exposes, in listing order.
 *
 * Kept separate from index.js so tests can load the real tool list without
 * starting the stdio transport. Add a new module's tools here (and classify
 * them in utils/risk-classes.js).
 */
const { authTools } = require('./auth');
const { calendarTools } = require('./calendar');
const { emailTools } = require('./email');
const { folderTools } = require('./folder');
const { rulesTools } = require('./rules');
const { contactsTools } = require('./contacts');
const { categoriesTools } = require('./categories');
const { settingsTools } = require('./settings');
const { advancedTools } = require('./advanced');

const TOOLS = [
  ...authTools,
  ...calendarTools,
  ...emailTools,
  ...folderTools,
  ...rulesTools,
  ...contactsTools,
  ...categoriesTools,
  ...settingsTools,
  ...advancedTools,
];

module.exports = { TOOLS };
