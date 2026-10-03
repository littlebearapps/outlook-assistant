/**
 * Risk-class map: the single source of truth for how risky each tool and
 * action is (#270).
 *
 * Every tool, and every value of its `action` enum, is mapped to one class:
 *   - read        no change anywhere
 *   - reversible  changes only the user's own data, and can be undone
 *   - outward     reaches other people (sends, invites, cancellations)
 *   - destructive deletes something that may not be recoverable
 *   - persistent  keeps acting after the call (rules, forwarding, auto-replies)
 *
 * Tool annotations are derived from this map (see riskAnnotations), so the
 * hints can't drift from the classes. The server instructions, read-only
 * mode, the plugin hook and the skill's risk table build on it too. A test
 * fails if any tool or action is unclassified, so new surfaces (OneDrive,
 * To Do, Teams) must be classified on purpose.
 *
 * Per-tool flags:
 *   - untrustedContent  results can carry content written by other people
 *                       (email bodies, attachments, directory data), which
 *                       makes the tool open-world (#92)
 *   - idempotent        repeating a write with the same arguments has no
 *                       further effect (reads are always idempotent)
 *
 * Pure data with no requires, so any module can load it.
 */

const RISK_CLASSES = [
  'read',
  'reversible',
  'outward',
  'destructive',
  'persistent',
];

const TOOL_RISK = {
  auth: {
    // Sign-in only writes the local token file.
    actions: {
      status: 'read',
      authenticate: 'reversible',
      'device-code-complete': 'reversible',
      about: 'read',
    },
  },

  // Calendar
  'list-events': { default: 'read' },
  // Saving an event with attendees sends them invitations.
  'create-event': { default: 'outward' },
  'manage-event': {
    actions: {
      // Organiser updates are sent to attendees.
      update: 'outward',
      decline: 'outward',
      cancel: 'outward',
      // Graph sends cancellations when an organiser deletes a meeting.
      delete: 'outward',
    },
  },

  // Email
  'search-emails': { default: 'read', untrustedContent: true },
  'read-email': { default: 'read', untrustedContent: true },
  'send-email': { default: 'outward' },
  draft: {
    actions: {
      create: 'reversible',
      update: 'reversible',
      send: 'outward',
      delete: 'destructive',
      // reply/reply-all/forward only create a draft; nothing is sent.
      reply: 'reversible',
      'reply-all': 'reversible',
      forward: 'reversible',
    },
    // Reply and forward drafts quote the original message.
    untrustedContent: true,
  },
  'update-email': {
    actions: {
      'mark-read': 'reversible',
      'mark-unread': 'reversible',
      flag: 'reversible',
      unflag: 'reversible',
      complete: 'reversible',
    },
    idempotent: true,
  },
  attachments: {
    // download writes a new local file (never overwrites).
    actions: { list: 'read', view: 'read', download: 'reversible' },
    untrustedContent: true,
  },
  // Writes local files.
  export: { default: 'reversible', untrustedContent: true },
  'get-mail-tips': { default: 'read' },

  // Folders
  folders: {
    actions: {
      list: 'read',
      create: 'reversible',
      // Moves emails between folders.
      move: 'reversible',
      stats: 'read',
      delete: 'destructive',
    },
  },

  // Rules: create/update/reorder change what happens to future mail,
  // including forwarding it to other people.
  'manage-rules': {
    actions: {
      list: 'read',
      create: 'persistent',
      update: 'persistent',
      reorder: 'persistent',
      delete: 'destructive',
    },
  },

  // Contacts
  'manage-contact': {
    actions: {
      list: 'read',
      search: 'read',
      get: 'read',
      create: 'reversible',
      update: 'reversible',
      delete: 'destructive',
    },
  },
  'search-people': { default: 'read', untrustedContent: true },

  // Categories
  'manage-category': {
    actions: {
      list: 'read',
      create: 'reversible',
      update: 'reversible',
      set: 'reversible',
      delete: 'destructive',
    },
  },
  'apply-category': {
    actions: { set: 'reversible', add: 'reversible', remove: 'reversible' },
    idempotent: true,
  },
  'manage-focused-inbox': {
    actions: { list: 'read', set: 'reversible', delete: 'destructive' },
  },

  // Settings: auto-replies answer external senders until switched off.
  'mailbox-settings': {
    actions: {
      get: 'read',
      'set-auto-replies': 'persistent',
      'set-working-hours': 'reversible',
    },
    idempotent: true,
  },

  // Advanced
  'access-shared-mailbox': { default: 'read', untrustedContent: true },
  'find-meeting-rooms': { default: 'read' },
};

/** Classes that make a tool destructive and need a human's confirmation. */
const HIGH_RISK = new Set(['outward', 'destructive', 'persistent']);
/** Classes whose effects reach people outside the mailbox. */
const REACHES_OTHERS = new Set(['outward', 'persistent']);

/**
 * Every class a tool can take, across all its actions.
 * @param {object} entry - TOOL_RISK entry
 * @returns {string[]}
 */
function classesOf(entry) {
  return entry.actions ? Object.values(entry.actions) : [entry.default];
}

/**
 * Risk class for a tool call.
 * @param {string} toolName
 * @param {string} [action] - the call's `action` argument, for action tools
 * @returns {string|undefined} the class, or undefined if unclassified
 */
function classify(toolName, action) {
  const entry = TOOL_RISK[toolName];
  if (!entry) return undefined;
  if (!entry.actions) return entry.default;
  return entry.actions[action];
}

/**
 * MCP annotations for a tool, derived from its risk classes (#277). All four
 * hints are always set explicitly.
 * @param {string} toolName
 * @param {string} title - display title
 * @returns {{title: string, readOnlyHint: boolean, destructiveHint: boolean, idempotentHint: boolean, openWorldHint: boolean}}
 */
function riskAnnotations(toolName, title) {
  const entry = TOOL_RISK[toolName];
  if (!entry) {
    throw new Error(
      `Tool '${toolName}' has no risk class; add it to utils/risk-classes.js`
    );
  }
  const classes = classesOf(entry);
  const readOnly = classes.every((c) => c === 'read');
  return {
    title,
    readOnlyHint: readOnly,
    destructiveHint: classes.some((c) => HIGH_RISK.has(c)),
    idempotentHint: readOnly || entry.idempotent === true,
    openWorldHint:
      entry.untrustedContent === true ||
      classes.some((c) => REACHES_OTHERS.has(c)),
  };
}

/**
 * Top-level tool metadata: the spec's `title` plus derived annotations.
 * Spread into a tool definition: `{ name, ...toolMetadata(name, title), ... }`.
 * @param {string} toolName
 * @param {string} title
 * @returns {{title: string, annotations: object}}
 */
function toolMetadata(toolName, title) {
  return { title, annotations: riskAnnotations(toolName, title) };
}

module.exports = {
  RISK_CLASSES,
  TOOL_RISK,
  classify,
  riskAnnotations,
  toolMetadata,
};
