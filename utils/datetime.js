/**
 * Shared ISO 8601 date-time parsing and timezone conversion.
 *
 * Nothing here reads the server's local timezone: zoned values are converted
 * with their own `Z`/offset, and wall-clock values are read in an explicit IANA
 * zone through Intl, so results are the same on every machine.
 */
const config = require('../config');

// An ISO 8601 instant with an explicit zone: `Z` or a ±hh:mm offset. A
// zone-less value would be read in the server's local timezone by Date.parse,
// so results would differ between machines; date-only values are rejected for
// the same reason.
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// A wall-clock date-time with no zone, e.g. 2026-03-01T09:00 or
// 2026-03-01T09:00:00.5. Callers decide which zone it is read in.
const WALL_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/;

const MIN_YEAR = 1900;

/**
 * Error raised for a date-time argument that can't be read, so handlers can
 * report it as a tool error before touching the network.
 */
class InvalidDateTimeError extends Error {}

/** True when year/month/day name a real calendar day (no 30 Feb roll-over). */
function isRealDate(year, month, day) {
  return (
    year >= MIN_YEAR &&
    month >= 1 &&
    month <= 12 &&
    new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day
  );
}

/**
 * Parse an ISO 8601 instant that carries `Z` or a ±hh:mm offset.
 * @returns {number} epoch milliseconds, or NaN when the value isn't one
 */
function parseIsoInstant(value) {
  const s = typeof value === 'string' ? value.trim().replace(/z$/, 'Z') : '';
  const m = ISO_INSTANT.exec(s);
  if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
    return NaN;
  }
  return Date.parse(s);
}

/**
 * Parse a zone-less wall-clock date-time.
 * @returns {number[]|null} [year, month, day, hour, minute, second], or null
 */
function parseWallTime(value) {
  const m = typeof value === 'string' ? WALL_TIME.exec(value.trim()) : null;
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (
    !isRealDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  return [year, month, day, hour, minute, second];
}

const formatters = new Map();

/**
 * Wall-clock date and time of an instant in an IANA zone.
 * @returns {{date: string, time: string, wallMs: number}|null} `date` is
 *   YYYY-MM-DD, `time` HH:mm:ss, `wallMs` the wall-clock fields read as UTC;
 *   null when the zone is unknown to Intl
 */
function zonedParts(ms, timeZone) {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (_e) {
      return null;
    }
    formatters.set(timeZone, fmt);
  }
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(ms))) {
    p[type] = value;
  }
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}:${p.second}`;
  return {
    date,
    time,
    wallMs: Date.parse(`${date}T${time}Z`),
  };
}

/**
 * Convert a wall-clock date-time in an IANA zone to an instant.
 * @returns {number} epoch milliseconds, or NaN for a bad value or zone
 */
function zonedWallTimeToUtcMs(wall, timeZone) {
  const f = parseWallTime(wall);
  if (!f) return NaN;
  const guess = Date.UTC(f[0], f[1] - 1, f[2], f[3], f[4], f[5]);
  const offsetAt = (t) => {
    const parts = zonedParts(t, timeZone);
    return parts ? parts.wallMs - t : NaN;
  };
  const first = offsetAt(guess);
  if (Number.isNaN(first)) return NaN;
  // Re-check the offset at the candidate instant, in case a DST change falls
  // between the naive guess and the real instant.
  const second = offsetAt(guess - first);
  return guess - (second === first ? first : second);
}

/**
 * Turn an ISO 8601 date-time into a Graph dateTimeTimeZone envelope.
 *
 * - With `Z` or a ±hh:mm offset: the same instant, sent in UTC (Graph wants
 *   the dateTime without a trailing Z).
 * - Without a zone: sent unchanged, read in `timeZone` (default
 *   DEFAULT_TIMEZONE).
 *
 * @throws {InvalidDateTimeError} for anything else (date-only, impossible
 *   dates, free text)
 */
function toGraphDateTimeTimeZone(
  value,
  paramName,
  timeZone = config.DEFAULT_TIMEZONE
) {
  const instant = parseIsoInstant(value);
  if (!Number.isNaN(instant)) {
    return {
      dateTime: new Date(instant).toISOString().replace(/(?:\.000)?Z$/, ''),
      timeZone: 'UTC',
    };
  }
  if (parseWallTime(value)) {
    return { dateTime: value.trim(), timeZone };
  }
  throw new InvalidDateTimeError(
    `Invalid ${paramName}: expected an ISO 8601 date-time with a time, e.g. "2026-03-01T09:00:00Z" (UTC), "2026-03-01T09:00:00+10:00" (offset) or "2026-03-01T09:00:00" (read in ${timeZone}) (got ${JSON.stringify(String(value).slice(0, 40))}).`
  );
}

module.exports = {
  InvalidDateTimeError,
  parseIsoInstant,
  zonedParts,
  zonedWallTimeToUtcMs,
  toGraphDateTimeTimeZone,
};
