# Plugin and skill maintenance

The marketplace plugin (`plugins/outlook-assistant/`) ships the MCP server pinned to an exact npm version. v3.14.0 (milestone #6) adds an agent skill (#282) and client hooks (#283); neither is built yet. Once they ship they must stay in step with the server, or the safety guidance drifts from what the tools actually do.

## Already in place (v3.13.0)

- **Manifests:**
  - `plugins/outlook-assistant/.claude-plugin/plugin.json` (Claude Code: `userConfig` plus inline `mcpServers`)
  - `plugins/outlook-assistant/plugin.json` + `mcp.json` (Agent Plugins 1.0: Copilot, VS Code, Cursor)
  - `.claude-plugin/marketplace.json` (self-hosted Claude marketplace)
- **Versions:** never hand-edit versions or the pinned `npx …@x.y.z` launchers. `npm version <patch|minor>` runs `scripts/sync-version.js`; `npm run version:check` reports drift; `test/plugin-manifests.test.js` fails on drift.
- **`userConfig`:** every option needs a `default` and must not be `sensitive`, so Cowork can load the plugin. Never put a client secret in any manifest.
- **The Agent Plugins `plugin.json` schema is closed:** only `$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords` and `extensions` are allowed.
- **Before committing plugin changes,** run both `claude plugin validate --strict plugins/outlook-assistant` and `claude plugin validate --strict .claude-plugin/marketplace.json`.

## When you add or change a tool or action

1. **Classify it** in the risk-class map (`utils/risk-classes.js`, #270, in place) as `read`, `reversible`, `outward`, `destructive` or `persistent`, and spread `...toolMetadata(name, title)` into the definition. The `title` and all four annotation hints derive from it, and `test/utils/risk-classes.test.js` fails on any unclassified tool or action. `OUTLOOK_READ_ONLY` (#271) refuses every non-`read` call from it; if `action` is optional, set the map's `defaultAction` to the handler's default. The hook's `risk-map.json` and the skill's risk table are to derive from it too.

Once the skill and hooks exist:

2. **Update the skill reference for that surface** under `plugins/outlook-assistant/skills/using-outlook-assistant/references/` (#282). A new Microsoft surface (OneDrive, To Do, Teams) gets its own reference file plus a row in the SKILL.md routing table.
3. **Check the hook reason text** for any new `outward`, `destructive` or `persistent` action (#283). It must say exactly who is notified or what is lost.
4. **Keep the skill format portable:**
   - only the 6 Agent Skills frontmatter fields (`name`, `description`, `license`, `compatibility`, `metadata` with string values, `allowed-tools` as a string);
   - `name` equals the folder name;
   - SKILL.md under 500 lines, with the hard rules in the first screen;
   - links only to files inside the skill folder.
   `vally lint` (awesome-copilot's gate) and VS Code reject violations, and VS Code rejects them silently.

## Tool design rules (all clients, not just one)

- Never hand-write annotation hints; get the risk class right for **every** action and `toolMetadata` derives them: `destructiveHint` = any `outward`, `destructive` or `persistent` action; `openWorldHint` = `untrustedContent` or any `outward`/`persistent` action; `idempotentHint` = read-only or the tool's `idempotent` flag.
- Keep descriptions to 1,024 characters or less, with the key fact first. VS Code truncates at 1,024 and Claude Code at 2,048.
- Every array has `items`. Never put `oneOf`/`anyOf`/`allOf` at the root of an `inputSchema`. `test/schemas.test.js` enforces both and compiles every schema as JSON Schema 2020-12 (Ajv).
- Tool errors return `isError: true` via `toolError(message, { nextStep })` or `authRequiredError()` (`utils/tool-error.js`) and say what to do next. Protocol errors are thrown as `McpError` (JSON-RPC -32601 unknown method, -32602 unknown tool), never returned as results.
- From v3.15.0 (#285): `structuredContent` and the text block must each stand alone, because clients differ in which one the model sees.

## After a release

- Move the awesome-copilot listing to the new tag and SHA. Before approval, edit #4455; after approval, open a PR to `plugins/external.json` there.
- Directory listings and how they refresh: `docs/promotion/marketplace-listings.md` (gitignored, local only).
