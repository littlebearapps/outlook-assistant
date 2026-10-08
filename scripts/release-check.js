#!/usr/bin/env node
/**
 * Release decisions for the GitHub workflows (#319), kept here so they can be
 * tested. No dependencies: auto-tag runs it before any `npm ci`.
 *
 *   node scripts/release-check.js compare <previous> <current>
 *     → "changed=true|false" and "prerelease=true|false" (GITHUB_OUTPUT lines).
 *       changed is true only when <current> is a higher semver than
 *       <previous>; a missing or unreadable <previous> means no change.
 *   node scripts/release-check.js prerelease <version>
 *     → "prerelease=true|false"
 *
 * Exits 1 when <current> (or <version>) isn't a semver version.
 */

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

/**
 * @param {string} version
 * @returns {{core: number[], pre: string[]}}
 * @throws {Error} When the value isn't semver
 */
function parse(version) {
  const match = SEMVER.exec(String(version ?? '').trim());
  if (!match) {
    throw new Error(`"${version}" is not a semver version`);
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

/** Semver precedence of two prerelease identifiers. */
function compareIdentifier(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Number(a) - Number(b);
  if (aNum) return -1; // numeric identifiers sort before alphanumeric ones
  if (bNum) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Semver precedence: negative, zero or positive. Build metadata is ignored.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareSemver(a, b) {
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i];
  }
  // A release outranks any prerelease of the same version.
  if (left.pre.length === 0 || right.pre.length === 0) {
    return right.pre.length - left.pre.length;
  }
  const length = Math.max(left.pre.length, right.pre.length);
  for (let i = 0; i < length; i++) {
    if (left.pre[i] === undefined) return -1;
    if (right.pre[i] === undefined) return 1;
    const order = compareIdentifier(left.pre[i], right.pre[i]);
    if (order !== 0) return order;
  }
  return 0;
}

/**
 * @param {string} version
 * @returns {boolean} True for a semver prerelease such as 3.15.0-rc.1
 */
function isPrerelease(version) {
  return parse(version).pre.length > 0;
}

/**
 * Whether a push that moved package.json from <previous> to <current>
 * should be tagged and released.
 * @param {string} previous - Version before the push ('' when unknown)
 * @param {string} current - Version after the push
 * @returns {{changed: boolean, prerelease: boolean, reason: string}}
 * @throws {Error} When <current> isn't semver
 */
function decideRelease(previous, current) {
  const prerelease = isPrerelease(current);
  try {
    parse(previous);
  } catch {
    return {
      changed: false,
      prerelease,
      reason: `no readable previous version ("${previous}"); not tagging`,
    };
  }
  const order = compareSemver(current, previous);
  if (order > 0) {
    return {
      changed: true,
      prerelease,
      reason: `version raised: ${previous} → ${current}`,
    };
  }
  if (order < 0) {
    return {
      changed: false,
      prerelease,
      reason: `version went down (${previous} → ${current}); not tagging`,
    };
  }
  return {
    changed: false,
    prerelease,
    reason: `no version change (${current})`,
  };
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'compare' && args.length === 2) {
    const decision = decideRelease(args[0], args[1]);
    console.error(decision.reason);
    process.stdout.write(
      `changed=${decision.changed}\nprerelease=${decision.prerelease}\n`
    );
    return 0;
  }
  if (command === 'prerelease' && args.length === 1) {
    process.stdout.write(`prerelease=${isPrerelease(args[0])}\n`);
    return 0;
  }
  console.error(
    'usage: release-check.js compare <previous> <current> | prerelease <version>'
  );
  return 2;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`release-check: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { compareSemver, isPrerelease, decideRelease };
