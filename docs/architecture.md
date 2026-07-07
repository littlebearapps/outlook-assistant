# Architecture

This document describes the module layout, file organisation, and historical tool-consolidation map for Outlook Assistant. For day-to-day development guidance, see [`CLAUDE.md`](../CLAUDE.md). For the user-facing tools reference, see [`docs/quickrefs/tools-reference.md`](quickrefs/tools-reference.md).

## Module Layout

```
index.js              # Main entry - combines all module tools, serves annotations
config.js             # Centralized config (API endpoint, defaults, timezone)
outlook-auth-server.js # OAuth server (port 3333)

auth/                 # 1 tool: auth (action: status|authenticate|device-code-complete|about)
  ├── token-manager.js    # Legacy token cache (deprecated)
  ├── token-storage.js    # Token storage with auto-refresh
  ├── device-code.js      # Device code flow (headless/remote auth)
  └── tools.js            # Tool definitions

email/                # 8 tools: search-emails, read-email, send-email, draft, update-email, attachments, export, get-mail-tips
  ├── draft.js            # Draft create/update/send/delete/reply/forward
  ├── mail-tips.js        # Pre-send recipient validation (out-of-office, mailbox full, etc.)
  ├── folder-utils.js     # Folder name → ID resolution
  ├── attachments.js      # List, download, view attachments
  ├── headers.js          # Email header retrieval
  ├── mime.js             # Raw MIME/EML content
  └── conversations.js    # Thread listing, retrieval, export

calendar/             # 3 tools: list-events, create-event, manage-event
folder/               # 1 tool: folders (action: list|create|move|stats)
rules/                # 1 tool: manage-rules (action: list|create|update|reorder|delete)
  ├── rule-builder.js     # Shared condition/action/exception builders
  ├── create.js           # Rule creation with all Graph API conditions/actions
  ├── update.js           # Rule modification (rename, conditions, actions, exceptions)
  └── list.js             # Rule listing with full condition/action/exception display
contacts/             # 2 tools: manage-contact (full CRUD), search-people
categories/           # 3 tools: manage-category, apply-category, manage-focused-inbox
settings/             # 1 tool: mailbox-settings (action: get|set-auto-replies|set-working-hours)
advanced/             # 3 tools: access-shared-mailbox, find-meeting-rooms, find-meeting-times

utils/
  ├── graph-api.js        # Graph API client with OData encoding, $batch, immutable IDs
  ├── safety.js           # Rate limiting, recipient allowlist, dry-run preview
  ├── field-presets.js    # Field selections for token efficiency
  └── response-formatter.js # Verbosity levels (minimal/standard/full)
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
| list/create-folder, move-emails, get-folder-stats | `folders` | `action` param |
| list/create/update-rule, edit-rule-sequence, delete-rule | `manage-rules` | `action` param (`list`, `create`, `update`, `reorder`, `delete`) |
| about, authenticate, check-auth-status | `auth` | `action` param (`status`, `authenticate`, `device-code-complete`, `about`) |
| *(new)* create-draft, update-draft, send-draft, delete-draft, create-reply-draft, create-forward-draft | `draft` | `action` param |

## History

- **v3.3.0**: Renamed from `outlook-mcp` / `@littlebearapps/outlook-mcp` to `outlook-assistant` / `@littlebearapps/outlook-assistant`. Old npm package deprecated with redirect. Token files auto-migrate from `.outlook-mcp-tokens.json`.
