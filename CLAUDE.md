# CLAUDE.md - Outlook Assistant

MCP server for Microsoft Outlook via Graph API (v3.9.1). 22 tools across 9 modules.

## Commands

```bash
npm install              # Install dependencies (run first)
npm start                # Start MCP server
npm run auth-server      # Start OAuth server on :3333 (browser auth only)
npm test                 # Run Jest tests
npm run test-mode        # Start with mock data (USE_TEST_MODE=true)
npm run inspect          # MCP Inspector for interactive testing
npx kill-port 3333       # Kill auth server if port blocked
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

**Browser flow (alternative, for localhost only):**
Start the auth server with `npm run auth-server` — needs `OUTLOOK_CLIENT_ID`/`OUTLOOK_CLIENT_SECRET` as env vars. The MCP server itself reads credentials from `.mcp.json` inline `kc_get` calls. Full walkthrough: [`docs/how-to/getting-started/connect-outlook-to-claude.md`](docs/how-to/getting-started/connect-outlook-to-claude.md).

**Token refresh**: Tokens auto-refresh when expired (via `token-storage.js`). Re-authentication only needed when the refresh token expires (~90 days). Refresh re-requests only the **granted** scopes (persisted as `granted_scopes`), not the full configured set.

**Scope fallback**: Auth attempts the full scope set (`BASE_SCOPES` + `SHARED_SCOPES`, defined in `config.js`). Personal Microsoft accounts can't consent to the `.Shared` scopes, so `handleDeviceCodeComplete` (`auth/tools.js`) detects the rejection via `isScopeConsentError` (`auth/device-code.js`) and automatically re-issues a device code with `AUTH_CONFIG.fallbackScopes` (base only) — one extra code for personal accounts; work/school accounts consent on the first try (unless the tenant requires admin consent, AADSTS65001, which is surfaced with remediation instead of downgrading scopes). The `auth/oauth-server.js` Express module mirrors the fallback via a one-shot `/auth?fallback=1` redirect, but the standalone `npm run auth-server` (`outlook-auth-server.js`) does **not** auto-retry — personal accounts should use device-code auth. No `OUTLOOK_AUTH_AUDIENCE` change needed.

## Architecture

Module layout, file organisation, and the v1→v3 tool-consolidation map live in [`docs/architecture.md`](docs/architecture.md).

## Safety Controls

- **MCP annotations** on all 22 tools (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). `openWorldHint: true` on tools that surface external-sender content (`search-emails`, `read-email`, `search-people`, `access-shared-mailbox`, `attachments`, `export`) (#92)
- **get-mail-tips**: pre-send recipient validation (out-of-office, mailbox full, delivery restrictions)
- **send-email**: `dryRun` param, `checkRecipients` param (mail tips), session rate limiting (`OUTLOOK_MAX_EMAILS_PER_SESSION`), recipient allowlist (`OUTLOOK_ALLOWED_RECIPIENTS`)
- **draft**: `dryRun` on create, `checkRecipients` (mail tips), recipient allowlist, rate limiting. Send action shares limit with `send-email`.
- **manage-rules**: `dryRun` on create/update, rate limiting (`OUTLOOK_MAX_MANAGE_RULES_PER_SESSION`), recipient allowlist on forwardTo/redirectTo, no `permanentDelete` (too dangerous for AI). Supports 12 conditions, 9 actions, and exceptions.
- **manage-event**: marked `destructiveHint: true` (covers `decline`/`cancel`/`delete`; `update` action added v3.8.0 is non-destructive in isolation but inherits the tool-level annotation — use `dryRun: true` to preview update payloads). `accept` is deliberately omitted — Microsoft Graph doesn't expose an `accept` verb in a way that works across personal/M365 reliably; use the Outlook UI to accept invitations.
- 7 read-only tools auto-approved by Claude Code; 6 destructive tools (`manage-event`, `manage-contact`, `send-email`, `draft`, `folders`, `manage-rules`) prompt for confirmation

## Key Files

| File | Purpose |
|------|---------|
| `index.js` | Entry point: combines all tools into `TOOLS`, creates the MCP server, wires `request-handler.js`, connects the stdio transport |
| `request-handler.js` | MCP request dispatcher (extracted from `index.js` for testability): routes `initialize`/`tools/list`/`tools/call`, runs schema coercion, and returns tool errors as visible `isError` content (never empty output) |
| `config.js` | API endpoint, auth settings, defaults |
| `utils/schema-coerce.js` | MCP-boundary param coercion + validation (string→array/boolean/number, `additionalProperties: false`, required, enums) |
| `auth/token-storage.js` | Token storage with auto-refresh at `~/.outlook-assistant-tokens.json` (includes `auth_method` field) |
| `auth/device-code.js` | Device code flow for headless/remote authentication |
| `auth/tools.js` | Auth tool handlers; persists device code state to `~/.outlook-assistant-pending-auth.json` |
| `utils/graph-api.js` | All Graph API calls go through here (includes $batch) |
| `email/mail-tips.js` | Pre-send recipient validation |
| `utils/safety.js` | Rate limiter, allowlist, dry-run preview |
| `utils/field-presets.js` | Optimised field selections per operation |

## Configuration

**Environment (.env)**:
```
OUTLOOK_CLIENT_ID=your-client-id
OUTLOOK_CLIENT_SECRET=your-secret-VALUE    # NOT the Secret ID!
USE_TEST_MODE=false
OUTLOOK_MAX_EMAILS_PER_SESSION=10          # Optional: rate limit sends
OUTLOOK_ALLOWED_RECIPIENTS=example.com     # Optional: restrict recipients
OUTLOOK_IMMUTABLE_IDS=true                 # Optional: IDs persist through folder moves
OUTLOOK_AUTH_METHOD=device-code            # Optional: default auth method (device-code|browser)
OUTLOOK_AUTH_AUDIENCE=common               # Optional: common|consumers|organizations|<tenant-guid> (v3.8.0; fixes AADSTS9002331 for personal-only Azure apps)
OUTLOOK_DEFAULT_TIMEZONE=Australia/Melbourne  # Optional: overrides hardcoded default (v3.8.0)
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

1. Create handler in module directory (e.g., `email/new-tool.js`)
2. Export from module `index.js`
3. Add to `TOOLS` array in main `index.js`
4. Include `annotations` object on tool definition
5. Add test in `test/[module]/`

## Common Issues

Common errors (auth, device code, search, timezones) and fixes live in [`docs/troubleshooting.md`](docs/troubleshooting.md).

## Testing

```bash
npm test                    # Jest unit tests
./test-modular-server.sh    # MCP Inspector interactive
./test-direct.sh            # Direct testing
USE_TEST_MODE=true npm start # Mock data mode
```

Mock data defined in `utils/mock-data.js`.

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
- [`ROADMAP.md`](ROADMAP.md) - Active milestones (v3.7.5, v3.8.x, v3.10.0+) and recent releases
- [`docs/architecture.md`](docs/architecture.md) - Module layout, file tree, tool-consolidation map, history
- [`docs/troubleshooting.md`](docs/troubleshooting.md) - Common issues and fixes
- [`docs/quickrefs/tools-reference.md`](docs/quickrefs/tools-reference.md) - Tools quick reference
- [`docs/faq/faq.md`](docs/faq/faq.md) - User-facing FAQ (feeds the help-centre `FAQPage` schema; see protection note above)
- `.env.example` - Environment template
