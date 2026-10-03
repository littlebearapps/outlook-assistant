/**
 * Stderr logger (#278). stdout carries the MCP stdio protocol, so every line
 * goes to stderr via console.error.
 *
 * - `log.info`  — always on. Reserved for lines with no personal data:
 *   startup, and the one line per tool call written by request-handler.js.
 * - `log.debug` — only with OUTLOOK_DEBUG=true (also 1/yes/on). Detail such
 *   as search terms and Graph error bodies, still passed through `redact()`.
 * - `log.note` / `log.increment` — a short, PII-free fact (e.g. a Graph
 *   status) attached to the current tool call's line instead of printing a
 *   line of its own, so a call still logs exactly one line by default.
 *
 * Tokens, device user codes and secrets must never be passed to any of these;
 * `redact()` also masks them as a backstop, along with email addresses and
 * long opaque IDs, at every level.
 *
 * No requires of project modules: config.js and the auth modules load this.
 */
const { AsyncLocalStorage } = require('async_hooks');
const util = require('util');

const DEBUG_ON = new Set(['true', '1', 'yes', 'on']);

/**
 * OUTLOOK_DEBUG parsing. Read on every call so tests (and a changed env)
 * take effect without reloading modules.
 * @param {string|undefined} [raw]
 * @returns {boolean}
 */
function isDebugEnabled(raw = process.env.OUTLOOK_DEBUG) {
  return DEBUG_ON.has(
    String(raw ?? '')
      .trim()
      .toLowerCase()
  );
}

// Keys whose values are credentials, in JSON ("key": "v"), inspect output
// (key: 'v') or form/query strings (key=v). Bare `code` is only treated as a
// secret in query strings (the OAuth authorisation code), so Graph error
// codes like {"code":"ErrorItemNotFound"} stay readable.
const SECRET_KEYS =
  'access_?token|refresh_?token|id_?token|client_?secret|device_?code|user_?code|password|assertion|client_assertion|accessToken|refreshToken|idToken|clientSecret|deviceCode|userCode';
const SECRET_KEY_RE = new RegExp(
  `(["']?\\b(?:${SECRET_KEYS})\\b["']?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s&,;"'}]+)`,
  'gi'
);
const QUERY_CODE_RE = /([?&]code=)[^&\s"']+/gi;
const BEARER_RE = /\bBearer\s+[^\s"',]+/gi;
const JWT_RE = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g;
// Local part deliberately excludes `/` so `users/<addr>/…` keeps its path.
const EMAIL_RE =
  /[A-Za-z0-9.!#$%&'*+=?^_`{|}~-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// Graph IDs, GUIDs, trace IDs, hashes: 32+ URL-safe chars mixing letters and
// digits. Plain kebab-case words have no digits, so they are left alone.
const OPAQUE_RE = /[A-Za-z0-9=_-]{32,}/g;

/**
 * Mask personal data and credentials in a log string: email addresses
 * (and Message-IDs, which contain an @) become `<redacted-email>`, long
 * opaque IDs `<id>`, JWT/bearer tokens `<redacted-token>`, and values of
 * secret-bearing keys `<redacted>`.
 * @param {unknown} value
 * @returns {string}
 */
function redact(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(SECRET_KEY_RE, '$1<redacted>')
    .replace(QUERY_CODE_RE, '$1<redacted>')
    .replace(BEARER_RE, 'Bearer <redacted-token>')
    .replace(JWT_RE, '<redacted-token>')
    .replace(EMAIL_RE, '<redacted-email>')
    .replace(OPAQUE_RE, (run) =>
      /\d/.test(run) && /[A-Za-z]/.test(run) ? '<id>' : run
    );
}

/**
 * @param {unknown[]} args
 * @returns {string}
 */
function format(args) {
  return redact(
    args
      .map((arg) =>
        typeof arg === 'string'
          ? arg
          : util.inspect(arg, { depth: 4, breakLength: Infinity })
      )
      .join(' ')
  );
}

// Graph resource names that may appear in a request path. Anything else
// (IDs, folder or display names, free text) is masked by graphPathShape.
const GRAPH_SEGMENTS = new Set(
  [
    'me',
    'users',
    'messages',
    'mailFolders',
    'childFolders',
    'attachments',
    'events',
    'calendar',
    'calendars',
    'calendarView',
    'instances',
    'contacts',
    'contactFolders',
    'people',
    'places',
    'microsoft.graph.room',
    'findRooms',
    'mailboxSettings',
    'automaticRepliesSetting',
    'workingHours',
    'inferenceClassification',
    'overrides',
    'outlook',
    'masterCategories',
    'messageRules',
    'getMailTips',
    'sendMail',
    'send',
    'move',
    'copy',
    'reply',
    'replyAll',
    'forward',
    'createReply',
    'createReplyAll',
    'createForward',
    'accept',
    'tentativelyAccept',
    'decline',
    'cancel',
    'delta',
    '$value',
    '$batch',
    '$count',
    'inbox',
    'drafts',
    'sentItems',
    'deletedItems',
    'junkemail',
    'archive',
    'outbox',
  ].map((s) => s.toLowerCase())
);

/**
 * Reduce a Graph path or URL to a PII-free shape for default-level logs:
 * query string and host dropped, mailbox addresses → `<mailbox>`, every
 * other non-resource segment → `{id}`.
 * @param {string} pathOrUrl
 * @returns {string}
 */
function graphPathShape(pathOrUrl) {
  const raw = String(pathOrUrl || '')
    .split('?')[0]
    .replace(/^https?:\/\/[^/]+\/(?:v1\.0|beta)\//i, '')
    .replace(/^\/+/, '');
  return raw
    .split('/')
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // keep the raw segment
      }
      if (GRAPH_SEGMENTS.has(decoded.toLowerCase())) return decoded;
      return decoded.includes('@') ? '<mailbox>' : '{id}';
    })
    .join('/');
}

const callContext = new AsyncLocalStorage();

/**
 * Run `fn` with a fresh per-call context whose notes end up on the call's
 * single log line.
 * @template T
 * @param {(ctx: {notes: Map<string, string|number>}) => T} fn
 * @returns {T}
 */
function withCallContext(fn) {
  const ctx = { notes: new Map() };
  return callContext.run(ctx, () => fn(ctx));
}

/**
 * Format a note value for a key=value log line (quoted if it has spaces).
 * @param {string|number} value
 * @returns {string}
 */
function formatNoteValue(value) {
  const text = redact(value);
  return /\s/.test(text) ? `"${text.replace(/"/g, "'")}"` : text;
}

const log = {
  /** Always written. Callers must pass no personal data. */
  info(...args) {
    console.error(format(args));
  },

  /** Written only with OUTLOOK_DEBUG on; still redacted. */
  debug(...args) {
    if (!isDebugEnabled()) return;
    console.error(`[debug] ${format(args)}`);
  },

  /**
   * Attach a short, PII-free fact to the current tool call's line (last
   * value wins). Outside a call it is written as its own info line.
   * @param {string} key
   * @param {string|number} value
   */
  note(key, value) {
    const ctx = callContext.getStore();
    if (ctx) ctx.notes.set(key, value);
    else log.info(`${key}=${formatNoteValue(value)}`);
  },

  /**
   * Count an event (e.g. a Graph retry) on the current tool call's line.
   * @param {string} key
   */
  increment(key) {
    const ctx = callContext.getStore();
    if (!ctx) return;
    ctx.notes.set(key, (Number(ctx.notes.get(key)) || 0) + 1);
  },
};

module.exports = {
  log,
  redact,
  isDebugEnabled,
  graphPathShape,
  withCallContext,
  formatNoteValue,
};
