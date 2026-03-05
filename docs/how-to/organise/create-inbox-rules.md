---
title: "How to Create and Manage Inbox Rules"
description: "Automate email organisation with rules that move, mark, or filter incoming mail based on sender, subject, or attachments."
tags: [outlook-mcp, organise, how-to]
---

# How to Create and Manage Inbox Rules

Set up rules to automatically sort, mark, or filter incoming emails based on sender, subject, or other conditions.

## List Existing Rules

> "Show me my inbox rules"

```
tool: manage-rules
params:
  action: "list"
```

For full details on conditions and actions:

```
tool: manage-rules
params:
  action: "list"
  includeDetails: true
```

## Create a Rule to Sort by Sender

> "Create a rule to move GitHub notifications to a GitHub folder"

```
tool: manage-rules
params:
  action: "create"
  name: "GitHub Notifications"
  fromAddresses: "noreply@github.com"
  moveToFolder: "GitHub"
```

## Create a Rule Based on Subject

> "Move emails with 'invoice' in the subject to Finance"

```
tool: manage-rules
params:
  action: "create"
  name: "Invoices"
  containsSubject: "invoice"
  moveToFolder: "Finance"
  markAsRead: true
```

## Create a Rule for Emails with Attachments

```
tool: manage-rules
params:
  action: "create"
  name: "Attachments to Review"
  hasAttachments: true
  fromAddresses: "reports@company.com"
  moveToFolder: "Reports"
```

## Reorder Rule Priority

Rules execute in sequence order — lower numbers run first. If two rules conflict, the first one wins.

> "Make the GitHub rule run first"

```
tool: manage-rules
params:
  action: "reorder"
  ruleName: "GitHub Notifications"
  sequence: 1
```

## Delete a Rule

> "Delete the GitHub Notifications rule"

```
tool: manage-rules
params:
  action: "delete"
  ruleName: "GitHub Notifications"
```

You can also delete by ID:

```
tool: manage-rules
params:
  action: "delete"
  ruleId: "rule-id..."
```

## Parameter Reference

| Parameter | What it does | Used with |
|-----------|-------------|-----------|
| `action` | `list`, `create`, `reorder`, or `delete` | All |
| `includeDetails` | Show full conditions/actions | `list` |
| `name` | Rule name | `create` |
| `fromAddresses` | Sender email addresses (comma-separated) | `create` |
| `containsSubject` | Subject must contain this text | `create` |
| `hasAttachments` | Match emails with attachments | `create` |
| `moveToFolder` | Move matching emails to this folder | `create` |
| `markAsRead` | Auto-mark as read | `create` |
| `isEnabled` | Enable rule after creation (default: true) | `create` |
| `sequence` | Execution order — lower runs first (default: 100) | `create`, `reorder` |
| `ruleName` | Rule name | `reorder`, `delete` |
| `ruleId` | Rule ID | `delete` |

## Tips

- Create the destination folder first with the [folders tool](organise-with-folders.md) before creating a rule that targets it
- Use `markAsRead: true` for high-volume automated notifications (CI/CD, alerts)
- Rules run server-side — they work even when Outlook isn't open

## Related

- [Organise with Folders](organise-with-folders.md) — create folders for your rules to target
- [Manage Focused Inbox](manage-focused-inbox.md) — another way to sort important vs unimportant mail
- [Tools Reference — manage-rules](../../quickrefs/tools-reference.md#rules-1-tool)
