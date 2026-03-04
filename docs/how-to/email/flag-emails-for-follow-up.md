---
title: "How to Flag Emails for Follow-Up"
description: "Mark emails as read or unread, flag them for follow-up with due dates, and bulk-flag multiple messages."
tags: [outlook-mcp, email, how-to]
---

# How to Flag Emails for Follow-Up

Manage email read status and follow-up flags to stay on top of important messages.

## Mark an Email as Read

> "Mark that email as read"

```
tool: update-email
params:
  action: "mark-read"
  id: "AAMkAGR..."
```

## Mark an Email as Unread

> "Mark it as unread — I need to come back to that"

```
tool: update-email
params:
  action: "mark-unread"
  id: "AAMkAGR..."
```

## Flag an Email for Follow-Up

> "Flag that email for follow-up"

```
tool: update-email
params:
  action: "flag"
  id: "AAMkAGR..."
```

## Set a Due Date

> "Flag it with a due date of next Friday"

```
tool: update-email
params:
  action: "flag"
  id: "AAMkAGR..."
  dueDateTime: "2026-03-06T17:00:00Z"
```

Add a start date to define a follow-up window:

```
tool: update-email
params:
  action: "flag"
  id: "AAMkAGR..."
  startDateTime: "2026-03-04T09:00:00Z"
  dueDateTime: "2026-03-06T17:00:00Z"
```

## Mark a Flag as Complete

> "Mark that flagged email as done"

```
tool: update-email
params:
  action: "complete"
  id: "AAMkAGR..."
```

## Clear a Flag

> "Remove the flag from that email"

```
tool: update-email
params:
  action: "unflag"
  id: "AAMkAGR..."
```

## Bulk Operations

Flag, unflag, or complete multiple emails at once using `ids`:

```
tool: update-email
params:
  action: "flag"
  ids: ["AAMkAGR1...", "AAMkAGR2...", "AAMkAGR3..."]
  dueDateTime: "2026-03-15T09:00:00Z"
```

See [Batch Operations](../advanced/batch-operations.md) for more bulk workflows.

## Parameter Reference

| Parameter | What it does | Used with |
|-----------|-------------|-----------|
| `action` | `mark-read`, `mark-unread`, `flag`, `unflag`, `complete` | All |
| `id` | Single email ID | All actions |
| `ids` | Array of email IDs (batch) | `flag`, `unflag`, `complete` |
| `dueDateTime` | Follow-up due date (ISO 8601) | `flag` |
| `startDateTime` | Follow-up start date (ISO 8601) | `flag` |

## Tips

- Use `search-emails` with `unreadOnly: true` to find unread emails
- Flags sync to Outlook's task/to-do list — flagged emails appear in Microsoft To Do
- Dates use ISO 8601 format: `2026-03-15T09:00:00Z`

## Related

- [Find Emails](find-emails.md) — search for emails to flag
- [Batch Operations](../advanced/batch-operations.md) — bulk flag operations
- [Tools Reference — update-email](../../quickrefs/tools-reference.md#email-6-tools)
