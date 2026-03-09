# CLAUDE.md - Outlook Assistant

MCP server for Microsoft Outlook via Graph API (v3.3.0). 20 consolidated tools across 9 modules.

## Commands

```bash
npm install              # Install dependencies (run first)
npm start                # Start MCP server
npm run auth-server      # Start OAuth server on :3333 (required for auth)
npm test                 # Run Jest tests
npm run test-mode        # Start with mock data (USE_TEST_MODE=true)
npm run inspect          # MCP Inspector for interactive testing
npx kill-port 3333       # Kill auth server if port blocked
```

## Architecture

```
index.js              # Main entry - combines all module tools, serves annotations
config.js             # Centralized config (API endpoint, defaults, timezone)
outlook-auth-server.js # OAuth server (port 3333)

auth/                 # 1 tool: auth (action: status|authenticate|about)
  ├── token-manager.js    # Token load/save/refresh
  └── tools.js            # Tool definitions

email/                # 6 tools: search-emails, read-email, send-email, update-email, attachments, export
  ├── folder-utils.js     # Folder name → ID resolution
  ├── attachments.js      # List, download, view attachments
  ├── headers.js          # Email header retrieval
  ├── mime.js             # Raw MIME/EML content
  └── conversations.js    # Thread listing, retrieval, export

calendar/             # 3 tools: list-events, create-event, manage-event
folder/               # 1 tool: folders (action: list|create|move|stats)
rules/                # 1 tool: manage-rules (action: list|create|reorder)
contacts/             # 2 tools: manage-contact (full CRUD), search-people
categories/           # 3 tools: manage-category, apply-category, manage-focused-inbox
settings/             # 1 tool: mailbox-settings (action: get|set-auto-replies|set-working-hours)
advanced/             # 2 tools: access-shared-mailbox, find-meeting-rooms

utils/
  ├── graph-api.js        # Graph API client with OData encoding
  ├── safety.js           # Rate limiting, recipient allowlist, dry-run preview
  ├── field-presets.js    # Field selections for token efficiency
  └── response-formatter.js # Verbosity levels (minimal/standard/full)
```

## Safety Controls

- **MCP annotations** on all 20 tools (`readOnlyHint`, `destructiveHint`, `idempotentHint`)
- **send-email**: `dryRun` param, session rate limiting (`OUTLOOK_MAX_EMAILS_PER_SESSION`), recipient allowlist (`OUTLOOK_ALLOWED_RECIPIENTS`)
- **manage-event**: marked `destructiveHint: true` (decline/cancel/delete)
- 6 read-only tools auto-approved by Claude Code; 2 destructive tools prompt for confirmation

## Key Files

| File | Purpose |
|------|---------|
| `index.js` | MCP protocol handler, combines all tools |
| `config.js` | API endpoint, auth settings, defaults |
| `auth/token-manager.js` | Token storage at `~/.outlook-assistant-tokens.json` |
| `utils/graph-api.js` | All Graph API calls go through here |
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

## Authentication Flow

1. Start auth server: `npm run auth-server`
2. Call `auth` tool with `action=authenticate` → get URL
3. Open URL in browser → Microsoft login
4. Grant permissions → tokens saved automatically
5. Tokens auto-refresh on expiration

## Adding New Tools

1. Create handler in module directory (e.g., `email/new-tool.js`)
2. Export from module `index.js`
3. Add to `TOOLS` array in main `index.js`
4. Include `annotations` object on tool definition
5. Add test in `test/[module]/`

## Common Issues

| Issue | Solution |
|-------|----------|
| `AADSTS7000215` (invalid secret) | Use secret **VALUE**, not Secret ID from Azure |
| `EADDRINUSE :3333` | `npx kill-port 3333` then restart auth server |
| Module not found | Run `npm install` |
| Auth URL doesn't work | Start auth server first: `npm run auth-server` |
| Empty API response | Check auth status with `auth` tool (action=status) |
| `search-emails` returns no results | On personal accounts, `query`/`kqlQuery` may not work. Use `subject`, `from`, `to`, `receivedAfter` filters instead |
| `create-event` wrong timezone | Omit the `Z` suffix on times for local timezone. `Z` suffix = UTC, which may be hours off |
| Auth server "missing client ID" | Ensure `OUTLOOK_CLIENT_ID`/`OUTLOOK_CLIENT_SECRET` are set as env vars for the auth server process |

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

## Tool Consolidation Map

| Old Tools | New Tool | Pattern |
|-----------|----------|---------|
| list-emails, search-emails, list-conversations, search-by-message-id, list-emails-delta | `search-emails` | No query = list mode |
| read-email, get-email-headers | `read-email` | `headersMode` param |
| mark-as-read, set-message-flag, clear-message-flag | `update-email` | `action` param |
| list-attachments, download-attachment, get-attachment-content | `attachments` | `action` param |
| export-email, batch-export-emails, export-conversation, get-mime-content | `export` | `target` param |
| decline-event, cancel-event, delete-event | `manage-event` | `action` param |
| list/search/get/create/update/delete-contact | `manage-contact` | `action` param |
| list/create/update/delete-category | `manage-category` | `action` param |
| get/set-focused-inbox-overrides | `manage-focused-inbox` | `action` param |
| get-mailbox-settings, get/set-automatic-replies, get/set-working-hours | `mailbox-settings` | `action` param |
| list/create-folder, move-emails, get-folder-stats | `folders` | `action` param |
| list/create-rule, edit-rule-sequence | `manage-rules` | `action` param |
| about, authenticate, check-auth-status | `auth` | `action` param |

## Promotion & Directory Listings

The project has been submitted to major MCP directories (2026-03-05). Tracker with PR/issue links, manual submission drafts, and Reddit post drafts:

→ `docs/promotion/directory-submissions.md`

**Submitted (automated):** punkpeye, appcypher, TensorBlock, YuzeHao2023 awesome-mcp-servers (PRs); Cline MCP Marketplace, mcp.so (issues)
**Manual required:** PulseMCP, Smithery.ai, Glama.ai (web forms — drafts in tracker)

## See Also

- `README.md` - Full documentation, Azure setup, tool reference
- `docs/quickrefs/tools-reference.md` - Tools quick reference
- `docs/promotion/directory-submissions.md` - Directory submission tracker
- `.env.example` - Environment template

## History

- **v3.3.0**: Renamed from `outlook-mcp` / `@littlebearapps/outlook-mcp` to `outlook-assistant` / `@littlebearapps/outlook-assistant`. Old npm package deprecated with redirect. Token files auto-migrate from `.outlook-mcp-tokens.json`.

# currentDate
Today's date is 2026-02-27.

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
