---
tags:
  - mcp
---

# Tools Reference - outlook-mcp

Quick reference for all 20 consolidated MCP tools across 9 modules. Each tool includes MCP safety annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

## Authentication (1 tool)

| Tool | Actions | Safety |
|------|---------|--------|
| `auth` | `status` (default), `authenticate`, `about` | moderate write |

## Email (6 tools)

| Tool | Description | Safety | Key Parameters |
|------|-------------|--------|----------------|
| `search-emails` | Search, list, delta sync, conversations | read-only | `query`, `from`, `to`, `folder`, `deltaMode`, `conversationId`, `groupByConversation`, `internetMessageId` |
| `read-email` | Read content or forensic headers | read-only | `id`, `headersMode`, `groupByType`, `importantOnly` |
| `send-email` | Send email with safety controls | **destructive** | `to`, `subject`, `body`, `dryRun`, `cc`, `bcc`, `importance` |
| `update-email` | Mark read/unread, flag/unflag/complete | idempotent | `action` (required), `id`, `ids`, `dueDateTime` |
| `attachments` | List, view, or download attachments | moderate write | `action` (`list`/`view`/`download`), `messageId`, `attachmentId` |
| `export` | Export emails to various formats | moderate write | `target` (`message`/`messages`/`conversation`/`mime`), `id`, `format`, `outputDir` |

### search-emails modes

| Mode | Trigger | Description |
|------|---------|-------------|
| List | No query params | Lists recent emails (like old `list-emails`) |
| Search | `query`, `from`, `to`, etc. | Full search with filters and KQL |
| Delta | `deltaMode: true` | Incremental sync, returns `deltaToken` |
| Conversation list | `groupByConversation: true` | Groups by thread |
| Conversation get | `conversationId` | All messages in a thread |
| Message-ID lookup | `internetMessageId` | Find by RFC Message-ID header |

> **Personal accounts**: The `query` and `kqlQuery` parameters use Microsoft's `$search` API which may not work on personal Outlook.com accounts. Use structured filters (`from`, `subject`, `to`, `receivedAfter`, `hasAttachments`, `unreadOnly`) for reliable searching on all account types.

### update-email actions

| Action | Description | Params |
|--------|-------------|--------|
| `mark-read` | Mark as read | `id` (single) |
| `mark-unread` | Mark as unread | `id` (single) |
| `flag` | Flag for follow-up | `id` or `ids` (batch), `dueDateTime`, `startDateTime` |
| `unflag` | Clear flag | `id` or `ids` (batch) |
| `complete` | Mark flag as complete | `id` or `ids` (batch) |

### Export formats

| Format | Use Case |
|--------|----------|
| `mime` / `eml` | Full MIME with headers — archival and forensics |
| `mbox` | Unix MBOX archive — batch export conversations |
| `markdown` | Human-readable — paste into documents |
| `json` | Structured data — programmatic processing |
| `html` | Formatted — visual archival of threads |

## Calendar (3 tools)

| Tool | Description | Safety | Key Parameters |
|------|-------------|--------|----------------|
| `list-events` | List upcoming events | read-only | `count` |
| `create-event` | Create new event | moderate write | `subject`, `start`, `end`, `attendees`, `body`. Times use configured timezone (default: Australia/Melbourne) — omit `Z` suffix for local time |
| `manage-event` | Decline, cancel, or delete | **destructive** | `action` (`decline`/`cancel`/`delete`), `eventId`, `comment` |

## Folder (1 tool)

| Tool | Actions | Safety | Key Parameters |
|------|---------|--------|----------------|
| `folders` | `list` (default), `create`, `move`, `stats`, `delete` | **destructive** | `name`, `emailIds`, `targetFolder`, `folder`, `folderId`, `folderName`, `outputVerbosity` |

## Rules (1 tool)

| Tool | Actions | Safety | Key Parameters |
|------|---------|--------|----------------|
| `manage-rules` | `list` (default), `create`, `reorder`, `delete` | **destructive** | `name`, `fromAddresses`, `moveToFolder`, `ruleName`, `ruleId`, `sequence` |

## Contacts (2 tools)

| Tool | Description | Safety | Key Parameters |
|------|-------------|--------|----------------|
| `manage-contact` | Full CRUD: `list` (default), `search`, `get`, `create`, `update`, `delete` | moderate write | `action`, `query`, `id`, `displayName`, `email`, `count` |
| `search-people` | Relevance-based search (People API) | read-only | `query`, `count` |

## Categories (3 tools)

| Tool | Description | Safety | Key Parameters |
|------|-------------|--------|----------------|
| `manage-category` | CRUD: `list` (default), `create`, `update`, `delete` | moderate write | `action`, `displayName`, `color`, `id` |
| `apply-category` | Apply/add/remove categories on messages | moderate write | `messageId`/`messageIds`, `categories`, `action` |
| `manage-focused-inbox` | Focused Inbox overrides: `list` (default), `set`, `delete` | moderate write | `action`, `emailAddress`, `classifyAs` |

### Category colours

`preset0`-`preset24`: Red, Orange, Brown, Yellow, Green, Teal, Olive, Blue, Purple, etc.

## Settings (1 tool)

| Tool | Actions | Safety | Key Parameters |
|------|---------|--------|----------------|
| `mailbox-settings` | `get` (default), `set-auto-replies`, `set-working-hours` | idempotent | `section`, `enabled`, `startDateTime`, `endDateTime`, `internalReplyMessage`, `startTime`, `endTime`, `daysOfWeek` |

## Advanced (2 tools)

| Tool | Description | Safety | Key Parameters |
|------|-------------|--------|----------------|
| `access-shared-mailbox` | Read shared mailbox | read-only | `sharedMailbox`, `folder`, `count` |
| `find-meeting-rooms` | Search meeting rooms | read-only | `query`, `building`, `capacity` |

## Safety Annotations

| Category | Tools | Client Behaviour |
|----------|-------|------------------|
| **Read-only** (6) | `search-emails`, `read-email`, `list-events`, `search-people`, `access-shared-mailbox`, `find-meeting-rooms` | Auto-approved by MCP clients that support annotations |
| **Destructive** (4) | `send-email`, `manage-event`, `folders`, `manage-rules` | Client prompts for confirmation |
| **Idempotent** (2) | `update-email`, `mailbox-settings` | Safe to retry |
| **Moderate write** (7) | All others | Normal approval flow |

## send-email Safety Controls

| Control | Config | Default |
|---------|--------|---------|
| Dry-run preview | `dryRun: true` param | Disabled |
| Session rate limit | `OUTLOOK_MAX_EMAILS_PER_SESSION` env | Unlimited (0) |
| Recipient allowlist | `OUTLOOK_ALLOWED_RECIPIENTS` env | Allow all |

## Output Verbosity

| Level | Description |
|-------|-------------|
| `minimal` | Essential fields only (token efficient) |
| `standard` | Common fields (default) |
| `full` | All available fields |

## Common Patterns

```
// List recent emails
search-emails(folder: "inbox", count: 10)

// Search with filters
search-emails(from: "boss@company.com", receivedAfter: "2024-01-01")

// Preview email before sending
send-email(to: "...", subject: "...", body: "...", dryRun: true)

// Get forensic headers
read-email(id: "...", headersMode: true, importantOnly: true)

// Export conversation to markdown
export(target: "conversation", conversationId: "...", format: "markdown", outputDir: "/tmp")

// Set out-of-office
mailbox-settings(action: "set-auto-replies", enabled: true, internalReplyMessage: "I'm away...")

// Flag email for follow-up
update-email(action: "flag", id: "...", dueDateTime: "2026-03-01T09:00:00Z")

// Access shared mailbox
access-shared-mailbox(sharedMailbox: "team@company.com", folder: "inbox")
```
