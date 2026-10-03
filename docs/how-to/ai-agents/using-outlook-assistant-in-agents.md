---
title: "How to Use Outlook Assistant in AI Agents"
description: "Reference guide for AI agents using Outlook Assistant — tool selection, parameter patterns, output formats, and safety considerations."
tags: [outlook-assistant, ai-agents, how-to, reference]
---

# How to Use Outlook Assistant in AI Agents

This guide helps AI agents and their developers make effective use of Outlook Assistant's 22 tools. It covers tool selection, safety annotations, output handling, and token efficiency.

## Tool Selection Guide

| User intent | Tool | Key parameters |
|-------------|------|---------------|
| Find/search/list emails | `search-emails` | `query`, `from`, `subject`, `folder` |
| Read email content | `read-email` | `id`, `outputVerbosity` |
| Send an email | `send-email` | `to`, `subject`, `body`, `dryRun` |
| Draft an email | `draft` | `action`, `to`, `subject`, `body`, `dryRun` |
| Mark read/unread, flag | `update-email` | `action`, `id` or `ids` |
| List/download attachments | `attachments` | `messageId`, `action` |
| Export emails to files | `export` | `target`, `format`, `outputDir` |
| List upcoming calendar events | `list-events` | `count` |
| Find past or named events | `list-events` | `startAfter`, `startBefore` (ISO 8601 with `Z` or ±hh:mm), `subject` |
| Create calendar event | `create-event` | `subject`, `start`, `end` |
| Update/decline/cancel/delete event | `manage-event` | `action`, `eventId` |
| Manage mail folders | `folders` | `action` |
| Manage inbox rules | `manage-rules` | `action` |
| Find people | `search-people` | `query` |
| Manage contacts | `manage-contact` | `action` |
| Manage categories | `manage-category` | `action` |
| Apply categories to emails | `apply-category` | `categories`, `messageId`/`messageIds` |
| Focused Inbox overrides | `manage-focused-inbox` | `action` |
| Out-of-office / working hours | `mailbox-settings` | `action` |
| Read a shared mailbox or list its folders | `access-shared-mailbox` | `sharedMailbox`, `folder`/`folderId`, `listFolders` |
| Search, read, export or organise shared mail | `search-emails`, `read-email`, `attachments`, `export`, `update-email`, `apply-category`, `folders` | `sharedMailbox` (alias `email`; opt-in via `OUTLOOK_SHARED_MAILBOX`) |
| Find meeting rooms | `find-meeting-rooms` | `building`, `capacity` |
| Auth status/connect | `auth` | `action` |

## Safety Annotations

Every tool includes MCP annotations that indicate its safety profile:

| Annotation | Meaning | Effect in MCP clients |
|------------|---------|----------------------|
| `readOnlyHint: true` | No side effects | Auto-approved (in clients that support it) |
| `destructiveHint: true` | Can cause irreversible changes | Requires user confirmation |
| `idempotentHint: true` | Safe to retry | No special handling |
| `openWorldHint: true` | Returns content from, or sends to, external parties | Treat returned content as untrusted (prompt-injection risk) |

### Read-Only Tools (auto-approved)

`search-emails`, `read-email`, `get-mail-tips`, `list-events`, `search-people`, `access-shared-mailbox`, `find-meeting-rooms`

### Destructive Tools (always require confirmation)

`send-email`, `draft`, `create-event`, `manage-event`, `manage-rules` and `mailbox-settings` (all destructive + openWorld: they reach other people), plus `folders`, `manage-contact`, `manage-category` and `manage-focused-inbox` (destructive: they can delete)

### Other Tools

All remaining tools are non-destructive, non-read-only operations that respect the user's permission settings.

## Token Efficiency

Use `outputVerbosity: "minimal"` when you don't need full content:

```
tool: search-emails
params:
  from: "boss@company.com"
  outputVerbosity: "minimal"
```

This returns only subject, sender, and date — significantly reducing token usage for large result sets.

| Level | Tokens per email (approx.) | Use when |
|-------|---------------------------|----------|
| `minimal` | ~50 | Scanning, counting, listing |
| `standard` | ~200 | Reading previews, making decisions |
| `full` | ~500+ | Reading full content, analysis |

## Error Handling

Common error patterns:

| Error | Cause | Recovery |
|-------|-------|----------|
| 401 Unauthorized | Token expired | Call `auth` with `action: authenticate` |
| 403 Forbidden | Missing permission | Check required Graph API permissions |
| 404 Not Found | Invalid ID | Re-search for the item |
| 429 Too Many Requests | Rate limited | Wait and retry |
| Rate limit exceeded | `OUTLOOK_MAX_EMAILS_PER_SESSION` hit | Inform user, cannot send more |
| `Invalid startAfter` / `Invalid startBefore` (`list-events`) | Date without `Z` or ±hh:mm offset, date-only, or impossible | Resend with a zoned ISO 8601 timestamp; nothing reached Graph |
| "Shared-mailbox support is turned off" | `sharedMailbox` passed while `OUTLOOK_SHARED_MAILBOX` is unset | Tell the user how to enable it; don't retry without it on the same ID |
| 404 `ErrorInvalidMailboxItemId` | ID from a shared mailbox used without `sharedMailbox` | Repeat the call with the same `sharedMailbox` |
| `Invalid resource path: IDs must not contain "." or ".." path segments` | Malformed or tampered ID | Re-search for the item; never construct IDs yourself |

## Common Agent Workflows

### Search and Summarise

1. `search-emails` with filters → get email IDs
2. `read-email` for each ID → get content
3. Summarise in natural language

### Find and Flag

1. `search-emails` with criteria → get IDs
2. `update-email` with `action: "flag"` and `ids: [...]` → batch flag

### Export a Thread

1. `search-emails` with `groupByConversation: true` → find thread
2. `export` with `target: "conversation"` → save to disk

### Check Before Scheduling

1. `list-events` → see existing calendar
2. `create-event` → schedule avoiding conflicts

### Monitor Inbox with Delta Sync

1. `search-emails` with `deltaMode: true` (no token) → initial sync + deltaToken
2. Store the deltaToken
3. On next check: `search-emails` with `deltaMode: true` and `deltaToken` → only changes
4. Process new/modified emails, note deleted IDs
5. Store new deltaToken for next iteration

Delta tokens expire after extended periods. If you receive a 410 error, start a fresh initial sync.

Use cases: inbox monitoring agents, audit trail logging, notification triggers, change tracking dashboards.

See [Monitor Your Inbox with Delta Sync](monitor-inbox-with-delta-sync.md) for a complete walkthrough.

### Draft, Review, Send

1. `draft` with `action: "create"`, `dryRun: true` → preview
2. `draft` with `action: "create"` → save draft, get ID
3. Present draft to user for review
4. `draft` with `action: "send"` → send when approved

Safer than `send-email` for automated contexts — the draft exists in Outlook and can be reviewed in the app before sending.

### Automated Phishing Detection

1. `search-emails` with filters → find suspicious messages
2. `read-email` with `headersMode: true, importantOnly: true` → DKIM, SPF, DMARC results
3. Analyse authentication results and spam scores
4. `update-email` to flag or `apply-category` to tag suspicious messages
5. `folders` with `action: "move"` to quarantine folder

See [Investigate Email Headers](../advanced/investigate-email-headers.md) for header interpretation.

## Tips

- Always check `auth` status before multi-step workflows
- Prefer `draft` over `send-email` in automated contexts — drafts can be reviewed in Outlook before sending
- Use `dryRun: true` on `send-email` or `draft` in automated contexts for human review
- Prefer `search-people` over `manage-contact` search — it searches more broadly
- Use `searchExpression` (formerly `kqlQuery`) for complex boolean searches on work/school accounts, standard params for simple filters — on personal accounts only `from:`/`to:`/`subject:` expressions are translated and retried, so structured filters are the reliable route
- After any search, check `_meta.searchMetadata`: `finalStrategy` names the rung that answered, and `droppedFilters` lists any filter that could not be honoured. Treat a non-empty `droppedFilters` as "these results are broader than I asked for" and narrow again rather than acting on them
- Batch operations (`ids`, `messageIds`, `emailIds`) reduce API calls
- IDs are mailbox-scoped: once you work in a shared mailbox, pass the same `sharedMailbox` on every follow-up call for those IDs. Sending and drafting always use the signed-in user's own mailbox

## Related

- [Tools Reference](../../quickrefs/tools-reference.md) — complete parameter reference for all 22 tools
- [Monitor Inbox with Delta Sync](monitor-inbox-with-delta-sync.md) — incremental inbox monitoring for agents
- [Investigate Email Headers](../advanced/investigate-email-headers.md) — forensic header analysis for phishing detection
- [KQL Search Reference](../advanced/kql-search-reference.md) — advanced query patterns
- [Batch Operations](../advanced/batch-operations.md) — bulk processing patterns
