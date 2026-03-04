---
title: "How to Access Shared Mailboxes"
description: "Read emails from shared mailboxes your account has been granted access to, such as team inboxes or service accounts."
tags: [outlook-mcp, advanced, how-to]
---

# How to Access Shared Mailboxes

Read emails from shared mailboxes like team inboxes, support queues, or service accounts that your Microsoft 365 account has access to.

## Read from a Shared Mailbox

> "Check the support inbox for new emails"

```
tool: access-shared-mailbox
params:
  sharedMailbox: "support@company.com"
```

This returns the 25 most recent emails from the shared mailbox's inbox.

## Browse a Specific Folder

```
tool: access-shared-mailbox
params:
  sharedMailbox: "support@company.com"
  folder: "Escalated"
```

## Control the Number of Results

```
tool: access-shared-mailbox
params:
  sharedMailbox: "team@company.com"
  count: 10
  outputVerbosity: "minimal"
```

![Shared mailbox email list with mailbox name in header](../../assets/screenshots/access-shared-mailboxes-01.png)

## Required Permissions

Your Azure app registration needs the `Mail.Read.Shared` permission:

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → your Outlook MCP app
2. Under **API permissions**, add Microsoft Graph delegated permission: `Mail.Read.Shared`
3. Grant admin consent if required by your organisation

Your Microsoft account must also have been granted access to the shared mailbox by your Exchange administrator.

## Parameter Reference

| Parameter | What it does | Default |
|-----------|-------------|---------|
| `sharedMailbox` | Email address of the shared mailbox (**required**) | — |
| `folder` | Folder to read from | `inbox` |
| `count` | Number of emails to return (max 50) | 25 |
| `outputVerbosity` | `minimal`, `standard`, or `full` | `standard` |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Access denied" or 403 error | Missing `Mail.Read.Shared` permission | Add the permission in Azure Portal |
| "Mailbox not found" | Incorrect email address or no access granted | Verify the address and check with your Exchange admin |
| Empty results | Mailbox is empty or folder doesn't exist | Try `folder: "inbox"` to confirm access |

## Tips

- This tool is read-only — you can't send from a shared mailbox through Outlook MCP
- Use `outputVerbosity: "minimal"` for quick checks on high-volume shared inboxes
- Auto-approved by Claude Code (read-only tool)

## Related

- [Find Emails](../email/find-emails.md) — search your personal mailbox
- [Verify Your Connection](../getting-started/verify-your-connection.md) — check permissions
- [Azure Setup Guide](../../guides/azure-setup.md) — managing app permissions
- [Tools Reference — access-shared-mailbox](../../quickrefs/tools-reference.md#advanced-2-tools)
