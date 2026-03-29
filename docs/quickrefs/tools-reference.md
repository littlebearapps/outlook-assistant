---
tags:
  - mcp
---

# Tools Reference - Outlook Assistant

Quick reference for all 22 MCP tools across 9 modules. Each tool includes MCP safety annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

## Authentication (1 tool)

| Tool | Actions | Safety | Key Parameters |
|------|---------|--------|----------------|
| `auth` | `status` (default), `authenticate`, `device-code-complete`, `about` | moderate write | `method` (`device-code` default, `browser`), `force` |

## Email (8 tools)

| Tool | Description | Safety | Key Parameters |
|------|-------------|--------|----------------|
| `search-emails` | Search, list, delta sync, conversations | read-only | `query`, `from`, `to`, `folder`, `deltaMode`, `conversationId`, `groupByConversation`, `internetMessageId` |
| `read-email` | Read content or forensic headers | read-only | `id`, `headersMode`, `groupByType`, `importantOnly` |
| `send-email` | Send email with safety controls | **destructive** | `to`, `subject`, `body`, `dryRun`, `checkRecipients`, `cc`, `bcc`, `importance` |
| `draft` | Create, update, send, delete, reply, forward drafts | **destructive** | `action` (required), `id`, `to`, `subject`, `body`, `comment`, `dryRun`, `checkRecipients` |
| `get-mail-tips` | Pre-send recipient validation | read-only | `recipients`, `tipTypes` |
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

> **Personal accounts**: The `query` and `kqlQuery` parameters use Microsoft's `$search` API which has limited support on personal Outlook.com accounts. Outlook Assistant handles this automatically with progressive search fallback — if `$search` returns no results, it tries OData filters, boolean filters, and recent message listing. For the most direct results on personal accounts, use structured filters (`from`, `subject`, `to`, `receivedAfter`, `hasAttachments`, `unreadOnly`).

> **Delta sync** is designed for inbox monitoring workflows. The first call returns current emails and a `deltaToken`; subsequent calls with that token return only new, modified, and deleted messages. See [Monitor Inbox with Delta Sync](../how-to/ai-agents/monitor-inbox-with-delta-sync.md).

### update-email actions

| Action | Description | Params |
|--------|-------------|--------|
| `mark-read` | Mark as read | `id` (single) |
| `mark-unread` | Mark as unread | `id` (single) |
| `flag` | Flag for follow-up | `id` or `ids` (batch), `dueDateTime`, `startDateTime` |
| `unflag` | Clear flag | `id` or `ids` (batch) |
| `complete` | Mark flag as complete | `id` or `ids` (batch) |

### draft actions

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `create` | Save new draft to Drafts folder | — (all optional) |
| `update` | Edit existing draft | `id` |
| `send` | Send an existing draft | `id` |
| `delete` | Remove a draft | `id` |
| `reply` | Create reply draft from message | `id` |
| `reply-all` | Create reply-all draft from message | `id` |
| `forward` | Create forward draft with new recipients | `id`, `to` |

> **Draft safety**: `dryRun: true` previews without saving (create only). `checkRecipients: true` validates recipients via mail-tips before saving. The `send` action shares rate limits with `send-email`. Recipient allowlist applies to create, update, and forward. `comment` and `body` are mutually exclusive on reply/forward.

### Export formats

| Format | Use Case |
|--------|----------|
| `mime` / `eml` | Full MIME with headers — archival and forensics |
| `mbox` | Unix MBOX archive — batch export conversations |
| `markdown` | Human-readable — paste into documents |
| `json` | Structured data — programmatic processing |
| `html` | Formatted — visual archival of threads |
| `csv` | Spreadsheet-friendly metadata export |

> **Content-type handling**: The `attachments` tool handles text and binary content types. Text attachments (text/\*, application/json, application/xml) are displayed inline; binary attachments require download. The `contentType` field is included in attachment listings.

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
| **Read-only** (7) | `search-emails`, `read-email`, `list-events`, `search-people`, `access-shared-mailbox`, `find-meeting-rooms`, `get-mail-tips` | Auto-approved by MCP clients that support annotations |
| **Destructive** (5) | `send-email`, `draft`, `manage-event`, `folders`, `manage-rules` | Client prompts for confirmation |
| **Idempotent** (2) | `update-email`, `mailbox-settings` | Safe to retry |
| **Moderate write** (8) | All others | Normal approval flow |

## send-email Safety Controls

| Control | Config | Default |
|---------|--------|---------|
| Pre-send mail tips | `checkRecipients: true` param | Disabled |
| Dry-run preview | `dryRun: true` param | Disabled |
| Session rate limit | `OUTLOOK_MAX_EMAILS_PER_SESSION` env | Unlimited (0) |
| Recipient allowlist | `OUTLOOK_ALLOWED_RECIPIENTS` env | Allow all |

### get-mail-tips

Check recipients before sending — detects out-of-office, mailbox full, delivery restrictions, moderation, external recipients, group member counts, and max message size. Uses `POST /me/getMailTips` (existing `Mail.Read` scope).

| Tip Type | What It Checks |
|----------|---------------|
| `automaticReplies` | Out-of-office messages and schedule |
| `mailboxFullStatus` | Whether mailbox is full (delivery may fail) |
| `customMailTip` | Admin-configured notices |
| `deliveryRestriction` | Whether you're allowed to send to this recipient |
| `moderationStatus` | Whether messages require approval |
| `recipientScope` | Internal vs external recipient |
| `maxMessageSize` | Maximum message size limit |
| `totalMemberCount` | Group size (total and external members) |

## Output Verbosity

| Level | Description |
|-------|-------------|
| `minimal` | Essential fields only (token efficient) |
| `standard` | Common fields (default) |
| `full` | All available fields |

## draft Safety Controls

| Control | Config | Default |
|---------|--------|---------|
| Dry-run preview | `dryRun: true` param (create only) | Disabled |
| Pre-save mail tips | `checkRecipients: true` param (create only) | Disabled |
| Session rate limit (create/update) | `OUTLOOK_MAX_DRAFT_PER_SESSION` env | Unlimited (0) |
| Session rate limit (send) | `OUTLOOK_MAX_EMAILS_PER_SESSION` env (shared with `send-email`) | Unlimited (0) |
| Recipient allowlist | `OUTLOOK_ALLOWED_RECIPIENTS` env | Allow all |

## Common Patterns

```
// Create a draft for review
draft(action: "create", to: "sarah@company.com", subject: "Project Update", body: "Hi Sarah...", dryRun: true)

// Save draft, then update it
draft(action: "create", to: "sarah@company.com", subject: "Draft", body: "...")
draft(action: "update", id: "draft-id", subject: "Updated Subject", body: "Better content...")

// Send a draft
draft(action: "send", id: "draft-id")

// Reply to an email as a draft
draft(action: "reply", id: "message-id", comment: "Thanks for the update!")

// Forward as draft with recipients
draft(action: "forward", id: "message-id", to: "colleague@company.com", comment: "FYI")

// List recent emails
search-emails(folder: "inbox", count: 10)

// Search with filters
search-emails(from: "boss@company.com", receivedAfter: "2024-01-01")

// Check recipients before sending
get-mail-tips(recipients: ["sarah@company.com", "team@company.com"])

// Preview email with recipient check
send-email(to: "...", subject: "...", body: "...", dryRun: true, checkRecipients: true)

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

// Delta sync (initial — returns emails + deltaToken)
search-emails(deltaMode: true)

// Delta sync (incremental — returns only changes)
search-emails(deltaMode: true, deltaToken: "previous-token...")
```
