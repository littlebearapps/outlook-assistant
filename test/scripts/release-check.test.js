/**
 * scripts/release-check.js decides, for auto-tag and publish, whether a push
 * changed the version and whether that version is a prerelease (#319).
 */
const { execFileSync } = require('child_process');
const path = require('path');
const {
  compareSemver,
  isPrerelease,
  decideRelease,
} = require('../../scripts/release-check');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'release-check.js');
const run = (...args) =>
  execFileSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

describe('compareSemver', () => {
  test.each([
    ['3.14.2', '3.14.1', 1],
    ['3.14.1', '3.14.2', -1],
    ['3.14.1', '3.14.1', 0],
    ['3.15.0', '3.14.9', 1],
    ['4.0.0', '3.99.99', 1],
    ['3.10.0', '3.9.0', 1], // numeric, not string, order
    ['3.15.0', '3.15.0-rc.1', 1], // a release outranks its prereleases
    ['3.15.0-rc.2', '3.15.0-rc.1', 1],
    ['3.15.0-rc.10', '3.15.0-rc.9', 1], // numeric identifiers
    ['3.15.0-rc.1', '3.15.0-beta.9', 1], // alphanumeric, ASCII order
    ['3.15.0-alpha', '3.15.0-alpha.1', -1], // fewer identifiers sort first
    ['3.15.0-1', '3.15.0-alpha', -1], // numeric before alphanumeric
    ['3.14.2+build.5', '3.14.2', 0], // build metadata is ignored
  ])('%s vs %s → %i', (a, b, expected) => {
    expect(Math.sign(compareSemver(a, b))).toBe(expected);
  });

  test('throws on a version that is not semver', () => {
    expect(() => compareSemver('3.14', '3.14.1')).toThrow(/not a semver/);
  });
});

describe('isPrerelease', () => {
  test.each([
    ['3.15.0-rc.1', true],
    ['3.15.0-0', true],
    ['3.15.0', false],
    ['3.15.0+build-7', false], // a hyphen in build metadata isn't a prerelease
  ])('%s → %s', (version, expected) => {
    expect(isPrerelease(version)).toBe(expected);
  });
});

describe('decideRelease', () => {
  test('a higher version is a release', () => {
    expect(decideRelease('3.14.1', '3.14.2')).toEqual({
      changed: true,
      prerelease: false,
      reason: 'version raised: 3.14.1 → 3.14.2',
    });
  });

  test('a prerelease is a release, flagged as a prerelease', () => {
    expect(decideRelease('3.14.2', '3.15.0-rc.1')).toMatchObject({
      changed: true,
      prerelease: true,
    });
  });

  test('an unchanged version is not', () => {
    expect(decideRelease('3.14.2', '3.14.2')).toMatchObject({
      changed: false,
    });
  });

  // A force push can move main back to an older version; publishing that
  // would make npm `latest` point backwards.
  test('a lower version is not, and says why', () => {
    expect(decideRelease('3.15.0', '3.14.2')).toEqual({
      changed: false,
      prerelease: false,
      reason: 'version went down (3.15.0 → 3.14.2); not tagging',
    });
  });

  // No previous version: the first push of a branch (zero before SHA) with
  // no parent commit, or a package.json that didn't exist before.
  test('no previous version is not a release', () => {
    expect(decideRelease('', '3.14.2')).toMatchObject({ changed: false });
  });

  test('an unreadable previous version is not a release', () => {
    expect(decideRelease('not-a-version', '3.14.2')).toMatchObject({
      changed: false,
    });
  });

  test('an invalid current version throws', () => {
    expect(() => decideRelease('3.14.1', 'banana')).toThrow(/not a semver/);
  });
});

describe('CLI', () => {
  test('compare prints GITHUB_OUTPUT lines', () => {
    expect(run('compare', '3.14.1', '3.15.0-rc.1')).toBe(
      'changed=true\nprerelease=true\n'
    );
    expect(run('compare', '3.14.2', '3.14.2')).toBe(
      'changed=false\nprerelease=false\n'
    );
  });

  test('compare with an empty previous version reports no change', () => {
    expect(run('compare', '', '3.14.2')).toBe(
      'changed=false\nprerelease=false\n'
    );
  });

  test('prerelease prints one GITHUB_OUTPUT line', () => {
    expect(run('prerelease', '3.15.0-rc.1')).toBe('prerelease=true\n');
    expect(run('prerelease', '3.14.2')).toBe('prerelease=false\n');
  });

  test('an invalid current version exits non-zero', () => {
    expect(() => run('compare', '3.14.1', 'banana')).toThrow();
  });
});
