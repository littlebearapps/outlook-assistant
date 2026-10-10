// Dependabot titles its commits `chore(deps): Bump <package> from <a> to <b>`
// (or `Bump the <name> group … with <n> updates`). It copies the capital letter
// from the repo's history and has no setting for it, and `subject-case`
// rejects it, so Commit Lint failed on every Dependabot PR (#335). Only that
// exact header is skipped: the type and scope must be `chore(deps)` or
// `chore(deps-dev)`, and the line must end where Dependabot's does.
const DEPENDABOT_BUMP =
  /^chore\(deps(-dev)?\): Bump (\S+ from \S+ to \S+|the \S+ group( across \d+ director(y|ies))? with \d+ updates?)$/;

module.exports = {
  extends: ['@commitlint/config-conventional'],
  defaultIgnores: true,
  ignores: [(message) => DEPENDABOT_BUMP.test(message.split('\n', 1)[0])],
};
