# Architecture

This document describes the module layout, file organisation, and historical tool-consolidation map for Outlook Assistant. For day-to-day development guidance, see [`CLAUDE.md`](../CLAUDE.md). For the user-facing tools reference, see [`docs/quickrefs/tools-reference.md`](quickrefs/tools-reference.md).

## Module Layout

```
index.js              # Main entry - CLI flags (--version/--help), startup warnings, stdio transport
tools.js              # Tool registry: combines all module tools into TOOLS
server.js             # createServer(): SDK Server, tools capability, dispatcher
request-handler.js    # MCP dispatcher: tools/list / tools/call (flow below); JSON-RPC errors vs isError results
config.js             # Centralised config (API endpoint, scopes, OUTLOOK_SHARED_MAILBOX mode, OUTLOOK_READ_ONLY, defaults, timezone)
outlook-auth-server.js # OAuth server for the browser flow (port 3333)

auth/                 # 1 tool: auth (action: status|authenticate|device-code-complete|about)
  ├── token-manager.js    # Legacy token cache (deprecated)
  ├── token-storage.js    # Token storage with auto-refresh (granted scopes + offline_access)
  ├── device-code.js      # Device code flow (headless/remote auth), .Shared scope fallback detection
  ├── auth-errors.js      # AADSTS error → remediation hint table
  ├── client-config.js    # Runtime client ID saved to ~/.outlook-assistant-config.json; env → saved resolution
  └── tools.js            # Tool definitions

email/                # 8 tools: search-emails, read-email, send-email, draft, update-email, attachments, export, get-mail-tips
  ├── draft.js            # Draft create/update/send/delete/reply/forward; recipient allowlist on each (send re-checks the draft's current to/cc/bcc)
  ├── mail-tips.js        # Pre-send recipient validation (out-of-office, mailbox full, etc.)
  ├── folder-utils.js     # Folder name → ID resolution (delegates to folder/resolve.js)
  ├── attachments.js      # List, download, view attachments
  ├── export.js           # Message, batch, conversation and MIME export (writes confined to allowed folders; savePath replaced only with overwrite)
  ├── delta.js            # Delta sync (remembers whether each continuation token belongs to an initial or incremental sync)
  ├── headers.js          # Email header retrieval
  ├── mime.js             # Raw MIME/EML content
  └── conversations.js    # Thread listing, retrieval, export

calendar/             # 3 tools: list-events, create-event, manage-event
  ├── attendees.js        # Shared attendee builder: email strings or {email, type}; update keeps existing types; attendee allowlist check
  ├── preview.js          # dryRun previews for create-event and manage-event update/cancel/decline/delete: who would be emailed, external count
  └── list.js             # list-events: startAfter/startBefore/subject filters, UTC + local times
folder/               # 1 tool: folders (action: list|create|move|stats|delete)
  └── resolve.js          # Path-aware, mailbox-aware folder resolver (ID, alias, Parent/Child path, name)
rules/                # 1 tool: manage-rules (action: list|create|update|reorder|delete)
  ├── rule-builder.js     # Shared condition/action/exception builders
  ├── create.js           # Rule creation with all Graph API conditions/actions
  ├── update.js           # Rule modification (rename, conditions, actions, exceptions)
  └── list.js             # Rule listing with full condition/action/exception display
contacts/             # 2 tools: manage-contact (full CRUD), search-people
categories/           # 3 tools: manage-category, apply-category, manage-focused-inbox
settings/             # 1 tool: mailbox-settings (action: get|set-auto-replies|set-working-hours)
advanced/             # 2 tools: access-shared-mailbox (messages, listFolders, folderId), find-meeting-rooms

utils/
  ├── graph-api.js        # Graph API client with OData encoding, $batch, immutable IDs, dot-segment and Graph-host guards, throttling retries, timeout, concurrency gate
  ├── mailbox.js          # `me` vs `users/{mailbox}` prefix; shared-mailbox opt-in and address validation
  ├── schema-coerce.js    # MCP-boundary param coercion and validation
  ├── odata-helpers.js    # OData filter building and escaping
  ├── datetime.js         # ISO 8601 parsing, Graph dateTimeTimeZone envelopes, IANA-zone conversion (no server-local time)
  ├── risk-classes.js     # Risk class per tool/action (read/reversible/outward/destructive/persistent); derives annotations, defaultAction, requiresUserInteraction _meta
  ├── read-only.js        # OUTLOOK_READ_ONLY gate: refuses any call not classed read (auth sign-in exempt)
  ├── server-instructions.js # initialize `instructions`: hard rules first, read-only note, blocked-tool note
  ├── logger.js           # Stderr logger: one line per tool call, OUTLOOK_DEBUG detail, redact()
  ├── tool-error.js       # toolError()/authRequiredError(): every handler error returns isError
  ├── safety.js           # Session limits (resolveSessionLimit), recipient allowlist, dry-run previews (dryRunResult)
  ├── safe-write.js       # Output-path confinement (absolute or ~ paths inside temp, ~/Downloads, ~/Documents, OUTLOOK_EXPORT_DIR) and exclusive file writes with -1, -2, … suffixes; savePath replaced only with overwrite; files 0600, new folders 0700
  ├── field-presets.js    # Field selections for token efficiency
  ├── response-formatter.js # Verbosity levels (minimal/standard/full)
  └── mock-data.js        # Test-mode data (includes three prompt-injection emails for the evals)

scripts/
  ├── sync-version.js     # Copies the package version into server.json, the plugin manifests and SKILL.md (npm version hook; --check)
  ├── sync-risk-map.js    # Copies utils/risk-classes.js into the hook's risk-map.json and the skill's risk table (--check)
  ├── skill-evals.js      # Prompt-injection evals: claude -p against the mock mailbox, with/without skill and hook
  └── e2e-stdio.js        # Fresh stdio server: initialize + one tools/call
```

## Plugin Layout

The marketplace plugin ships the server pinned to an exact npm version, plus an agent skill and a safety hook. Each client reads its own manifest; all of them share `mcp.json`, `skills/` and `hooks/outlook-gate.js`.

```
.claude-plugin/marketplace.json   # Self-hosted Claude Code marketplace (repo root)

plugins/outlook-assistant/
  ├── .claude-plugin/plugin.json  # Claude Code: userConfig settings + inline mcpServers (${user_config.*})
  ├── plugin.json                 # Agent Plugins 1.0 manifest (GitHub Copilot CLI, VS Code); closed schema
  ├── mcp.json                    # Plain MCP launcher (pinned npx); Copilot, VS Code and Cursor read it
  ├── .cursor-plugin/plugin.json  # Cursor (v3.14.0): no mcpServers, so Cursor uses mcp.json; points at hooks/hooks-cursor.json
  ├── com.github.copilot/hooks/hooks.json  # Copilot CLI / VS Code: PreToolUse + PostToolUse, runs the gate with `copilot`
  ├── hooks/
  │   ├── hooks.json              # Claude Code: PreToolUse + PostToolUse on the plugin's MCP tools
  │   ├── hooks-cursor.json       # Cursor: beforeMCPExecution (failClosed) + postToolUse, runs the gate with `cursor`
  │   ├── outlook-gate.js         # The hook: asks before outward/destructive/persistent calls, untrusted-content note
  │   └── risk-map.json           # Generated from utils/risk-classes.js (scripts/sync-risk-map.js)
  └── skills/using-outlook-assistant/
      ├── SKILL.md                # Hard rules first; generated risk table and metadata.version
      └── references/             # One file per surface (sending, calendar, rules and settings, search, ...)
```

## Risk Classes

`utils/risk-classes.js` gives every tool, and every action of an action-based tool, one class: `read`, `reversible`, `outward`, `destructive` or `persistent`. It also records `defaultAction`, `untrustedContent`, `requiresUserInteraction` and `DRY_RUN_ACTIONS`. Everything below derives from it, so a new tool or action is classified once:

- **Annotations**: `toolMetadata()` sets the `title` and all four hints (`test/utils/risk-classes.test.js` fails on anything unclassified).
- **`_meta`**: `riskMeta()` adds `anthropic/requiresUserInteraction` in `tools/list` (`send-email`, `create-event`).
- **Read-only mode**: `utils/read-only.js` refuses every call not classed `read`.
- **Plugin**: `scripts/sync-risk-map.js` writes the hook's `hooks/risk-map.json` and the skill's risk table (`test/plugin-hooks.test.js` fails while either is stale).

## Request Flow

`server.js` creates the SDK `Server` with `instructions` from `utils/server-instructions.js`; the SDK answers `initialize` and `ping` itself. Everything else goes to `request-handler.js`:

- **`tools/list`**: each tool's public fields, plus `_meta` from `riskMeta()` (`anthropic/requiresUserInteraction` on `send-email` and `create-event`).
- **`tools/call`**: look up the tool (unknown → JSON-RPC -32602) → coerce and validate arguments against `inputSchema` (`utils/schema-coerce.js`; failure → `isError`) → read-only gate when `OUTLOOK_READ_ONLY` is on (`utils/read-only.js`; refusal → `isError`, handler never runs) → `dryRun: true` gate (refused unless `supportsDryRun`, `utils/risk-classes.js` `DRY_RUN_ACTIONS`; supported previews get `_meta.dryRun`) → handler → one stderr line (`tool`, `action` if in the enum, `outcome` = ok/isError/thrown/unknown-tool, `ms`, plus notes such as a Graph status). A throwing handler becomes an `isError` result.

## Tool Consolidation Map (v1 → v3)

The server consolidated 55 original tools into 22 action-based tools to save ~11,000 tokens per turn (~64% reduction). This table maps legacy tool names to their current equivalents and the `action` parameter that replaces them.

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
| list/create-folder, move-emails, get-folder-stats | `folders` | `action` param (`list`, `create`, `move`, `stats`, `delete`) |
| list/create/update-rule, edit-rule-sequence, delete-rule | `manage-rules` | `action` param (`list`, `create`, `update`, `reorder`, `delete`) |
| about, authenticate, check-auth-status | `auth` | `action` param (`status`, `authenticate`, `device-code-complete`, `about`) |
| *(new)* create-draft, update-draft, send-draft, delete-draft, create-reply-draft, create-forward-draft | `draft` | `action` param |

## History

- **v3.14.1**: session limits resolved in `utils/safety.js` (`resolveSessionLimit`: unset = no limit, `0` or a non-whole number blocks; `describeSessionLimits` and `blockedTools` feed `auth action=about`, the startup log and the server `instructions`); `calendar/preview.js` `describeUpdateRecipients` for `manage-event` update dry runs; `email/delta.js` tracks continuation-token phases; rule predicates use Graph's `hasAttachments`.
- **v3.14.0**: `utils/risk-classes.js` drives every tool's annotations and top-level `title`; the tool list moves to `tools.js` and server construction to `server.js`; protocol errors are real JSON-RPC errors; handler errors go through `utils/tool-error.js`. Then server `instructions` (`utils/server-instructions.js`), the `OUTLOOK_READ_ONLY` gate (`utils/read-only.js`), the stderr logger (`utils/logger.js`) and calendar `dryRun` previews (`calendar/preview.js`), with `dryRun` refused on calls that can't preview. The recipient allowlist extends to draft reply/reply-all/send and calendar attendees and accepts only single plain addresses; exports and downloads are confined to allowed folders, and `export` replaces an existing file only with `overwrite: true`. The plugin gains the `using-outlook-assistant` skill, the `outlook-gate.js` hook for Claude Code, Copilot and Cursor (with `risk-map.json` generated by `scripts/sync-risk-map.js`) and a `.cursor-plugin` manifest; `scripts/skill-evals.js` runs prompt-injection evals.
- **v3.13.0**: `plugins/outlook-assistant/` plugin bundle (Claude Code manifest + Agent Plugins 1.0 `plugin.json`/`mcp.json`), kept in version step by `scripts/sync-version.js`; `auth/client-config.js` resolves the client ID (env → saved `~/.outlook-assistant-config.json`) lazily for config, token storage and the auth tool.
- **v3.12.1**: `utils/graph-api.js` gains throttling retries, a per-attempt inactivity timeout and a 4-request concurrency gate; file writes consolidated in `utils/safe-write.js`; shared attendee builder `calendar/attendees.js`; `manage-rules` folder targets resolved via `folder/resolve.js`; unused `calendar/accept.js` removed.
- **v3.12.0**: Opt-in shared-mailbox scoping (`sharedMailbox`, `OUTLOOK_SHARED_MAILBOX`) threaded through readers, organise actions and folder resolution via `utils/mailbox.js`; `list-events` filters.
- **v3.9.0**: Nested folder addressing via `folder/resolve.js`.
- **v3.3.0**: Renamed from `outlook-mcp` / `@littlebearapps/outlook-mcp` to `outlook-assistant` / `@littlebearapps/outlook-assistant`. Old npm package deprecated with redirect. Token files auto-migrate from `.outlook-mcp-tokens.json`.
