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
- Current inbox emails (up to the configured count)
- A `deltaToken` string to use on subsequent calls

Save this token — you'll need it for all future incremental checks.

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
- Store tokens persistently between agent sessions — they remain valid for extended periods.
- Use `outputVerbosity: "minimal"` for efficient polling when you only need to detect changes, not read full content.
- Combine with `read-email` to get full content of specific changed messages after detecting them.
- Use `count` to control how many results are returned per sync call.

## Related

- [Find Emails](../email/find-emails.md) — search and filter emails
- [Using Outlook Assistant in Agents](using-outlook-assistant-in-agents.md) — agent workflow patterns
- [Tools Reference — search-emails](../../quickrefs/tools-reference.md#email-6-tools)
