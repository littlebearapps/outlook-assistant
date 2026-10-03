---
tags:
  - mcp
---

# Tools Reference - Outlook Assistant

Quick reference for all 22 MCP tools across 9 modules. Each tool includes MCP safety annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).

## Authentication (1 tool)

| Tool | Actions | Safety | Key Parameters |
|------|---------|--------|----------------|
| `auth` | `status` (default), `authenticate`, `device-code-complete`, `about` | moderate write | `method` (`device-code` default, `browser`), `force`, `clientId` (saves your Azure Application (client) ID to `~/.outlook-assistant-config.json` for clients that can't set `OUTLOOK_CLIENT_ID`; the env var wins). Device code state persists across server restarts (v3.7.2+). |

## Email (8 tools)

| Tool | Description | Safety | Key Parameters |
|------|-------------|--------|----------------|
| `search-emails` | Search, list, delta sync, conversations | read-only | `query`, `from`, `to`, `folder` (name or nested path), `searchAllFolders`, `searchExpression`, `deltaMode`, `conversationId`, `groupByConversation`, `internetMessageId`, `sharedMailbox` (alias `email`), `maxResults` (delta page size) |
| `read-email` | Read content or forensic headers | read-only | `id`, `headersMode`, `groupByType`, `importantOnly`, `sharedMailbox` (alias `email`) |
| `send-email` | Send email with safety controls | **destructive** | `to`, `subject`, `body`, `dryRun`, `checkRecipients`, `cc`, `bcc`, `importance` |
| `draft` | Create, update, send, delete, reply, forward drafts | **destructive** | `action` (required), `id`, `to`, `subject`, `body`, `comment`, `dryRun`, `checkRecipients` |
| `get-mail-tips` | Pre-send recipient validation | read-only | `recipients`, `tipTypes` |
| `update-email` | Mark read/unread, flag/unflag/complete | idempotent | `action` (required), `id`, `ids`, `dueDateTime`, `startDateTime`, `sharedMailbox` (alias `email`) |
| `attachments` | List, view, or download attachments | moderate write | `action` (`list`/`view`/`download`), `messageId`, `attachmentId`, `outputDir` (download; default system tmpdir), `sharedMailbox` (alias `email`) |
| `export` | Export emails to various formats | moderate write | `target` (`message`/`messages`/`conversation`/`mime`), `id`, `emailIds`, `searchQuery`/`query`, `conversationId`, `format`, `outputDir` (or `savePath` for a single message), `sharedMailbox` (alias `email`) |

> **`sharedMailbox` is opt-in (work/school only).** Set `OUTLOOK_SHARED_MAILBOX=read` (read: `Mail.Read.Shared`) or `=true` (read and organise: adds `Mail.ReadWrite.Shared`), restart, then run `auth action=authenticate force=true`. While it's unset, `sharedMailbox` calls are refused with these steps, and `access-shared-mailbox` reads only well-known folder names or folder IDs, as before (`listFolders` and custom/nested names need the setting).
>
> **Downloads and exports stay in the output directory.** Server-chosen filenames are sanitised, written with exclusive create (an existing file or symlink is never overwritten or followed; a clash gets a numbered suffix) and confined to `outputDir`. IDs containing `.` or `..` path segments are refused before any Graph request.
>
> **`sharedMailbox` is read/organise only.** `send-email` and `draft` (create/update/send/delete, reply, reply-all, forward) deliberately take no `sharedMailbox` parameter — they always act on the signed-in user's own mailbox, and `Mail.Send.Shared` is not requested.

### search-emails modes

| Mode | Trigger | Description |
|------|---------|-------------|
| List | No query params | Lists recent emails (like old `list-emails`) |
| Search | `query`, `from`, `to`, etc. | Full search with OData filters; `searchExpression` for a raw Graph `$search` expression; `searchAllFolders: true` for cross-folder |
| Delta | `deltaMode: true` | Incremental sync, returns `deltaToken` |
| Conversation list | `groupByConversation: true` | Groups by thread |
| Conversation get | `conversationId` | Messages in a thread, oldest first (up to 100; `export target=conversation` takes up to 1000) |
| Message-ID lookup | `internetMessageId` | Find by RFC Message-ID header |

> **Personal accounts**: The `query` and raw `searchExpression` (formerly `kqlQuery`, kept as a deprecated alias) parameters use Microsoft's `$search` API, which has limited support on personal Outlook.com accounts. Unscoped expressions work; field-scoped ones (e.g. `from:someone@example.com`, `subject:"…"`) return nothing from `$search` there, so since v3.10.0 they are translated into the closest equivalent OData filters and retried, reported as strategy `raw-kql-translated` (#217) — note a `subject:` term becomes a substring match, so the translation is close rather than identical. Expressions that cannot be translated exactly — free text, `AND`/`OR`, unknown prefixes — still terminate rather than silently falling back to an unfiltered search. `query` handles the same limitation with progressive fallback (OData filters, boolean filters, recent listing). Structured filters (`from`, `subject`, `to`, `receivedAfter`, `hasAttachments`, `unreadOnly`) remain the most direct route. Cross-folder search (`searchAllFolders: true`) returns a superset of inbox-only results.

> **`query` vs `searchExpression`**: these issue structurally different Graph requests, so they surface different messages. An untranslated `searchExpression` is answered by `$search` over the entire message — body included — ranked by relevance with no date ordering, so a term buried in a body can outrank an obvious subject-line match. On personal accounts `query` falls back to a subject substring match (every word must appear in the subject), which is precise but never reads bodies. Use `query` for a term you expect in a subject, `searchExpression` when you need body content.

> **`to` scan cap**: personal Outlook.com rejects the server-side recipient filter, so `to` falls back to a local match over the 500 most recent messages (`OUTLOOK_SEARCH_SCAN_LIMIT`, max 5000). On a large archive that excludes older mail; pair `to` with `receivedAfter`/`receivedBefore` to reach it. The response discloses a truncated scan whether or not it matched.

> **Search metadata**: every `search-emails` response carries `_meta.searchMetadata`. `finalStrategy` names the rung that answered (`combined-search`, `single-term-*`, `client-side-*`, `boolean-filters-only`, `raw-kql-translated`, `recent-emails`); `filterApplied` says whether every supplied filter was honoured; `droppedFilters` lists any that were not — it should always be empty, and a non-empty value means the result set is broader than the query (#229). `candidatesScanned` (with `scanLimit` and `truncated`) discloses how many messages a client-side fallback examined, so a bounded scan never reads as a whole-mailbox answer; `kqlTranslatedTo` records the rewrite when a field-scoped `searchExpression` was translated. An empty search additionally reports in its guidance text how many messages any local narrowing pass looked at.

> **Delta sync** is designed for inbox monitoring workflows. The first call returns current emails and a `deltaToken`; subsequent calls with that token return only new, modified, and deleted messages. `maxResults` (1–200, default 100) sets the page size, sent as `Prefer: odata.maxpagesize` on every request; when a page returns a continuation token (`_meta.tokenType: "continuation"`), keep passing it back with the same `maxResults` until a delta token arrives. See [Monitor Inbox with Delta Sync](../how-to/ai-agents/monitor-inbox-with-delta-sync.md).

### update-email actions

| Action | Description | Params |
|--------|-------------|--------|
| `mark-read` | Mark as read | `id` (single) |
| `mark-unread` | Mark as unread | `id` (single) |
| `flag` | Flag for follow-up | `id` or `ids` (batch), `dueDateTime`, `startDateTime` |
| `unflag` | Clear flag | `id` or `ids` (batch) |
| `complete` | Mark flag as complete | `id` or `ids` (batch) |

Flag dates: a `dueDateTime`/`startDateTime` with `Z` or a ±hh:mm offset is kept as that exact instant (sent to Graph in UTC); one without a zone is read in the configured timezone (`OUTLOOK_DEFAULT_TIMEZONE`, default Australia/Melbourne). Date-only or unparseable values are refused before any change. With only `dueDateTime`, the start defaults to 09:00 on the due date in the configured timezone, or the due time if earlier. The reply shows each date in UTC and in the configured timezone.

### draft actions

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `create` | Save new draft to Drafts folder | — (all optional) |
| `update` | Edit an existing draft (refuses non-drafts) | `id` |
| `send` | Send an existing draft (refuses non-drafts) | `id` |
| `delete` | Delete a draft to Recoverable Items (restorable for a limited time, depending on your account), skipping Deleted Items (refuses non-drafts) | `id` |
| `reply` | Create reply draft from message | `id` |
| `reply-all` | Create reply-all draft from message | `id` |
| `forward` | Create forward draft with new recipients | `id`, `to` |

> **Draft safety**: `dryRun: true` previews without saving (create only). `checkRecipients: true` validates recipients via mail-tips before saving. The `send` action shares rate limits with `send-email`. Recipient allowlist applies to create, update, and forward. `update`, `send` and `delete` check the `id` first and refuse anything that is not an unsent draft, so a received or sent message is never edited, deleted or re-sent. `comment` and `body` are mutually exclusive on reply/forward.

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
| `list-events` | List events: upcoming by default, or past/current/by name with filters (times as canonical UTC ISO-8601 + labelled local) | read-only | `count` (default 10, max 100), `startAfter`/`startBefore` (ISO 8601 with `Z` or ±hh:mm, normalised to UTC), `subject` (case-insensitive contains, ≤ 255 chars). Supplying any filter replaces the default `start ≥ now` bound and filters are AND-ed; backward-looking searches (`startBefore` alone, or `subject` alone) return newest first. Invalid values return a tool error before any Graph call |
| `create-event` | Create new event | **destructive** (sends invitations) | `subject`, `start`, `end`, `attendees` (email strings are required attendees; `{email, type}` objects set `type` to `required`/`optional`/`resource`), `body`. Times use configured timezone (default: Australia/Melbourne; override with `OUTLOOK_DEFAULT_TIMEZONE` env var) — omit `Z` suffix for local time |
| `manage-event` | Update, decline, cancel, or delete (delete removes the event and Graph doesn't document a guaranteed recovery path; deleting a meeting you organised that has attendees emails them a cancellation; use `cancel` with a `comment` to control the message) | **destructive** | `action` (`update`/`decline`/`cancel`/`delete`), `eventId` (or alias `id`), `comment` (decline/cancel; omitted if not given), `sendResponse` (decline only; `false` declines without notifying the organiser), `subject`/`start`/`end`/`attendees`/`body`/`location`/`isOnlineMeeting`/`sensitivity`/`showAs`/`importance`/`categories`/`reminderMinutesBeforeStart` (update only — only the fields you pass are changed; `attendees` is a full replacement list of email strings or `{email, type}` objects, and an entry without a type keeps the type that address already has, new addresses being required), `dryRun` (preview the PATCH without applying it; with untyped attendees it reads the event first so the preview shows the resolved types) |

## Folder (1 tool)

| Tool | Actions | Safety | Key Parameters |
|------|---------|--------|----------------|
| `folders` | `list` (default), `create`, `move`, `stats`, `delete` | **destructive** | `name`, `parentFolder`/`parentFolderId` (create), `emailIds`, `targetFolder`/`targetFolderId` (move), `folder`/`folderId` (stats), `folderName`/`folderId` (delete), `outputVerbosity`. Folders addressable by nested path (`Parent/Child`) or ID; `list` shows full paths + IDs. All actions accept `sharedMailbox` (alias `email`) |

## Rules (1 tool)

| Tool | Actions | Safety | Key Parameters |
|------|---------|--------|----------------|
| `manage-rules` | `list` (default), `create`, `update`, `reorder`, `delete` | **destructive** | `name` (or alias `displayName`), `fromAddresses`, `containsSubject`, `bodyContains`, `hasAttachments`, `moveToFolder`/`copyToFolder` (name, nested path like `Triage/Delete`, or ID), `forwardTo`, `assignCategories`, `dryRun`, `except*`, `ruleName`, `ruleId`, `sequence` |

## Contacts (2 tools)

| Tool | Description | Safety | Key Parameters |
|------|-------------|--------|----------------|
| `manage-contact` | Full CRUD: `list` (default), `search`, `get`, `create`, `update`, `delete` | **destructive** | `action`, `query`, `id`, `displayName`, `email`, `count` |
| `search-people` | Relevance-based search (People API) | read-only | `query`, `count` |

## Categories (3 tools)

| Tool | Description | Safety | Key Parameters |
|------|-------------|--------|----------------|
| `manage-category` | CRUD: `list` (default), `create`, `update`/`set` (alias), `delete` | **destructive** (`delete`) | `action`, `displayName`, `color`, `id` (or deprecated alias `categoryId`) |
| `apply-category` | Apply/add/remove categories on messages. With `sharedMailbox`, category names must already exist in that mailbox's master list (`manage-category` manages the signed-in account only) | idempotent | `messageId`/`messageIds`, `categories`, `action`, `sharedMailbox` (alias `email`) |
| `manage-focused-inbox` | Focused Inbox overrides: `list` (default), `set`, `delete` | **destructive** (`delete`) | `action`, `emailAddress`, `classifyAs` |

### Category colours

`preset0`-`preset24`: Red, Orange, Brown, Yellow, Green, Teal, Olive, Blue, Purple, etc.

## Settings (1 tool)

| Tool | Actions | Safety | Key Parameters |
|------|---------|--------|----------------|
| `mailbox-settings` | `get` (default), `set-auto-replies`, `set-working-hours` | **destructive** (auto-replies reach external senders), idempotent | `section`, `enabled`, `startDateTime`, `endDateTime`, `internalReplyMessage`, `startTime`, `endTime`, `daysOfWeek` |

## Advanced (2 tools)

| Tool | Description | Safety | Key Parameters |
|------|-------------|--------|----------------|
| `access-shared-mailbox` | Read shared mailbox (incl. custom subfolders) or enumerate its folder tree — no send/draft/reply/forward | read-only | `sharedMailbox` (or alias `email`), `folder` (name/path), `folderId`, `listFolders`, `count` (default 25, max 50), `outputVerbosity` |
| `find-meeting-rooms` | Search meeting rooms | read-only | `query`, `building`, `floor`, `capacity` |

## Safety Annotations

All four hints are set explicitly on every tool, and derived from the risk-class map in `utils/risk-classes.js`, so they can't drift from what the tool does. `destructiveHint` covers deletes, and also anything that reaches other people or keeps acting after the call (sends, invitations, cancellations, inbox rules, automatic replies).

| Category | Tools | Client Behaviour |
|----------|-------|------------------|
| **Read-only** (7) | `search-emails`, `read-email`, `list-events`, `search-people`, `access-shared-mailbox`, `find-meeting-rooms`, `get-mail-tips` | Auto-approved by MCP clients that support annotations |
| **Destructive** (10) | `send-email`, `draft`, `create-event`, `manage-event`, `manage-rules`, `mailbox-settings`, `folders`, `manage-contact`, `manage-category`, `manage-focused-inbox` | Client prompts for confirmation |
| **Other writes** (5) | `auth`, `update-email`, `apply-category`, `attachments`, `export` | Normal approval flow |

`idempotentHint: true` (safe to retry) is set on every read-only tool and on `update-email`, `apply-category` and `mailbox-settings`.

> **`openWorldHint: true`** is set on tools that return content authored by external/untrusted parties (`search-emails`, `read-email`, `list-events`, `get-mail-tips`, `search-people`, `access-shared-mailbox`, `attachments`, `export`, `draft`) or that reach other people (`send-email`, `draft`, `create-event`, `manage-event`, `manage-rules`, `mailbox-settings`), signalling MCP clients to apply appropriate caution (e.g. prompt-injection defences).

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
| Drafts-only guard (update/send/delete) | Always on | Non-drafts refused |

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

// Upcoming events (default)
list-events(count: 10)

// Past events in a window (oldest first)
list-events(startAfter: "2026-01-01T00:00:00Z", startBefore: "2026-02-01T00:00:00Z")

// Most recent events with "standup" in the subject (newest first)
list-events(subject: "standup", count: 5)

// Set out-of-office
mailbox-settings(action: "set-auto-replies", enabled: true, internalReplyMessage: "I'm away...")

// Flag email for follow-up (Z/offset = exact instant; no zone = configured timezone)
update-email(action: "flag", id: "...", dueDateTime: "2026-03-01T09:00:00Z")
update-email(action: "flag", id: "...", dueDateTime: "2026-03-01T17:00:00")

// Access shared mailbox (needs OUTLOOK_SHARED_MAILBOX for listFolders / custom names)
access-shared-mailbox(sharedMailbox: "team@company.com", folder: "inbox")

// Discover a shared mailbox's custom subfolders (names, paths, IDs)
access-shared-mailbox(sharedMailbox: "team@company.com", listFolders: true)

// Read a custom subfolder of a shared mailbox by path
access-shared-mailbox(sharedMailbox: "team@company.com", folder: "Inbox/Vendors/Acme")

// List a shared mailbox's folder hierarchy via the folders tool
folders(action: "list", sharedMailbox: "team@company.com", includeChildren: true)

// Search within a shared mailbox's custom folder
search-emails(sharedMailbox: "team@company.com", folder: "Archiv", query: "invoice")

// Delta sync (initial — returns emails + deltaToken)
search-emails(deltaMode: true, maxResults: 50)

// Delta sync paging (continuation token from the previous page, same page size)
search-emails(deltaMode: true, deltaToken: "continuation-token...", maxResults: 50)

// Delta sync (incremental — returns only changes)
search-emails(deltaMode: true, deltaToken: "previous-token...", maxResults: 50)
```
