// Dependabot titles its commits `chore(deps): Bump <package> from <a> to <b>`.
// It copies the capital letter from the repo's history and has no setting for
// it, and `subject-case` rejects it, so Commit Lint failed on every Dependabot
// PR (#335). Only Dependabot's own headers are skipped:
//   Bump <package> from <a> to <b>
//   Bump <package> from <a> to <b> in the <name> group
//   Bump <package> in the <name> group
//   (each of those may end " across <n> directory|directories")
//   Bump the <name> group [across <n> directory|directories] with <n> updates
// The type and scope must be `chore(deps)` or `chore(deps-dev)`, and the line
// must end where Dependabot's does. Every token is a run of non-spaces between
// fixed words, so matching is linear in the length of the header.
const DIRECTORIES = '(?: across \\d+ director(?:y|ies))?';
const DEPENDABOT_BUMP = new RegExp(
  '^chore\\(deps(?:-dev)?\\): Bump (?:' +
    `\\S+ (?:from \\S+ to \\S+(?: in the \\S+ group)?|in the \\S+ group)${DIRECTORIES}` +
    `|the \\S+ group${DIRECTORIES} with \\d+ updates?` +
    ')$'
);

module.exports = {
  extends: ['@commitlint/config-conventional'],
  defaultIgnores: true,
  ignores: [(message) => DEPENDABOT_BUMP.test(message.split('\n', 1)[0])],
};
