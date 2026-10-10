const config = require('../commitlint.config');

// #335: Dependabot titles its commits `chore(deps): Bump <pkg> from <a> to <b>`.
// The capital B fails `subject-case`, which made Commit Lint red on every
// Dependabot PR. Only that exact shape is ignored.
describe('commitlint config', () => {
  const ignored = (message) => config.ignores.some((fn) => fn(message));

  test('keeps the conventional preset and the default ignores', () => {
    expect(config.extends).toEqual(['@commitlint/config-conventional']);
    expect(config.defaultIgnores).toBe(true);
    expect(config.ignores).toHaveLength(1);
  });

  // The titles of Dependabot PRs #312–#318, plus its grouped form.
  test.each([
    ['chore(deps): Bump anthropics/claude-code-action from 1.0.235 to 1.0.240'],
    ['chore(deps): Bump actions/setup-node from 6.4.0 to 7.0.0'],
    ['chore(deps): Bump supertest from 7.2.2 to 7.3.1'],
    ['chore(deps): Bump @commitlint/cli from 20.5.3 to 21.2.3'],
    ['chore(deps): Bump @commitlint/config-conventional from 20.5.3 to 21.2.3'],
    ['chore(deps): Bump dotenv from 17.4.2 to 18.0.5'],
    ['chore(deps): Bump actions/github-script from 8.0.0 to 9.0.0'],
    ['chore(deps-dev): Bump jest from 30.0.0 to 30.1.0'],
    [
      'chore(deps): Bump the dev-dependencies group across 1 directory with 3 updates',
    ],
    ['chore(deps): Bump the dev-dependencies group with 2 updates'],
    // A single update inside a group, with and without versions.
    [
      'chore(deps): Bump eslint from 9.1.0 to 9.2.0 in the dev-dependencies group',
    ],
    ['chore(deps): Bump prettier in the dev-dependencies group'],
    [
      'chore(deps): Bump eslint from 9.1.0 to 9.2.0 in the dev-dependencies group across 1 directory',
    ],
    [
      'chore(deps): Bump prettier in the dev-dependencies group across 2 directories',
    ],
    ['chore(deps): Bump supertest from 7.2.2 to 7.3.1 across 1 directory'],
    [
      'chore(deps): Bump supertest from 7.2.2 to 7.3.1\n\nBumps [supertest](https://github.com/forwardemail/supertest) from 7.2.2 to 7.3.1.\n\nSigned-off-by: dependabot[bot] <support@github.com>',
    ],
  ])('ignores a Dependabot subject: %s', (message) => {
    expect(ignored(message)).toBe(true);
  });

  test.each([
    ['feat: Add thing'],
    ['fix(search): Bump the scan limit from 500 to 1000'],
    ['chore: Bump supertest from 7.2.2 to 7.3.1'],
    ['chore(deps): Bump'],
    ['chore(deps): Bump supertest'],
    ['chore(deps): Update supertest from 7.2.2 to 7.3.1'],
    ['chore(deps): Bump supertest from 7.2.2 to 7.3.1 and rewrite the tests'],
    ['chore(deps): Bump prettier in the dev-dependencies group and fix lint'],
    ['chore(deps): Bump prettier in the group'],
    ['chore(deps): Bump prettier across 1 directory'],
    ['chore(deps): Bump in the dev-dependencies group'],
    ['chore(deps): Bump eslint from 9.1.0 in the dev-dependencies group'],
    ['feat(search): Bump the page size in the narrowing group'],
    [`chore(deps): Bump ${'a '.repeat(5000)}from 1 to 2 x`],
    ['chore(release): Bump version from 3.14.1 to 3.14.2'],
    ['Bump supertest from 7.2.2 to 7.3.1'],
    ['feat: Add thing\n\nchore(deps): Bump supertest from 7.2.2 to 7.3.1'],
    // Lower-case subjects already pass every rule, so they stay linted.
    ['chore(deps): bump supertest from 7.2.2 to 7.3.1'],
    [''],
  ])('still lints: %s', (message) => {
    expect(ignored(message)).toBe(false);
  });
});
