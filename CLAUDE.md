# CLAUDE.md - Outlook Assistant

MCP server for Microsoft Outlook via Graph API (v3.13.0). 22 tools across 9 modules. Runtime Node ≥ 18.18; dev tooling (lint-staged hook, `npm run inspect`) needs Node ≥ 22.22.1.

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
- **get-mail-tips**: pre-send recipient validation (out-of-office, mailbox full, delivery restrictions)
- **send-email**: `dryRun` param, `checkRecipients` param (mail tips), session rate limiting (`OUTLOOK_MAX_EMAILS_PER_SESSION`), recipient allowlist (`OUTLOOK_ALLOWED_RECIPIENTS`)
- **draft**: `dryRun` on create, `checkRecipients` (mail tips), recipient allowlist, rate limiting. Send action shares limit with `send-email`. `update`/`send`/`delete` look the ID up first and refuse anything that isn't an unsent draft (`assertIsDraft` in `email/draft.js`).
- **manage-rules**: `dryRun` on create/update, rate limiting (`OUTLOOK_MAX_MANAGE_RULES_PER_SESSION`), recipient allowlist on forwardTo/redirectTo, no `permanentDelete` (too dangerous for AI). Supports 12 conditions, 9 actions, and exceptions.
- **manage-event**: every action is `outward` (updates, declines, cancellations and organiser deletes notify attendees) — use `dryRun: true` to preview update payloads. `accept` is deliberately omitted — Microsoft Graph doesn't expose an `accept` verb in a way that works across personal/M365 reliably; use the Outlook UI to accept invitations.
- **Shared mailboxes**: off unless `OUTLOOK_SHARED_MAILBOX` is set (`read` = read-only shared access); addresses must be printable-ASCII emails (`utils/mailbox.js`); sending from a shared mailbox is never supported (`Mail.Send.Shared` not requested)
- **Path/ID hardening** (`utils/graph-api.js`): `.`/`..` segments in resource paths (incl. percent-encoded, `$batch`, relative delta tokens) are refused before any request; full URLs (deltaToken/nextLink) must be `https://graph.microsoft.com`, so the token never leaves Graph
- **File writes** (`attachments` download, `export` incl. conversations; all via `utils/safe-write.js`): server-chosen names are sanitised, written with exclusive create (no overwrite, no symlink following, `-1`, `-2`, … suffixes) and confined to `outputDir` (default system tmpdir); a write that fails part-way removes the partial file; only an explicit single-message `export` file path is written as given
- **list-events**: invalid `startAfter`/`startBefore`/`subject` return `isError` before any Graph call
- 7 read-only tools auto-approved by Claude Code; 10 destructive tools (`send-email`, `draft`, `create-event`, `manage-event`, `manage-rules`, `mailbox-settings`, `folders`, `manage-contact`, `manage-category`, `manage-focused-inbox`) prompt for confirmation

## Key Files

| File | Purpose |
|------|---------|
| `index.js` | Entry point: CLI flags, startup warnings, connects `createServer()` to the stdio transport |
| `tools.js` | Tool registry: every module's tools combined into `TOOLS` (tests import it) |
| `server.js` | `createServer()`: SDK `Server` with `tools: {listChanged: false}` and the dispatcher |
| `request-handler.js` | MCP request dispatcher: `tools/list`/`tools/call` with schema coercion. Protocol errors are thrown as JSON-RPC errors (-32601 unknown method, -32602 unknown tool, -32603 internal); tool failures return visible `isError` content |
| `utils/risk-classes.js` | Risk-class map per tool/action; derives every tool's annotations (`toolMetadata`) |
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
| `email/mail-tips.js` | Pre-send recipient validation |
| `utils/safety.js` | Rate limiter, allowlist, dry-run preview |
| `utils/safe-write.js` | Shared exclusive-create, `outputDir`-confined file writer (attachments, export) |
| `utils/field-presets.js` | Optimised field selections per operation |

## Configuration

**Environment** (set in the MCP client's `env` block; a `.env` file is read only by the auth server):
```
OUTLOOK_CLIENT_ID=your-client-id           # or save at runtime: auth action=authenticate clientId=<id>
OUTLOOK_CLIENT_SECRET=your-secret-VALUE    # Browser flow only; NOT the Secret ID!
USE_TEST_MODE=false
OUTLOOK_MAX_EMAILS_PER_SESSION=10          # Optional: default per-session cap for send-email, draft, manage-rules (per tool: OUTLOOK_MAX_<TOOL>_PER_SESSION)
OUTLOOK_ALLOWED_RECIPIENTS=example.com     # Optional: restrict recipients
OUTLOOK_IMMUTABLE_IDS=true                 # Optional: IDs persist through folder moves
OUTLOOK_AUTH_METHOD=device-code            # Optional: default auth method (device-code|browser)
OUTLOOK_AUTH_AUDIENCE=common               # Optional: common|consumers|organizations|<tenant-guid> (v3.8.0; fixes AADSTS9002331 for personal-only Azure apps)
OUTLOOK_DEFAULT_TIMEZONE=Australia/Melbourne  # Optional: overrides hardcoded default (v3.8.0)
OUTLOOK_SHARED_MAILBOX=read                # Optional, opt-in: read|true (work/school only; re-auth with force=true after enabling)
OUTLOOK_SEARCH_SCAN_LIMIT=500              # Optional: client-side search fallback window (max 5000)
OUTLOOK_REQUEST_TIMEOUT_MS=60000           # Optional: per-attempt Graph inactivity timeout (ms with no data; not an overall deadline)
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
4. Classify the tool and each action in `utils/risk-classes.js`, and spread `...toolMetadata(name, title)` into the definition (never hand-write hints)
5. Add test in `test/[module]/`
6. Keep the plugin in step: see [`.claude/rules/plugin-and-skill-maintenance.md`](.claude/rules/plugin-and-skill-maintenance.md) (risk class, skill reference, hook map)

## Common Issues

Common errors (auth, device code, search, timezones) and fixes live in [`docs/troubleshooting.md`](docs/troubleshooting.md).

## Testing

```bash
npm test                    # Jest unit tests (71 suites / 1866 tests with the unreleased v3.14.0 work)
npm run lint                # ESLint (0 errors expected)
npm run format:check        # Prettier (CI runs this)
node scripts/e2e-stdio.js <tool> '<argsJson>'  # Fresh stdio server: initialize + one tools/call
USE_TEST_MODE=true npm start # Mock data mode
```

Mock data defined in `utils/mock-data.js`. Shared-mailbox suites switch the opt-in on via `test/helpers/shared-mailbox.js`.

## Graph API Notes

- OData filters use proper URI encoding via `utils/odata-helpers.js`
- Field presets in `utils/field-presets.js` optimise token usage
- Response verbosity: `minimal`, `standard`, `full` (controls output detail)
- Delta sync uses `@odata.deltaLink` for incremental updates
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
- [`ROADMAP.md`](ROADMAP.md) - Active milestones (v3.14.0 safety skill/hooks/MCP hardening, v3.15.0 structured outputs/paging, v4.0.0 MCP 2026-07-28, patch fix queue, v3.8.x carry-over, v3.16.0+) and recent releases
- [`docs/architecture.md`](docs/architecture.md) - Module layout, file tree, tool-consolidation map, history
- [`docs/troubleshooting.md`](docs/troubleshooting.md) - Common issues and fixes
- [`docs/quickrefs/tools-reference.md`](docs/quickrefs/tools-reference.md) - Tools quick reference
- [`docs/faq/faq.md`](docs/faq/faq.md) - User-facing FAQ (feeds the help-centre `FAQPage` schema; see protection note above)
- `.env.example` - Environment template
