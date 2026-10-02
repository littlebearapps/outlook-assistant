---
title: "How to Monitor Your Inbox with Delta Sync"
description: "Use delta sync for incremental inbox monitoring — track new, modified, and deleted emails with deltaToken."
tags: [outlook-assistant, ai-agents, how-to, delta-sync]
---

# How to Monitor Your Inbox with Delta Sync

Delta sync lets you track inbox changes incrementally — instead of re-fetching all emails, you get only what's new, modified, or deleted since your last check.

## How Delta Sync Works

1. **Initial sync** — call `search-emails` with `deltaMode: true` (no token). Returns current emails plus a `deltaToken`.
2. **Store the token** — save the `deltaToken` from the response.
3. **Incremental sync** — call again with the same `deltaMode: true` and your stored `deltaToken`. Returns only changes since that token was issued.

Each incremental call returns a new `deltaToken` for the next round.

## Initial Sync

> "Get my current inbox state for monitoring"

```
tool: search-emails
params:
  deltaMode: true
```

The response includes:
- Current inbox emails, one page at a time (`maxResults` per page: 1–200, default 100)
- A `deltaToken` string to use on subsequent calls

If the folder holds more messages than one page, the response returns a **continuation token** instead (`_meta.tokenType: "continuation"`, `hasMoreChanges: true`). Pass it back as `deltaToken`, with the same `maxResults`, and keep paging until a page returns a **delta token** (`_meta.tokenType: "delta"`). Only that final delta token is worth saving.

```
tool: search-emails
params:
  deltaMode: true
  deltaToken: "continuation-token-from-previous-page"
  maxResults: 50
```

Save the delta token — you'll need it for all future incremental checks.

## Incremental Sync

> "Check for new emails since my last sync"

```
tool: search-emails
params:
  deltaMode: true
  deltaToken: "your-saved-token-here"
```

The response includes:
- **New emails** received since the token was issued
- **Modified emails** (e.g. marked as read, flagged, moved)
- **Deleted email IDs** (via `@removed` entries)
- A **new deltaToken** for the next call

## Handling Token Expiry

Delta tokens expire after an extended period of inactivity. If you receive a `410 Gone` error, your token has expired — start a fresh initial sync (no token) to get a new baseline.

```
// Recovery pattern:
1. Call with deltaToken → 410 error
2. Discard expired token
3. Call without deltaToken (fresh initial sync)
4. Save new deltaToken
```

## Use Cases

### Inbox Monitoring Agent

Poll for new emails on a schedule and process them automatically:

1. Initial sync → store token
2. Every N minutes: incremental sync with stored token
3. For each new email: read content, categorise, flag, or forward
4. Store new token for next iteration

### Audit Trail Logging

Track all inbox changes for compliance:

1. Initial sync to establish baseline
2. Incremental syncs to log every new, modified, and deleted email
3. Write changes to an audit log with timestamps

### Notification Triggers

Detect emails from specific senders or matching patterns:

1. Incremental sync to get new emails
2. Filter by sender, subject, or other criteria
3. Trigger alerts, create tasks, or escalate as needed

## Tips

- Delta sync works per-folder (defaults to inbox). Specify `folder` to monitor other folders.
- To monitor a shared mailbox, add `sharedMailbox` (needs the opt-in `OUTLOOK_SHARED_MAILBOX` setting) and keep passing it with the same `deltaToken` — see [Access Shared Mailboxes](../advanced/access-shared-mailboxes.md).
- Pass `deltaToken` back exactly as you received it. Tokens that point anywhere other than `https://graph.microsoft.com` are refused, so the access token is never sent elsewhere.
- Store tokens persistently between agent sessions — they remain valid for extended periods.
- Use `outputVerbosity: "minimal"` for efficient polling when you only need to detect changes, not read full content.
- Combine with `read-email` to get full content of specific changed messages after detecting them.
- Use `maxResults` (1–200, default 100) to set the page size. It is sent to Graph as the `Prefer: odata.maxpagesize` header and sizes each page, never the whole sync — pass the same value on every page (an omitted value means 100).

## Related

- [Find Emails](../email/find-emails.md) — search and filter emails
- [Using Outlook Assistant in Agents](using-outlook-assistant-in-agents.md) — agent workflow patterns
- [Tools Reference — search-emails](../../quickrefs/tools-reference.md#email-8-tools)
