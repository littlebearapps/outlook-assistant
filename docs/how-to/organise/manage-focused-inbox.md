---
title: "How to Manage Focused Inbox"
description: "Force specific senders into Focused or Other to control which emails surface by default."
tags: [outlook-mcp, organise, how-to]
---

# How to Manage Focused Inbox

Control which senders always appear in your Focused tab and which get routed to Other.

## View Current Overrides

> "Show me my Focused Inbox settings"

```
tool: manage-focused-inbox
params:
  action: "list"
```

## Force a Sender to Focused

> "Always show emails from sarah@company.com in Focused"

```
tool: manage-focused-inbox
params:
  action: "set"
  emailAddress: "sarah@company.com"
  classifyAs: "focused"
```

## Force a Sender to Other

> "Move newsletters from marketing@example.com to Other"

```
tool: manage-focused-inbox
params:
  action: "set"
  emailAddress: "marketing@example.com"
  classifyAs: "other"
```

## Add a Display Name

Optionally include the sender's name for reference:

```
tool: manage-focused-inbox
params:
  action: "set"
  emailAddress: "sarah@company.com"
  name: "Sarah Jones"
  classifyAs: "focused"
```

## Remove an Override

> "Stop overriding Focused Inbox for that newsletter"

```
tool: manage-focused-inbox
params:
  action: "delete"
  emailAddress: "marketing@example.com"
```

## Parameter Reference

| Parameter | What it does | Used with |
|-----------|-------------|-----------|
| `action` | `list`, `set`, or `delete` | All |
| `emailAddress` | Sender email address | `set`, `delete` |
| `name` | Sender display name (optional) | `set` |
| `classifyAs` | `focused` or `other` | `set` |

## Tips

- Focused Inbox is an Exchange Online / Outlook.com feature — it may not be available on all account types
- Overrides apply to future emails from that sender, not retroactively
- Use this alongside inbox rules for comprehensive email sorting

## Related

- [Create Inbox Rules](create-inbox-rules.md) — automated email sorting
- [Use Categories](use-categories.md) — colour-code emails for organisation
- [Tools Reference — manage-focused-inbox](../../quickrefs/tools-reference.md#categories-3-tools)
