---
title: "How to Automate Your Inbox"
description: "Combine rules, categories, folders, and Focused Inbox to build a complete inbox management system through your AI assistant."
tags: [outlook-mcp, organise, how-to, automation]
---

# How to Automate Your Inbox

Outlook Assistant's organisation tools work together — rules sort incoming mail, categories add visual labels, folders provide structure, and Focused Inbox controls what surfaces first. This guide shows how to combine them for complete inbox automation.

## The Building Blocks

| Tool | What it does | Runs when |
|------|-------------|-----------|
| `folders` | Create folder structure | Once (setup) |
| `manage-rules` | Auto-sort incoming mail | Every incoming email (server-side) |
| `manage-category` | Create colour-coded labels | Once (setup) |
| `apply-category` | Tag emails with labels | On-demand or via agent workflow |
| `manage-focused-inbox` | Surface important senders | Every incoming email (ML + overrides) |

## Step 1: Design Your Folder Structure

Create folders for your main email categories:

> "Create folders for Projects, Finance, and Notifications"

```
tool: folders
params:
  action: "create"
  name: "Projects"
```

```
tool: folders
params:
  action: "create"
  name: "Finance"
```

```
tool: folders
params:
  action: "create"
  name: "Notifications"
```

## Step 2: Create Sorting Rules

Set up rules to automatically route incoming emails:

> "Create a rule to move GitHub notification emails to my Notifications folder"

```
tool: manage-rules
params:
  action: "create"
  name: "GitHub Notifications"
  fromAddresses: "notifications@github.com"
  moveToFolder: "Notifications"
  markAsRead: true
```

> "Create a rule for invoices"

```
tool: manage-rules
params:
  action: "create"
  name: "Invoices to Finance"
  subjectContains: "invoice"
  moveToFolder: "Finance"
```

Rules run server-side — they work even when Outlook is not open. Use `sequence` to control which rules run first (lower number = higher priority).

## Step 3: Set Up Categories for Cross-Cutting Labels

Categories work across folders — an email in your Finance folder can also have an "Urgent" category:

> "Create colour categories for Urgent, Waiting, and Reference"

```
tool: manage-category
params:
  action: "create"
  displayName: "Urgent"
  color: "preset0"
```

```
tool: manage-category
params:
  action: "create"
  displayName: "Waiting"
  color: "preset3"
```

```
tool: manage-category
params:
  action: "create"
  displayName: "Reference"
  color: "preset7"
```

Colour presets: `preset0` (Red), `preset1` (Orange), `preset3` (Yellow), `preset4` (Green), `preset7` (Blue), `preset8` (Purple).

## Step 4: Configure Focused Inbox Overrides

Force important senders into Focused and route noise to Other:

> "Make sure emails from my CEO always appear in Focused"

```
tool: manage-focused-inbox
params:
  action: "set"
  emailAddress: "ceo@company.com"
  classifyAs: "focused"
```

> "Route newsletter emails to Other"

```
tool: manage-focused-inbox
params:
  action: "set"
  emailAddress: "newsletter@service.com"
  classifyAs: "other"
```

> **Note**: Focused Inbox is only available on work/school Microsoft 365 accounts.

## Step 5: Apply Categories to Existing Emails

Use search + batch categorisation to tag emails already in your inbox:

> "Find all emails from the finance team and tag them as Reference"

```
tool: search-emails
params:
  from: "finance@company.com"
```

Then batch-apply the category:

```
tool: apply-category
params:
  messageIds: ["id1", "id2", "id3"]
  categories: ["Reference"]
  action: "add"
```

## Putting It All Together

Here's a complete example — setting up inbox automation for a new role:

1. **Create 4 folders**: Projects, Finance, Notifications, Archive
2. **Create 3 rules**: route GitHub → Notifications, invoices → Finance, CI alerts → Notifications (all marked as read)
3. **Create 3 categories**: Urgent (red), Waiting (yellow), Reference (blue)
4. **Set 2 Focused Inbox overrides**: boss → Focused, newsletters → Other
5. **Batch-categorise**: tag existing important threads as Urgent

Ask your AI assistant: "Set up my inbox with folders for Projects, Finance, and Notifications. Create rules to sort GitHub and invoice emails. Add categories for Urgent, Waiting, and Reference."

Your assistant will use all the tools above in sequence to build the complete setup.

## Tips

- Create folders before creating rules that target them
- Rules run server-side — they work even when Outlook is not open
- Categories sync across desktop, web, and mobile Outlook
- Use `manage-rules` with `action: "list", includeDetails: true` to audit your current setup
- Combine with [batch operations](../advanced/batch-operations.md) to apply changes to existing emails

## Related

- [Organise with Folders](organise-with-folders.md) — folder management details
- [Create Inbox Rules](create-inbox-rules.md) — rule creation details
- [Use Categories](use-categories.md) — category management details
- [Manage Focused Inbox](manage-focused-inbox.md) — Focused Inbox overrides
- [Batch Operations](../advanced/batch-operations.md) — bulk processing patterns
