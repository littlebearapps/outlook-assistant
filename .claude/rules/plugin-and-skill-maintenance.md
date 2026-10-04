# Plugin and skill maintenance

The marketplace plugin (`plugins/outlook-assistant/`) ships the MCP server pinned to an exact npm version. v3.14.0 (milestone #6) adds an agent skill (`skills/using-outlook-assistant/`, #282) and a safety hook (#283): `hooks/hooks.json` for Claude Code and `com.github.copilot/hooks/hooks.json` for Copilot CLI (its tools are named `outlook-<tool>`, verified on Copilot CLI 1.0.91), both running `hooks/outlook-gate.js`. Copilot reads flat `permissionDecision`/`additionalContext`, so in Copilot mode the gate sends the flat and the nested Claude forms; it lets a call through when a hook times out, so keep `timeout` at 30. In Copilot mode the gate also fails closed on naming: any tool name containing "outlook" is treated as ours, and if it can't be placed in the risk map, the gate asks. The Cursor hook is deferred. They must stay in step with the server, or the safety guidance drifts from what the tools actually do.

## Already in place (v3.13.0)

- **Manifests:**
  - `plugins/outlook-assistant/.claude-plugin/plugin.json` (Claude Code: `userConfig` plus inline `mcpServers`)
  - `plugins/outlook-assistant/plugin.json` + `mcp.json` (Agent Plugins 1.0: Copilot, VS Code, Cursor)
  - `.claude-plugin/marketplace.json` (self-hosted Claude marketplace)
- **Versions:** never hand-edit versions or the pinned `npx …@x.y.z` launchers. `npm version <patch|minor>` runs `scripts/sync-version.js`; `npm run version:check` reports drift; `test/plugin-manifests.test.js` fails on drift.
- **`userConfig`:** every option needs a `default` and must not be `sensitive`, so Cowork can load the plugin. Never put a client secret in any manifest.
- **The Agent Plugins `plugin.json` schema is closed:** only `$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords` and `extensions` are allowed.
- **Before committing plugin changes,** run both `claude plugin validate --strict plugins/outlook-assistant` and `claude plugin validate --strict .claude-plugin/marketplace.json`.

## Added for v3.14.0 (in place, unreleased)

- **`read_only` `userConfig`** (Claude manifest) maps to `OUTLOOK_READ_ONLY` (#271); the gate is `utils/read-only.js`, driven by the risk map.
- **Server `instructions`** (`utils/server-instructions.js`, #271): the skill and hook must restate these hard rules, so change them together. The hard rules stay within the first 512 characters.
- **`requiresUserInteraction`** in `utils/risk-classes.js` publishes `_meta["anthropic/requiresUserInteraction"]` (`riskMeta`); only single-purpose tools whose every call reaches other people (`send-email`, `create-event`) get it.

## When you add or change a tool or action

1. **Classify it** in the risk-class map (`utils/risk-classes.js`, #270, in place) as `read`, `reversible`, `outward`, `destructive` or `persistent`, and spread `...toolMetadata(name, title)` into the definition. The `title` and all four annotation hints derive from it, and `test/utils/risk-classes.test.js` fails on any unclassified tool or action. `OUTLOOK_READ_ONLY` (#271) refuses every non-`read` call from it; if `action` is optional, set the map's `defaultAction` to the handler's default. Add any new `dryRun` preview to `DRY_RUN_ACTIONS` there too. The hook's `risk-map.json` and the skill's risk table are generated from it: run `node scripts/sync-risk-map.js`, and `test/plugin-hooks.test.js` fails while either is stale.
2. **Update the skill reference for that surface** under `plugins/outlook-assistant/skills/using-outlook-assistant/references/` (#282). A new Microsoft surface (OneDrive, To Do, Teams) gets its own reference file plus a row in the SKILL.md routing table.
3. **Add hook reason text** in `describe()` (`plugins/outlook-assistant/hooks/outlook-gate.js`, #283) for any new `outward`, `destructive` or `persistent` action. It must say exactly who is notified or what is lost; `test/plugin-hooks.test.js` fails on the generic fallback.
4. **Keep the skill format portable:**
   - only the 6 Agent Skills frontmatter fields (`name`, `description`, `license`, `compatibility`, `metadata` with string values, `allowed-tools` as a string);
   - `name` equals the folder name;
   - SKILL.md under 500 lines, with the hard rules in the first screen;
   - links only to files inside the skill folder.
   `vally lint` (awesome-copilot's gate) and VS Code reject violations, and VS Code rejects them silently.

## Tool design rules (all clients, not just one)

- Never hand-write annotation hints; get the risk class right for **every** action and `toolMetadata` derives them: `destructiveHint` = any `outward`, `destructive` or `persistent` action; `openWorldHint` = `untrustedContent` or any `outward`/`persistent` action; `idempotentHint` = read-only or the tool's `idempotent` flag.
- Keep descriptions to 1,024 characters or less, with the key fact first. VS Code truncates at 1,024 and Claude Code at 2,048. State facts and boundaries, never steer between tools ("instead of", "rather than", "prefer"); `test/tools-registry.test.js` enforces both.
- A tool or action that emails or notifies people gets a `dryRun` preview built with `dryRunResult` (`utils/safety.js`), saying exactly who would be told.
- Every array has `items`. Never put `oneOf`/`anyOf`/`allOf` at the root of an `inputSchema`. `test/schemas.test.js` enforces both and compiles every schema as JSON Schema 2020-12 (Ajv).
- Tool errors return `isError: true` via `toolError(message, { nextStep })` or `authRequiredError()` (`utils/tool-error.js`) and say what to do next. Protocol errors are thrown as `McpError` (JSON-RPC -32601 unknown method, -32602 unknown tool), never returned as results.
- From v3.15.0 (#285): `structuredContent` and the text block must each stand alone, because clients differ in which one the model sees.

## After a release

- Move the awesome-copilot listing to the new tag and SHA. Before approval, edit #4455; after approval, open a PR to `plugins/external.json` there.
- Directory listings and how they refresh: `docs/promotion/marketplace-listings.md` (gitignored, local only).
