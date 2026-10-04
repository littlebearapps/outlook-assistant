# Contributing to Outlook Assistant Server

Thank you for your interest in contributing! This document provides guidelines and instructions.

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check existing issues to avoid duplicates.

When creating a bug report, include:
- Node.js version (`node --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behaviour
- Relevant error messages or logs

Use the [bug report template](https://github.com/littlebearapps/outlook-assistant/issues/new?template=bug_report.yml) when opening an issue.

### Suggesting Features

Feature requests are welcome! Use the [feature request template](https://github.com/littlebearapps/outlook-assistant/issues/new?template=feature_request.yml) and include:
- Clear description of the feature
- Use case / problem it solves
- Proposed implementation (if any)
- Alternatives considered

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes** following the code style below
4. **Add tests** for new functionality
5. **Run tests**: `npm test`
6. **Run linting**: `npm run lint`
7. **Check formatting**: `npm run format:check` (CI runs this; `npm run format` fixes it)
8. **Update documentation** if needed
9. **Submit a pull request** using the PR template

## Development Setup

The server runs on Node.js 18.18+, but the development tooling (the lint-staged pre-commit hook and `npm run inspect`) needs **Node.js 22.22.1 or newer**.

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/outlook-assistant.git
cd outlook-assistant

# Install dependencies
npm install

# Run tests
npm test

# Start in test mode (no real API calls)
npm run test-mode

# Interactive testing with MCP Inspector
npm run inspect
```

## Code Style

- Use consistent indentation (2 spaces)
- Use meaningful variable and function names
- Add JSDoc comments for public functions
- Keep functions focused and small
- Handle errors appropriately

## Project Structure

When adding new tools:

1. Create a new module directory if needed (e.g. `tasks/`)
2. Implement tool handlers in separate files
3. Export tool definitions from the module's `index.js` — prefer consolidating related operations into a single tool with an `action` parameter (STRAP pattern)
4. Classify the tool, and each of its actions, in `utils/risk-classes.js` (`TOOL_RISK`) as `read`, `reversible`, `outward`, `destructive` or `persistent`, then spread `...toolMetadata(name, title)` into the definition. The annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are derived from the class, and a test fails on anything unclassified — see the [Tools Reference](docs/quickrefs/tools-reference.md#safety-annotations). If an action returns a preview for `dryRun: true`, add it to `DRY_RUN_ACTIONS` in the same file
5. Run `node scripts/sync-risk-map.js` to copy the classes into the plugin hook's `plugins/outlook-assistant/hooks/risk-map.json` and the skill's risk table (`--check` reports drift; a test fails while either is stale)
6. For any new `outward`, `destructive` or `persistent` action, add a reason to `describe()` in `plugins/outlook-assistant/hooks/outlook-gate.js` that says exactly who is notified or what is lost (a test fails on the generic fallback)
7. Update the skill reference for that surface under `plugins/outlook-assistant/skills/using-outlook-assistant/references/`; a new Microsoft surface gets its own reference file and a row in the `SKILL.md` routing table
8. Add the module's tools to `TOOLS` in `tools.js`, and return errors with `toolError()` from `utils/tool-error.js`
9. Add tests in the `test/` directory
10. Update `docs/quickrefs/tools-reference.md`
11. Run the checks: `npm test`, `npm run lint`, `npm run format:check` and `claude plugin validate --strict plugins/outlook-assistant`

Optionally, `node scripts/skill-evals.js` runs the prompt-injection evals against the skill and hook. It needs a signed-in `claude` CLI and spends real model tokens.

The full checklist for plugin, skill and hook changes is in [`.claude/rules/plugin-and-skill-maintenance.md`](.claude/rules/plugin-and-skill-maintenance.md).

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add conversation export to MBOX format
fix: resolve folder stats API error
docs: update installation instructions
test: add tests for contacts module
```

## Testing

- Write tests for new functionality
- Ensure existing tests pass: `npm test`
- Use test mode for development: `USE_TEST_MODE=true npm start`
- Shared-mailbox code paths are opt-in; tests that exercise them switch the setting on with `test/helpers/shared-mailbox.js`

## Questions?

If you have questions, feel free to [open a discussion](https://github.com/littlebearapps/outlook-assistant/discussions).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
