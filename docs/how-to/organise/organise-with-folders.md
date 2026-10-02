---
title: "How to Organise Your Inbox with Folders"
description: "List, create, and manage mail folders, move emails between folders, and check folder statistics."
tags: [outlook-assistant, organise, how-to]
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

Each folder is listed with its **full path** (e.g. `Deleted Items/Receipts`) and its ID as `[id: …]` — copy either one to address that folder in a `move`, `stats`, or `delete` call.

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

`parentFolder` also accepts a nested path (case-insensitive), e.g. `Clients/Acme`. To target the parent unambiguously by its ID, use `parentFolderId` instead.

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

### Move into a nested folder

Nested subfolders are fully addressable as of v3.9.0 — earlier versions could only resolve top-level folder names. Pass the slash-separated path (case-insensitive) as `targetFolder`:

```
tool: folders
params:
  action: "move"
  emailIds: "AAMkAGR1..."
  targetFolder: "Clients/Acme/Invoices"
```

If a bare name matches more than one folder, the tool returns the candidate paths and IDs so you can disambiguate. To skip name resolution entirely, target the destination by its ID with `targetFolderId` (copy it from `folders action=list`):

```
tool: folders
params:
  action: "move"
  emailIds: "AAMkAGR1..."
  targetFolderId: "AAMkAGR..."
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

`folder` accepts a well-known alias (`inbox`, `sent`, …), a nested path (e.g. `Clients/Acme`), or a bare folder name. To target a folder by its ID instead, pass `folderId`.

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

`folderName` also accepts a nested path (e.g. `Clients/Acme`); it's resolved to an ID before deletion. Protected folders (Inbox, Drafts, Sent Items, Deleted Items, Junk Email, Archive, Outbox) cannot be deleted.

On personal Outlook.com accounts, deleting a folder moves it — and everything in it — to **Deleted Items**, where it stays recoverable until you empty Deleted Items. On Microsoft 365 / Exchange accounts, retention or hard-delete policies may remove it permanently instead, so check your organisation's policy before deleting.

## Parameter Reference

| Parameter | What it does | Used with |
|-----------|-------------|-----------|
| `action` | `list`, `create`, `move`, `stats`, or `delete` | All |
| `includeItemCounts` | Show total/unread counts | `list` |
| `includeChildren` | Show nested subfolders | `list` |
| `name` | New folder name | `create` |
| `parentFolder` | Parent folder name or path for subfolder | `create` |
| `parentFolderId` | Parent folder ID (alternative to `parentFolder`) | `create` |
| `emailIds` | Comma-separated email IDs | `move` |
| `targetFolder` | Destination folder name or path | `move` |
| `targetFolderId` | Destination folder ID (alternative to `targetFolder`) | `move` |
| `sourceFolder` | Source folder (default: inbox) | `move` |
| `folder` | Folder to get stats for (alias, path, or name) | `stats` |
| `folderId` | Folder ID (stats or delete) | `stats`, `delete` |
| `folderName` | Folder name or path to delete (resolved to ID) | `delete` |

## Tips

- Address any folder three ways: a well-known alias (`inbox`, `archive`, `sent`, `drafts`, `deleted`, `junk`, `outbox`), a slash-separated path for nested folders (`Clients/Acme`, case-insensitive), or its ID — run `folders action=list` to copy full paths and IDs
- Nested subfolders are addressable by path as of v3.9.0; earlier versions resolved only top-level folder names
- Use folder stats to check volume before searching a folder
- Combine folder creation with inbox rules for automatic sorting — see [Create Inbox Rules](create-inbox-rules.md)
- Common built-in folders: `inbox`, `sentitems`, `drafts`, `deleteditems`, `archive`, `junkemail`

## Related

- [Create Inbox Rules](create-inbox-rules.md) — automatically sort incoming mail into folders
- [Find Emails](../email/find-emails.md) — search within specific folders
- [Batch Operations](../advanced/batch-operations.md) — move multiple emails at once
- [Tools Reference — folders](../../quickrefs/tools-reference.md#folder-1-tool)
