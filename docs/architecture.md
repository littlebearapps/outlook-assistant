# Architecture

This document describes the module layout, file organisation, and historical tool-consolidation map for Outlook Assistant. For day-to-day development guidance, see [`CLAUDE.md`](../CLAUDE.md). For the user-facing tools reference, see [`docs/quickrefs/tools-reference.md`](quickrefs/tools-reference.md).

## Module Layout

```
index.js              # Main entry - combines all module tools, CLI flags (--version/--help)
request-handler.js    # MCP dispatcher: initialize / tools/list / tools/call, schema coercion, isError output
config.js             # Centralised config (API endpoint, scopes, OUTLOOK_SHARED_MAILBOX mode, defaults, timezone)
outlook-auth-server.js # OAuth server for the browser flow (port 3333)

auth/                 # 1 tool: auth (action: status|authenticate|device-code-complete|about)
  ├── token-manager.js    # Legacy token cache (deprecated)
  ├── token-storage.js    # Token storage with auto-refresh (granted scopes + offline_access)
  ├── device-code.js      # Device code flow (headless/remote auth), .Shared scope fallback detection
  ├── auth-errors.js      # AADSTS error → remediation hint table
  └── tools.js            # Tool definitions

email/                # 8 tools: search-emails, read-email, send-email, draft, update-email, attachments, export, get-mail-tips
  ├── draft.js            # Draft create/update/send/delete/reply/forward
  ├── mail-tips.js        # Pre-send recipient validation (out-of-office, mailbox full, etc.)
  ├── folder-utils.js     # Folder name → ID resolution (delegates to folder/resolve.js)
  ├── attachments.js      # List, download, view attachments
  ├── export.js           # Message, batch, conversation and MIME export (writes confined to outputDir)
  ├── delta.js            # Delta sync
  ├── headers.js          # Email header retrieval
  ├── mime.js             # Raw MIME/EML content
  └── conversations.js    # Thread listing, retrieval, export

calendar/             # 3 tools: list-events, create-event, manage-event
  ├── attendees.js        # Shared attendee builder: email strings or {email, type}; update keeps existing types
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
  ├── safety.js           # Rate limiting, recipient allowlist, dry-run preview
  ├── safe-write.js       # Exclusive, outputDir-confined file writes with -1, -2, … collision suffixes
  ├── field-presets.js    # Field selections for token efficiency
  ├── response-formatter.js # Verbosity levels (minimal/standard/full)
  └── mock-data.js        # Test-mode data
```

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

- **v3.12.0**: Opt-in shared-mailbox scoping (`sharedMailbox`, `OUTLOOK_SHARED_MAILBOX`) threaded through readers, organise actions and folder resolution via `utils/mailbox.js`; `list-events` filters.
- **v3.9.0**: Nested folder addressing via `folder/resolve.js`.
- **v3.3.0**: Renamed from `outlook-mcp` / `@littlebearapps/outlook-mcp` to `outlook-assistant` / `@littlebearapps/outlook-assistant`. Old npm package deprecated with redirect. Token files auto-migrate from `.outlook-mcp-tokens.json`.
