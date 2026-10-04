---
title: "How to Create and Manage Inbox Rules"
description: "Automate email organisation with rules that move, mark, forward, or filter incoming mail based on sender, subject, body, attachments, and more — with exceptions and dry-run preview."
tags: [outlook-assistant, organise, how-to]
---

# How to Create and Manage Inbox Rules

Set up rules to automatically sort, mark, forward, or filter incoming emails. Rules run server-side — they work even when Outlook is not open.

## List Existing Rules

> "Show me my inbox rules"

```
tool: manage-rules
params:
  action: "list"
```

For full details on conditions, actions, and exceptions:

```
tool: manage-rules
params:
  action: "list"
  includeDetails: true
```

## Create a Rule

### Basic: Sort by Sender

> "Create a rule to move GitHub notifications to a GitHub folder"

```
tool: manage-rules
params:
  action: "create"
  name: "GitHub Notifications"
  fromAddresses: "noreply@github.com, notifications@github.com"
  moveToFolder: "GitHub"
  markAsRead: true
```

### OR Logic: Multiple Subject Keywords

Use comma-separated values to match **any** of the keywords (OR logic):

> "Move emails with invoice, receipt, or payment in the subject to Finance"

```
tool: manage-rules
params:
  action: "create"
  name: "Finance Documents"
  containsSubject: "invoice, receipt, payment, statement"
  moveToFolder: "Finance"
```

### Combined Conditions

Combine multiple conditions — all must match (AND logic between different condition types):

> "Move emails with attachments that mention invoices to my Paperless folder"

```
tool: manage-rules
params:
  action: "create"
  name: "Paperless — receipts with attachments"
  containsSubject: "invoice, receipt, payment, order confirmation"
  hasAttachments: true
  moveToFolder: "Paperless"
  markAsRead: true
```

### Exceptions: Exclude Specific Senders or Subjects

Exceptions let you skip the rule for certain matches. Use `except*` parameters:

> "Move receipt emails to Paperless, but NOT from my accountant"

```
tool: manage-rules
params:
  action: "create"
  name: "Paperless — receipts (except accountant)"
  containsSubject: "invoice, receipt, payment"
  hasAttachments: true
  moveToFolder: "Paperless"
  markAsRead: true
  exceptFromAddresses: "tax@withaccounting.com"
  exceptSubjectContains: "tax return, FYI"
```

### Preview with Dry Run

Use `dryRun: true` to preview a rule without creating it:

```
tool: manage-rules
params:
  action: "create"
  name: "Test Rule"
  fromAddresses: "alerts@example.com"
  moveToFolder: "Alerts"
  dryRun: true
```

### Forward or Redirect Matching Emails

```
tool: manage-rules
params:
  action: "create"
  name: "Forward client emails"
  fromAddresses: "client@company.com"
  forwardTo: "team@company.com"
  stopProcessingRules: true
```

If `OUTLOOK_ALLOWED_RECIPIENTS` is set and any `forwardTo` or `redirectTo` address isn't on it, the whole rule is refused with an error naming the blocked addresses. Nothing is created, and a rule is never saved with the blocked forwarding quietly dropped. The same applies to `update`, and a `dryRun` reports that the rule would be refused.

### Assign Categories

```
tool: manage-rules
params:
  action: "create"
  name: "Tag urgent emails"
  importance: "high"
  sentToMe: true
  assignCategories: "Urgent, Follow Up"
```

### Auto-Delete Noise

Move matching emails to Deleted Items (not permanent deletion):

```
tool: manage-rules
params:
  action: "create"
  name: "Delete marketing noise"
  senderContains: "marketing, promo, newsletter"
  deleteMessage: true
```

## Update an Existing Rule

Modify a rule by name or ID. Conditions and actions use **replace** semantics — provide all desired values, not just changes.

> "Add exceptions to my receipts rule"

```
tool: manage-rules
params:
  action: "update"
  ruleName: "Paperless — receipts with attachments"
  exceptFromAddresses: "tax@withaccounting.com, admin@company.com"
```

> "Rename and disable a rule"

```
tool: manage-rules
params:
  action: "update"
  ruleName: "Old Rule Name"
  name: "New Rule Name"
  isEnabled: false
```

> "Preview changes before applying"

```
tool: manage-rules
params:
  action: "update"
  ruleName: "My Rule"
  containsSubject: "urgent, critical, asap"
  dryRun: true
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

```
tool: manage-rules
params:
  action: "delete"
  ruleName: "GitHub Notifications"
```

## Available Conditions

All string conditions accept comma-separated values for OR logic.

| Parameter | What it matches | Example |
|-----------|----------------|---------|
| `fromAddresses` | Exact sender emails | `"boss@example.com, ceo@example.com"` |
| `sentToAddresses` | Exact recipient emails | `"team@example.com"` |
| `containsSubject` | Subject keywords (OR) | `"invoice, receipt, payment"` |
| `bodyContains` | Body text keywords (OR) | `"urgent, action required"` |
| `bodyOrSubjectContains` | Body OR subject keywords | `"deadline, overdue"` |
| `senderContains` | Partial sender match | `"example.com, noreply"` |
| `recipientContains` | Partial recipient match | `"team, support"` |
| `hasAttachments` | Has file attachments | `true` |
| `importance` | Email importance level | `"high"`, `"normal"`, `"low"` |
| `sensitivity` | Email sensitivity | `"confidential"`, `"private"` |
| `sentToMe` | I am a recipient | `true` |
| `sentOnlyToMe` | I am the only recipient | `true` |
| `sentCcMe` | I am in CC | `true` |
| `isAutomaticReply` | Auto-reply/OOO message | `true` |

## Available Actions

| Parameter | What it does | Example |
|-----------|-------------|---------|
| `moveToFolder` | Move to folder (name, nested path, or folder ID) | `"Archive"`, `"Triage/Delete"` |
| `copyToFolder` | Copy to folder (name, nested path, or folder ID) | `"Backup"`, `"Projects/Backup"` |
| `markAsRead` | Mark as read | `true` |
| `markImportance` | Set importance level | `"high"`, `"low"` |
| `forwardTo` | Forward to recipients | `"user@example.com"` |
| `redirectTo` | Redirect (appears from original sender) | `"alias@example.com"` |
| `assignCategories` | Assign Outlook categories | `"Work, Important"` |
| `stopProcessingRules` | Stop evaluating further rules | `true` |
| `deleteMessage` | Move to Deleted Items | `true` |

## Available Exceptions

Exceptions use the same conditions with `except` prefix. The rule is skipped when any exception matches.

| Parameter | Excludes when |
|-----------|--------------|
| `exceptFromAddresses` | Sender matches these emails |
| `exceptSubjectContains` | Subject contains these keywords |
| `exceptSenderContains` | Sender partially matches |
| `exceptBodyContains` | Body contains these keywords |
| `exceptHasAttachments` | Email has attachments |

## Full Parameter Reference

| Parameter | Used with | Description |
|-----------|-----------|-------------|
| `action` | All | `list`, `create`, `update`, `reorder`, `delete` |
| `includeDetails` | `list` | Show conditions, actions, exceptions |
| `name` | `create`, `update` | Rule name (required for create, rename for update) |
| `dryRun` | `create`, `update` | Preview without committing |
| `isEnabled` | `create`, `update` | Enable/disable (default: true) |
| `sequence` | `create`, `reorder` | Execution order (lower = first) |
| `ruleName` | `update`, `reorder`, `delete` | Identify rule by name |
| `ruleId` | `update`, `delete` | Identify rule by ID |
| All conditions | `create`, `update` | See tables above |
| All actions | `create`, `update` | See tables above |
| All exceptions | `create`, `update` | See tables above |

## Safety

- **`dryRun`**: Preview rules before creating or updating. A dry run doesn't count towards the rate limit, and still previews once the limit is reached.
- **Rate limiting**: every change (create, update, reorder and delete) counts towards one per-session cap, set with `OUTLOOK_MAX_MANAGE_RULES_PER_SESSION` (or `OUTLOOK_MAX_EMAILS_PER_SESSION` when that isn't set). Once it's reached, further changes return a "Rate limit reached" error until the server restarts. `list` is never counted.
- **Recipient allowlist**: `forwardTo` and `redirectTo` are checked against `OUTLOOK_ALLOWED_RECIPIENTS`. If any address is blocked, the whole rule (or update) is refused rather than saved without the forwarding.
- **No permanent delete**: `deleteMessage` moves to Deleted Items (recoverable). Permanent deletion is not available via this tool.
- **Replace semantics on update**: When updating conditions or actions, the entire section is replaced. Use `dryRun` to preview before applying.

## Tips

- Create the destination folder first with the [folders tool](organise-with-folders.md) before creating a rule that targets it
- Use `markAsRead: true` for high-volume automated notifications (CI/CD, alerts)
- Use `stopProcessingRules: true` on catch-all rules to prevent later rules from overriding
- Use `dryRun: true` to preview complex rules before creating
- Comma-separated string conditions use OR logic — any keyword match triggers the rule
- Different condition types use AND logic — all conditions must be true

## Related

- [Organise with Folders](organise-with-folders.md) — create folders for your rules to target
- [Automate Your Inbox](automate-your-inbox.md) — combine rules, categories, and Focused Inbox
- [Manage Focused Inbox](manage-focused-inbox.md) — another way to sort important vs unimportant mail
- [Tools Reference — manage-rules](../../quickrefs/tools-reference.md#rules-1-tool)
