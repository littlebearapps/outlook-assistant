---
title: "How to Use Categories to Colour-Code Emails"
description: "Create colour-coded category labels and apply them to emails for visual organisation and filtering."
tags: [outlook-mcp, organise, how-to]
---

# How to Use Categories to Colour-Code Emails

Create named, colour-coded categories and apply them to emails for visual organisation in Outlook.

## List Existing Categories

> "Show me my email categories"

```
tool: manage-category
params:
  action: "list"
```

## Create a New Category

> "Create a red 'Urgent' category"

```
tool: manage-category
params:
  action: "create"
  displayName: "Urgent"
  color: "preset0"
```

## Available Colours

| Preset | Colour |
|--------|--------|
| `preset0` | Red |
| `preset1` | Orange |
| `preset2` | Brown |
| `preset3` | Yellow |
| `preset4` | Green |
| `preset5` | Teal |
| `preset6` | Olive |
| `preset7` | Blue |
| `preset8` | Purple |
| `preset9` | Cranberry |
| `preset10` | Steel |
| `preset11` | Dark Steel |
| `preset12` | Grey |
| `preset13` | Dark Grey |
| `preset14` | Black |
| `preset15`–`preset24` | Dark variants of the above |

## Apply a Category to an Email

> "Mark that email as Urgent"

```
tool: apply-category
params:
  messageId: "AAMkAGR..."
  categories: ["Urgent"]
```

## Apply Multiple Categories

```
tool: apply-category
params:
  messageId: "AAMkAGR..."
  categories: ["Urgent", "Project Alpha"]
  action: "add"
```

| Action | Behaviour |
|--------|-----------|
| `set` | Replace all categories with these (default) |
| `add` | Add these categories, keep existing ones |
| `remove` | Remove only these categories |

## Apply Categories in Bulk

> "Tag all these emails as Project Alpha"

```
tool: apply-category
params:
  messageIds: ["AAMkAGR1...", "AAMkAGR2...", "AAMkAGR3..."]
  categories: ["Project Alpha"]
  action: "add"
```

## Remove a Category from an Email

```
tool: apply-category
params:
  messageId: "AAMkAGR..."
  categories: ["Urgent"]
  action: "remove"
```

## Delete a Category

```
tool: manage-category
params:
  action: "delete"
  id: "category-id..."
```

## Tips

- Categories sync across Outlook desktop, web, and mobile
- Use `action: "add"` to preserve existing categories when adding new ones
- Create a consistent set of categories (e.g. by project, priority, or team) for long-term organisation

## Related

- [Manage Focused Inbox](manage-focused-inbox.md) — another organisation method
- [Batch Operations](../advanced/batch-operations.md) — bulk category operations
- [Tools Reference — manage-category](../../quickrefs/tools-reference.md#categories-3-tools)
