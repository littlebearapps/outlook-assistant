---
title: "How to Perform Batch Email Operations"
description: "Flag, export, move, or categorise multiple emails at once using batch parameters."
tags: [outlook-mcp, advanced, how-to]
---

# How to Perform Batch Email Operations

Process multiple emails in a single operation — flag them, move them, export them, or apply categories in bulk.

## Batch Flag Emails

Flag multiple emails for follow-up at once:

```
tool: update-email
params:
  action: "flag"
  ids: ["AAMkAGR1...", "AAMkAGR2...", "AAMkAGR3..."]
  dueDateTime: "2026-03-15T09:00:00Z"
```

Batch unflag:

```
tool: update-email
params:
  action: "unflag"
  ids: ["AAMkAGR1...", "AAMkAGR2...", "AAMkAGR3..."]
```

Batch complete flagged emails:

```
tool: update-email
params:
  action: "complete"
  ids: ["AAMkAGR1...", "AAMkAGR2..."]
```

## Batch Move Emails

Move multiple emails to a folder:

```
tool: folders
params:
  action: "move"
  emailIds: "AAMkAGR1...,AAMkAGR2...,AAMkAGR3..."
  targetFolder: "Archive"
```

Note: `emailIds` in the folders tool is a comma-separated string, not an array.

## Batch Export Emails

Export multiple emails by ID:

```
tool: export
params:
  target: "messages"
  emailIds: ["AAMkAGR1...", "AAMkAGR2...", "AAMkAGR3..."]
  format: "markdown"
  outputDir: "/tmp/export/"
```

Or export by search criteria:

```
tool: export
params:
  target: "messages"
  searchQuery:
    from: "finance@company.com"
    receivedAfter: "2026-01-01"
    maxResults: 50
  format: "json"
  outputDir: "/tmp/finance-export/"
```

## Batch Apply Categories

Apply categories to multiple emails:

```
tool: apply-category
params:
  messageIds: ["AAMkAGR1...", "AAMkAGR2...", "AAMkAGR3..."]
  categories: ["Project Alpha", "Urgent"]
  action: "add"
```

Remove a category from multiple emails:

```
tool: apply-category
params:
  messageIds: ["AAMkAGR1...", "AAMkAGR2..."]
  categories: ["Urgent"]
  action: "remove"
```

## Batch Operations Summary

| Operation | Tool | ID parameter | Format |
|-----------|------|-------------|--------|
| Flag/unflag/complete | `update-email` | `ids` | Array of strings |
| Move to folder | `folders` | `emailIds` | Comma-separated string |
| Export | `export` | `emailIds` | Array of strings |
| Apply categories | `apply-category` | `messageIds` | Array of strings |

## Tips

- Use `search-emails` first to find the email IDs you want to process
- The `export` tool's `searchQuery` option lets you skip the search step entirely
- Combine search + batch for workflows: "Find all unread emails from Sarah and flag them for follow-up"

## Related

- [Flag Emails for Follow-Up](../email/flag-emails-for-follow-up.md) — individual flag operations
- [Organise with Folders](../organise/organise-with-folders.md) — folder management
- [Export Emails](../email/export-emails.md) — single email export
- [Use Categories](../organise/use-categories.md) — category management
