---
title: "How to Organise Your Inbox with Folders"
description: "List, create, and manage mail folders, move emails between folders, and check folder statistics."
tags: [outlook-mcp, organise, how-to]
---

# How to Organise Your Inbox with Folders

Create folders to organise your email, move messages between folders, and check folder statistics.

## List Your Folders

> "Show me all my email folders"

```
tool: folders
params:
  action: "list"
```

To include email counts:

```
tool: folders
params:
  action: "list"
  includeItemCounts: true
```

To see nested child folders:

```
tool: folders
params:
  action: "list"
  includeChildren: true
```

![Folder list output showing folder hierarchy](../../assets/screenshots/organise-with-folders-01.png)

## Create a New Folder

> "Create a folder called 'Project Alpha'"

```
tool: folders
params:
  action: "create"
  name: "Project Alpha"
```

Create a subfolder under an existing folder:

```
tool: folders
params:
  action: "create"
  name: "Invoices"
  parentFolder: "Finance"
```

## Move Emails to a Folder

> "Move those 3 emails from Sarah to the Project Alpha folder"

```
tool: folders
params:
  action: "move"
  emailIds: "AAMkAGR1...,AAMkAGR2...,AAMkAGR3..."
  targetFolder: "Project Alpha"
```

Email IDs are comma-separated. By default, emails are moved from the inbox. Specify `sourceFolder` if they're elsewhere:

```
tool: folders
params:
  action: "move"
  emailIds: "AAMkAGR1..."
  targetFolder: "Archive"
  sourceFolder: "sentitems"
```

## Get Folder Statistics

> "How many emails are in my inbox?"

```
tool: folders
params:
  action: "stats"
  folder: "inbox"
```

This returns total items, unread count, and folder size — useful for planning pagination or understanding email volume.

## Delete a Folder

> "Delete the old Project Alpha folder"

```
tool: folders
params:
  action: "delete"
  folderName: "Project Alpha"
```

You can also delete by ID:

```
tool: folders
params:
  action: "delete"
  folderId: "AAMkAGR..."
```

Protected folders (Inbox, Drafts, Sent Items, Deleted Items, Junk Email, Archive, Outbox) cannot be deleted.

## Parameter Reference

| Parameter | What it does | Used with |
|-----------|-------------|-----------|
| `action` | `list`, `create`, `move`, `stats`, or `delete` | All |
| `includeItemCounts` | Show total/unread counts | `list` |
| `includeChildren` | Show nested subfolders | `list` |
| `name` | New folder name | `create` |
| `parentFolder` | Parent folder for subfolder | `create` |
| `emailIds` | Comma-separated email IDs | `move` |
| `targetFolder` | Destination folder name | `move` |
| `sourceFolder` | Source folder (default: inbox) | `move` |
| `folder` | Folder to get stats for | `stats` |
| `folderId` | Folder ID to delete | `delete` |
| `folderName` | Folder name to delete (resolved to ID) | `delete` |

## Tips

- Use folder stats to check volume before searching a folder
- Combine folder creation with inbox rules for automatic sorting — see [Create Inbox Rules](create-inbox-rules.md)
- Common built-in folders: `inbox`, `sentitems`, `drafts`, `deleteditems`, `archive`, `junkemail`

## Related

- [Create Inbox Rules](create-inbox-rules.md) — automatically sort incoming mail into folders
- [Find Emails](../email/find-emails.md) — search within specific folders
- [Batch Operations](../advanced/batch-operations.md) — move multiple emails at once
- [Tools Reference — folders](../../quickrefs/tools-reference.md#folder-1-tool)
