---
title: "How to Check Recipients Before Sending"
description: "Use mail tips to check for out-of-office, mailbox full, delivery restrictions, and other issues before sending an email."
tags: [outlook-assistant, email, how-to, mail-tips]
---

# How to Check Recipients Before Sending

Check recipients for potential delivery issues before you send — out-of-office, full mailboxes, delivery restrictions, moderation, and more. This uses Microsoft's Mail Tips API, and no other Outlook MCP server offers this feature.

## Quick Check with get-mail-tips

> "Check if sarah@company.com is available before I email her"

```
tool: get-mail-tips
params:
  recipients: ["sarah@company.com"]
```

The response shows any issues found:

```
# Mail Tips

**Recipients checked**: 1
**Warnings**: 1

### ⚠ sarah@company.com
**Warnings**: Out of Office
  **Out of Office**: I am on leave until March 8th. For urgent matters, contact james@company.com.
  *Schedule*: 2026-03-01T00:00:00 → 2026-03-08T00:00:00
```

## Check Multiple Recipients

Check a whole team before sending:

```
tool: get-mail-tips
params:
  recipients: ["sarah@company.com", "team-leads@company.com", "external@partner.org"]
```

You can also pass recipients as a comma-separated string:

```
tool: get-mail-tips
params:
  recipients: "sarah@company.com, team-leads@company.com"
```

## Combine with Dry Run

For a complete pre-send review, use `checkRecipients` with `dryRun` on the send-email tool:

```
tool: send-email
params:
  to: "sarah@company.com, james@company.com"
  subject: "Project Update"
  body: "Hi team, here's the latest..."
  dryRun: true
  checkRecipients: true
```

This returns mail tips warnings followed by the email preview — review both before approving the send.

## What Mail Tips Check

| Check | What It Means |
|-------|--------------|
| **Out of Office** | Recipient has an auto-reply set. Shows their message and schedule. |
| **Mailbox Full** | Recipient's mailbox is full — delivery may fail. |
| **Custom Mail Tip** | Admin-configured notice (e.g. "This mailbox is monitored by IT"). |
| **Delivery Restricted** | You're not allowed to send to this recipient (e.g. restricted distribution group). |
| **Moderated** | Messages to this recipient require approval before delivery. |
| **External** | Recipient is outside your organisation — be mindful of sensitive content. |
| **Max Message Size** | Maximum message size the recipient can receive. |
| **Group Members** | For distribution groups: total members and how many are external. |

## Filter Specific Tip Types

By default, all tip types are checked. To check only specific types:

```
tool: get-mail-tips
params:
  recipients: ["team-leads@company.com"]
  tipTypes: "automaticReplies,mailboxFullStatus"
```

Available types: `automaticReplies`, `mailboxFullStatus`, `customMailTip`, `externalMemberCount`, `totalMemberCount`, `maxMessageSize`, `deliveryRestriction`, `moderationStatus`, `recipientScope`, `recipientSuggestions`.

## Interpreting Results

- **No issues detected** (✓) — safe to send
- **Out of Office** (⚠) — consider waiting or contacting their backup
- **Mailbox Full** (⚠) — email may bounce; try another channel
- **Delivery Restricted** (⚠) — you likely can't send to this address; check with your admin
- **External** — informational; no action needed unless sharing sensitive content
- **Moderated** — your email will be delayed until approved

## Parameter Reference

| Parameter | What it does | Default |
|-----------|-------------|---------|
| `recipients` | Email addresses to check (array or comma-separated string) | **(required)** |
| `tipTypes` | Comma-separated tip types to request | All types |

## Tips

- Check recipients before important or time-sensitive emails
- Use `checkRecipients: true` + `dryRun: true` on `send-email` for the most thorough pre-send review
- Mail tips use the existing `Mail.Read` scope — no additional permissions needed
- Results are most detailed for recipients within your organisation

## Related

- [Send Email Safely](send-email-safely.md) — dry-run, rate limiting, recipient allowlist
- [Find Contacts and People](../contacts/find-contacts-and-people.md) — search for the right recipient
- [Tools Reference — get-mail-tips](../../quickrefs/tools-reference.md#get-mail-tips)
