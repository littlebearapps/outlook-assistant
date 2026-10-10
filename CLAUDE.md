# CLAUDE.md - Outlook Assistant

MCP server for Microsoft Outlook via Graph API (v3.14.1). 22 tools across 9 modules. Runtime Node ≥ 18.18; dev tooling (lint-staged hook, `npm run inspect`) needs Node ≥ 22.22.1.

## Commands

```bash
npm install              # Install dependencies (run first)
npm start                # Start MCP server
npm run auth-server      # Start OAuth server on :3333 (browser auth only)
npm test                 # Run Jest tests
npm run test-mode        # Start with mock data (USE_TEST_MODE=true)
npm run inspect          # MCP Inspector for interactive testing
npx kill-port 3333       # Kill auth server if port blocked
node index.js --version  # Print version and exit (also -v); --help for usage
```

### Authentication

**Device code flow (default — recommended for remote/headless; no auth server, SSH tunnel, or port forwarding needed):**
1. Call `auth` tool with `action=authenticate` → returns a code + URL (device-code by default)
2. Visit the URL on any device, enter the code, and sign in
3. Call `auth` tool with `action=device-code-complete` → tokens saved

**Browser redirect flow (alternative, localhost only):**
1. Start the auth server: `npm run auth-server` (needs `OUTLOOK_CLIENT_ID`/`OUTLOOK_CLIENT_SECRET` env vars)
2. Call `auth` tool with `action=authenticate, method=browser` → returns a URL
3. Open the URL → Microsoft login → grant permissions → tokens saved automatically

Full walkthrough: [`docs/how-to/getting-started/connect-outlook-to-claude.md`](docs/how-to/getting-started/connect-outlook-to-claude.md). The MCP server reads its own credentials from `.mcp.json` inline `kc_get` calls.

**Azure prerequisites**:
- Add platform: Authentication > Add a platform > Mobile and desktop applications > check `nativeclient` URI
- Enable "Allow public client flows" in Authentication > Advanced settings
- Use a **private/incognito browser** for `microsoft.com/devicelogin` (avoids cached session interference)

**Client ID without env vars** (plugin marketplaces with static `mcp.json`): `auth action=authenticate clientId=<GUID>` validates and saves it to `~/.outlook-assistant-config.json` (0600, atomic) via `auth/client-config.js`, then signs in. Resolution is lazy everywhere (`AUTH_CONFIG.clientId` is a getter; `TokenStorage.getClientId()`): `OUTLOOK_CLIENT_ID` → `MS_CLIENT_ID` → saved file. A different env value wins, so the tool refuses rather than saving. Device code needs no secret; `outlook-auth-server.js` (browser) stays env-only.

**Token refresh**: Tokens auto-refresh when expired (via `token-storage.js`). Re-authentication only needed when the refresh token expires (~90 days). Refresh re-requests only the **granted** scopes (persisted as `granted_scopes`, falling back to the stored `scope`) plus `offline_access`, not the full configured set.

**Shared-mailbox scopes are opt-in**: `OUTLOOK_SHARED_MAILBOX` (`read` → `Mail.Read.Shared`; `true`/`readwrite`/`1` → both `.Shared` scopes; unset → sign-in requests `BASE_SCOPES` only, unchanged). Parsed in `config.js` (`SHARED_MAILBOX_MODE`, `SHARED_SCOPES`); `utils/mailbox.js` `buildMailboxPrefix` refuses non-`me` mailboxes while it's off. With it on, the device-code path in `auth/tools.js` (at code request or in `handleDeviceCodeComplete`) falls back once to `AUTH_CONFIG.fallbackScopes` when `isScopeConsentError` (`auth/device-code.js`) matches; AADSTS65001 surfaces remediation instead. The browser auth server (`outlook-auth-server.js`) has no fallback. `auth action=about` reports configured vs granted scopes and shared-mailbox status. `sharedMailbox` (alias `email`) is accepted by `search-emails`, `read-email`, `attachments`, `update-email`, `apply-category`, `export` and `folders`; `send-email`/`draft` deliberately have no such param.

## Architecture

Module layout, file organisation, and the v1→v3 tool-consolidation map live in [`docs/architecture.md`](docs/architecture.md).

## Safety Controls

- **MCP annotations** on all 22 tools: all four hints set explicitly and derived from the risk-class map (`utils/risk-classes.js`: `read`/`reversible`/`outward`/`destructive`/`persistent` per tool and action), plus a top-level `title`. `destructiveHint` = any outward, destructive or persistent action; `openWorldHint` = surfaces untrusted content (#92) or reaches other people; `idempotentHint` = read-only or the tool's `idempotent` flag. A test fails on any unclassified tool or action (#270, #277)
- **Read-only mode** (`OUTLOOK_READ_ONLY`, plugin setting `read_only`, #271): `request-handler.js` refuses every call whose risk class isn't `read` after validation and before the handler (`utils/read-only.js`), dry runs included; unclassified calls fail closed; only `auth` authenticate/device-code-complete are exempt (sign-in). Calls that leave `action` out (or null) are classified by the map's `defaultAction`; `test/dispatcher/read-classes-dont-write.test.js` proves no `read` call writes
- **Server `instructions`** (`utils/server-instructions.js`, #271): hard rules in the first 512 characters, under 2,000 in total; `send-email` and `create-event` carry `_meta["anthropic/requiresUserInteraction"]` (risk-map flag via `riskMeta`, never on mixed read/write tools)
- **`dryRun` previews** (#274): `send-email`, `draft` create, `manage-rules` create/update, `create-event`, every `manage-event` action, `mailbox-settings` set-auto-replies, `folders` delete, `manage-contact` delete. Every preview starts `DRY RUN — nothing was changed.` exactly once (#306): the #274 previews via `dryRunResult` (`utils/safety.js`), the rest via the dispatcher's label; calendar ones (`calendar/preview.js`) may read but never write, and say who would be emailed with an external count. That list is `DRY_RUN_ACTIONS` (`utils/risk-classes.js`): `request-handler.js` refuses `dryRun: true` on any other call before the handler (handlers there ignore it and would really write) and stamps `_meta.dryRun` plus the label on supported previews; `test/dispatcher/dry-run-honoured.test.js` checks every tool/action
- **get-mail-tips**: pre-send recipient validation (out-of-office, mailbox full, delivery restrictions); `_meta.issues` lists each flag per recipient
- **Session limits** (`utils/safety.js` `resolveSessionLimit`, #302): per tool `OUTLOOK_MAX_<TOOL>_PER_SESSION`, else `OUTLOOK_MAX_EMAILS_PER_SESSION`; unset = no limit, `0` (or anything not a whole number) refuses every real call, dry runs still preview. Blocked tools are named in the server `instructions`, `auth action=about` and the startup log. `draft` send counts as `send-email`
- **send-email**: `dryRun`, `checkRecipients` (mail tips), session rate limiting (`OUTLOOK_MAX_EMAILS_PER_SESSION`), recipient allowlist (`OUTLOOK_ALLOWED_RECIPIENTS`). With `checkRecipients`, a failed check refuses the send, and a flagged recipient (out of office, mailbox full, delivery restricted, external, group with external members) refuses it until `acknowledgeWarnings: true` (#272); tips never go in the `sendMail` payload
- **draft**: `dryRun` on create, `checkRecipients` (mail tips), recipient allowlist (create/update/forward; reply/reply-all check the generated recipients and delete a refused draft; send re-checks the draft's current to/cc/bcc), rate limiting (create/update/reply/reply-all/forward). Send action shares limit with `send-email`. `update`/`send`/`delete` look the ID up first and refuse anything that isn't an unsent draft (`assertIsDraft` in `email/draft.js`).
- **manage-rules**: `dryRun` on create/update, rate limiting (`OUTLOOK_MAX_MANAGE_RULES_PER_SESSION`), recipient allowlist on forwardTo/redirectTo, no `permanentDelete` (too dangerous for AI). An allowlist-blocked forward/redirect refuses the whole rule or update, dry runs included (`checkRuleRecipients`, #273). The limit counts real writes only: create/update (not dry runs), reorder, and delete once the rule is found (#273, #279). Supports 12 conditions, 9 actions, and exceptions.
- **create-event**: recipient allowlist on every attendee (rooms included; the whole call is refused, dry runs report it; `checkAttendeeAllowlist` in `calendar/attendees.js`), rate limiting (`OUTLOOK_MAX_CREATE_EVENT_PER_SESSION`, else `OUTLOOK_MAX_EMAILS_PER_SESSION`; real creates only); each call sends a fresh Graph `transactionId`, so a 429 retry can't book the meeting twice (#280)
- **Recipient allowlist scope** (`findBlockedRecipients` in `utils/safety.js`): send-email to/cc/bcc; draft create/update/forward/reply/reply-all and the draft's current to/cc/bcc on send; rule forwardTo/redirectTo; create-event attendees; the attendee list set by manage-event update. With an allowlist set, anything that isn't one plain address (exactly one `@`; no `;`, `,`, `<>`, quotes, brackets, whitespace or control/format characters) is blocked. Not covered: manage-event cancel/decline messages and organiser deletes, updates sent to attendees already on an event when other fields change, and `mailbox-settings` automatic replies
- **manage-event**: every action is `outward` (updates, declines, cancellations and organiser deletes notify attendees). `update` with `attendees` checks the whole new list against the recipient allowlist. `accept` is deliberately omitted — Microsoft Graph doesn't expose an `accept` verb in a way that works across personal/M365 reliably; use the Outlook UI to accept invitations.
- **Shared mailboxes**: off unless `OUTLOOK_SHARED_MAILBOX` is set (`read` = read-only shared access); addresses must be printable-ASCII emails (`utils/mailbox.js`); sending from a shared mailbox is never supported (`Mail.Send.Shared` not requested)
- **Path/ID hardening** (`utils/graph-api.js`): `.`/`..` segments in resource paths (incl. percent-encoded, `$batch`, relative delta tokens) are refused before any request; full URLs (deltaToken/nextLink) must be `https://graph.microsoft.com`, so the token never leaves Graph
- **File writes** (`attachments` download, `export` incl. conversations; all via `utils/safe-write.js`): caller paths must be absolute or start with `~`/`~/` (relative paths are refused); every output path is resolved (realpath of the parent; a last-component symlink is followed only to a directory, otherwise kept and refused) and must sit inside the system tmpdir (default), `~/Downloads`, `~/Documents` or `OUTLOOK_EXPORT_DIR`, with no dot-prefixed segment below them (`confineOutputPath`); server-chosen names are sanitised and written with exclusive create (no overwrite, no symlink following, `-1`, `-2`, … suffixes) inside that directory; an explicit single-message `export` `savePath` file is created exclusively and replaced only with `overwrite: true`, never if it is a symlink, hard-linked or has a dotted segment below its allowed directory (`writeExplicitFile`, temp file + rename keeping the original mode); files are created 0600 and server-created directories 0700 (explicit fchmod/chmod, umask-independent; `ensureOutputDir`); a write that fails part-way removes the partial file
- **Logs** (`utils/logger.js`, #278): stderr only. By default one line per tool call (tool, action, outcome, ms; never arguments); `OUTLOOK_DEBUG` adds detail. `redact()` masks addresses, long IDs and credentials at every level. New logging goes through `log.info` (PII-free lines only) or `log.debug`, not `console.*`
- **list-events**: invalid `startAfter`/`startBefore`/`subject` return `isError` before any Graph call
- **Plugin skill and hook** (#282, #283; client-side, plugin installs only): the `using-outlook-assistant` skill restates the hard rules; `outlook-gate.js` asks with a plain-English reason before outward, destructive or persistent calls (level: Claude Code `confirm_level` setting, elsewhere `OUTLOOK_CONFIRM_LEVEL`) and marks retrieved content as untrusted. It runs in Claude Code, Copilot CLI / VS Code and Cursor, and in Hermes Agent through the native `outlook-assistant-guard` plugin (#310: Hermes `approve` with a `rule_key` hashed from the whole call; `confirm_level` adds `block`). Plugin text must pass Hermes's install scanner (`test/plugin-hermes-scan.test.js`, #309): never quote "ignore … instructions"-style attack phrases. The clients differ in tool names, prompts and fail-open/closed: see [`docs/how-to/getting-started/supported-clients.md`](docs/how-to/getting-started/supported-clients.md), [`docs/cross-client-matrix.md`](docs/cross-client-matrix.md) and the maintenance rule
- 7 tools are `readOnlyHint: true`; 11 are `destructiveHint: true` (`send-email`, `draft`, `create-event`, `manage-event`, `manage-rules`, `mailbox-settings`, `folders`, `manage-contact`, `manage-category`, `manage-focused-inbox`, `export`), so annotation-aware clients confirm them

## Key Files

| File | Purpose |
|------|---------|
| `index.js` | Entry point: CLI flags, startup warnings, connects `createServer()` to the stdio transport |
| `tools.js` | Tool registry: every module's tools combined into `TOOLS` (tests import it) |
| `server.js` | `createServer()`: SDK `Server` with `tools: {listChanged: false}` and the dispatcher |
| `request-handler.js` | MCP request dispatcher: `tools/list` (adds `riskMeta` `_meta`) and `tools/call` (coerce → read-only gate → unsupported-`dryRun` gate → handler → one log line). Protocol errors are thrown as JSON-RPC errors (-32601 unknown method, -32602 unknown tool, -32603 internal); tool failures return visible `isError` content |
| `utils/risk-classes.js` | Risk-class map per tool/action and `DRY_RUN_ACTIONS`; derives every tool's annotations (`toolMetadata`), read-only mode and the plugin hook's `risk-map.json` |
| `plugins/outlook-assistant/` | Marketplace plugin: one manifest per client (`.claude-plugin/`, root `plugin.json` + `mcp.json`, `.cursor-plugin/`), the hook and the skill. Layout: [`docs/architecture.md`](docs/architecture.md); upkeep: [`.claude/rules/plugin-and-skill-maintenance.md`](.claude/rules/plugin-and-skill-maintenance.md) |
| `plugins/outlook-assistant/hooks/outlook-gate.js` | Plugin hook for Claude Code (`hooks/hooks.json`), Copilot CLI/VS Code (`com.github.copilot/hooks/hooks.json`, arg `copilot`) and Cursor (`hooks/hooks-cursor.json` via `.cursor-plugin/plugin.json`, arg `cursor`): before outward/destructive/persistent calls, `ask` with a plain-English reason (`describe()`; unknown tool or action asks), after untrusted-content tools a note; classifies with the generated `hooks/risk-map.json` |
| `plugins/outlook-assistant-guard/` | Hermes Agent native plugin (#310): `gate.py` runs the generated copy of `outlook-gate.js` with `hermes`; `system-prompt.md` generated from the hard rules; tests in `test/hermes/` (stdlib `unittest`) and `scripts/hermes-smoke.py` |
| `plugins/outlook-assistant/skills/using-outlook-assistant/` | Agent skill: SKILL.md hard rules + one `references/` file per surface; risk table (`sync-risk-map.js`) and `metadata.version` (`sync-version.js`) are generated |
| `scripts/sync-risk-map.js` | Copies `utils/risk-classes.js` into the hook's `risk-map.json` and the SKILL.md risk table, and writes the Hermes guard's copies (gate, risk map, `system-prompt.md`); `--check` reports drift |
| `scripts/skill-evals.js` | Prompt-injection evals: `claude -p` against test mode's mock mailbox, with skill + hook, hook only, or neither |
| `utils/server-instructions.js` | Server `instructions` text (hard rules first); read-only note follows `config.READ_ONLY`; names tools a session limit of 0 blocks (`blockedTools`) |
| `utils/read-only.js` | `OUTLOOK_READ_ONLY` gate: refusal for any non-`read` call (`auth` sign-in actions exempt) |
| `utils/logger.js` | Stderr logger: `log.info`/`log.debug`, per-call notes, `redact()`, `isDebugEnabled()` (`OUTLOOK_DEBUG`) |
| `utils/tool-error.js` | `toolError(message, { nextStep })` and `authRequiredError()`: every handler error returns `isError: true` |
| `config.js` | API endpoint, auth settings, defaults |
| `utils/schema-coerce.js` | MCP-boundary param coercion + validation (string→array/boolean/number, `additionalProperties: false`, required, enums) |
| `auth/client-config.js` | Runtime client ID: GUID validation, `~/.outlook-assistant-config.json` read/save, env → saved resolution (must not require `config.js`) |
| `auth/token-storage.js` | Token storage with auto-refresh at `~/.outlook-assistant-tokens.json` (includes `auth_method` field) |
| `auth/device-code.js` | Device code flow for headless/remote authentication |
| `auth/auth-errors.js` | AADSTS error → remediation hint table (shared by token-storage and the device-code path) |
| `auth/tools.js` | Auth tool handlers; persists device code state to `~/.outlook-assistant-pending-auth.json`; `about` diagnostics (granted scopes, shared-mailbox status) |
| `utils/graph-api.js` | All Graph API calls go through here (includes $batch); dot-segment and Graph-host guards; retries 429 (POST only for waits ≤ 10 s, ≤ 20 s total) and 503/504 (not POST) honouring `Retry-After`, per-attempt inactivity timeout, max 4 requests in flight |
| `utils/mailbox.js` | `buildMailboxPrefix` → `me` or `users/{mailbox}`; validates addresses and enforces the `OUTLOOK_SHARED_MAILBOX` opt-in |
| `folder/resolve.js` | Path-aware folder resolver (ID, well-known alias, `Parent/Child` path, bare name), mailbox-aware |
| `calendar/list.js` | `list-events` filter/order building (`startAfter`/`startBefore`/`subject`) |
| `calendar/preview.js` | `dryRun` previews for `create-event` and `manage-event` update/cancel/decline/delete (attendees, external count; update adds who is added/removed) |
| `email/mail-tips.js` | Pre-send recipient validation |
| `utils/safety.js` | Rate limiter, allowlist, dry-run previews (`dryRunResult`) |
| `utils/safe-write.js` | Shared file writer (attachments, export): output-path confinement to the allowed folders, exclusive create, `overwrite`-gated replace of an explicit `savePath`, 0600/0700 modes |
| `utils/field-presets.js` | Optimised field selections per operation |

## Configuration

**Environment** (set in the MCP client's `env` block; a `.env` file is read only by the auth server):
```
OUTLOOK_CLIENT_ID=your-client-id           # or save at runtime: auth action=authenticate clientId=<id>
OUTLOOK_CLIENT_SECRET=your-secret-VALUE    # Browser flow only; NOT the Secret ID!
USE_TEST_MODE=false
OUTLOOK_MAX_EMAILS_PER_SESSION=10          # Optional: default per-session cap for send-email, draft, manage-rules, create-event (per tool: OUTLOOK_MAX_<TOOL>_PER_SESSION). Unset = no limit; 0 or a non-whole number BLOCKS the tool (#302)
OUTLOOK_ALLOWED_RECIPIENTS=example.com     # Optional: restrict recipients and event attendees (scope: Safety Controls)
OUTLOOK_READ_ONLY=true                     # Optional: refuse every non-read tool call (true|1|yes|on; unrecognised = on)
OUTLOOK_IMMUTABLE_IDS=true                 # Optional: IDs persist through folder moves
OUTLOOK_AUTH_METHOD=device-code            # Optional: default auth method (device-code|browser)
OUTLOOK_AUTH_AUDIENCE=common               # Optional: common|consumers|organizations|<tenant-guid> (v3.8.0; fixes AADSTS9002331 for personal-only Azure apps)
OUTLOOK_DEFAULT_TIMEZONE=Australia/Melbourne  # Optional: overrides hardcoded default (v3.8.0)
OUTLOOK_SHARED_MAILBOX=read                # Optional, opt-in: read|true (work/school only; re-auth with force=true after enabling)
OUTLOOK_SEARCH_SCAN_LIMIT=500              # Optional: client-side search fallback window (max 5000)
OUTLOOK_REQUEST_TIMEOUT_MS=60000           # Optional: per-attempt Graph inactivity timeout (ms with no data; not an overall deadline)
OUTLOOK_DEBUG=true                         # Optional: detailed stderr logs (utils/logger.js; addresses/IDs redacted). Default: one line per tool call, no arguments
OUTLOOK_EXPORT_DIR=~/mail-archive          # Optional: extra folder export/attachment downloads may write to (besides tmpdir, ~/Downloads, ~/Documents)
OUTLOOK_CONFIRM_LEVEL=outward              # Plugin hook only, not read by the server: outward|all-writes|off (unknown = outward). Claude Code uses the confirm_level setting instead
```

> The server reads `OUTLOOK_CLIENT_ID`/`OUTLOOK_CLIENT_SECRET` from `config.js`.
> `MS_CLIENT_ID`/`MS_CLIENT_SECRET` are also accepted for backwards compatibility.
> The auth server imports scopes from `config.js` (single source of truth since v3.1.0).
> **Auth server env vars**: The auth server needs the same `OUTLOOK_CLIENT_ID`/`OUTLOOK_CLIENT_SECRET` — these are passed automatically when running via Claude Desktop/Code MCP config.

**Tokens stored at**: `~/.outlook-assistant-tokens.json`

**Defaults**:
- Timezone: `Australia/Melbourne`
- Page size: 25
- Max results: 100

## Adding New Tools

1. Create handler in module directory (e.g., `email/new-tool.js`); return errors with `toolError()` / `authRequiredError()` (`utils/tool-error.js`)
2. Export from module `index.js`
3. Add the module's tools to `TOOLS` in `tools.js`
4. Classify the tool and each action in `utils/risk-classes.js`, and spread `...toolMetadata(name, title)` into the definition (never hand-write hints); then run `node scripts/sync-risk-map.js`
5. Description ≤ 1,024 characters, stating facts and boundaries without steering between tools (`test/tools-registry.test.js` enforces both)
6. Add test in `test/[module]/`
7. Keep the plugin in step: see [`.claude/rules/plugin-and-skill-maintenance.md`](.claude/rules/plugin-and-skill-maintenance.md) (risk class, skill reference, hook map)

## Common Issues

Common errors (auth, device code, search, timezones) and fixes live in [`docs/troubleshooting.md`](docs/troubleshooting.md).

## Testing

```bash
npm test                    # Jest unit tests (103 suites / 2908 tests at v3.14.1)
npm run lint                # ESLint (0 errors expected)
npm run format:check        # Prettier (CI runs this)
node scripts/e2e-stdio.js <tool> '<argsJson>'  # Fresh stdio server: initialize + one tools/call
USE_TEST_MODE=true npm start # Mock data mode
node scripts/sync-risk-map.js  # After editing utils/risk-classes.js (--check to verify)
node scripts/skill-evals.js    # Prompt-injection evals (needs a signed-in claude CLI; spends tokens)
python3 -m unittest discover -s test/hermes  # Hermes guard plugin (stdlib only)
<venv>/bin/python scripts/hermes-smoke.py    # Both plugins in a throwaway Hermes home, server in test mode (needs Hermes ≥ 0.21.5 in that venv)
```

Mock data defined in `utils/mock-data.js` (includes three prompt-injection emails for the evals). Shared-mailbox suites switch the opt-in on via `test/helpers/shared-mailbox.js`.

## Graph API Notes

- OData filters use proper URI encoding via `utils/odata-helpers.js`
- Field presets in `utils/field-presets.js` optimise token usage
- Response verbosity: `minimal`, `standard`, `full` (controls output detail); a body at `full` is capped at 40,000 characters (`DEFAULT_LIMITS.maxFullBodyChars`), and the note points to `export` for the rest
- Delta sync uses `@odata.deltaLink` for incremental updates; `email/delta.js` remembers each continuation token's phase (initial/incremental; unknown after a restart)
- Batch API: `callGraphAPIBatch()` sends up to 20 requests via `$batch` endpoint
- Immutable IDs: opt-in via `OUTLOOK_IMMUTABLE_IDS=true` — IDs persist through folder moves

## Protected Files

`docs/faq/faq.md` is the upstream content source for the marketing-site help-centre `FAQPage` JSON-LD pipeline (`littlebearapps/littlebearapps.com` syncs from it). It **must not be deleted** — review and update at every release, never delete or truncate. See [`.claude/rules/faq-maintenance.md`](.claude/rules/faq-maintenance.md) for the update-trigger checklist (auth changes, new tools, safety controls, account-compatibility shifts, privacy/data-flow changes, install/update/uninstall procedure changes) and the quality bar (≥7 question-shaped H2s, complete answers, no placeholders).

The repo ships [`.claude/hooks/faq-protection.sh`](.claude/hooks/faq-protection.sh) which enforces this when wired into your local `.claude/settings.json`. The hook blocks `rm`/`mv`/`git rm`/`git mv` of the file or `docs/faq/` directory, and rejects `Write` operations that drop below the 7-question floor. To activate, add to your `.claude/settings.json` (this file is local-only by repo convention):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write",
        "hooks": [{ "type": "command", "command": ".claude/hooks/faq-protection.sh" }]
      }
    ]
  }
}
```

Use `Edit` (not `Write`) to revise individual Q&A pairs — the `Write` guard is a backstop, not the everyday path.

## See Also

- [`README.md`](README.md) - Full documentation, Azure setup, tool reference
- [`ROADMAP.md`](ROADMAP.md) - Active milestones and recent releases
- [`CHANGELOG.md`](CHANGELOG.md) - Release notes, including `[Unreleased]` work
- [`docs/architecture.md`](docs/architecture.md) - Module layout, file tree, tool-consolidation map, history
- [`docs/troubleshooting.md`](docs/troubleshooting.md) - Common issues and fixes
- [`docs/how-to/getting-started/supported-clients.md`](docs/how-to/getting-started/supported-clients.md) - What each client gets (plugin, skill, hook, server-side checks)
- [`docs/cross-client-matrix.md`](docs/cross-client-matrix.md) - Per-client verification results
- [`plugins/outlook-assistant/README.md`](plugins/outlook-assistant/README.md) - Plugin install, settings and hook behaviour
- [`docs/quickrefs/tools-reference.md`](docs/quickrefs/tools-reference.md) - Tools quick reference
- [`docs/faq/faq.md`](docs/faq/faq.md) - User-facing FAQ (feeds the help-centre `FAQPage` schema; see protection note above)
- `.env.example` - Environment template
