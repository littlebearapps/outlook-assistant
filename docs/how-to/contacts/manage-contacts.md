---
title: "How to Manage Your Contacts"
description: "Create, view, update, and delete contact records in your Outlook contacts book."
tags: [outlook-assistant, contacts, how-to]
---

# How to Manage Your Contacts

Add, view, update, and delete entries in your Outlook personal contacts book.

## View a Contact's Full Details

```
tool: manage-contact
params:
  action: "get"
  id: "contact-id..."
```

## Create a New Contact

> "Add a contact for Jane Smith at jane@company.com"

```
tool: manage-contact
params:
  action: "create"
  displayName: "Jane Smith"
  email: "jane@company.com"
```

With additional details:

```
tool: manage-contact
params:
  action: "create"
  displayName: "Jane Smith"
  email: "jane@company.com"
  mobilePhone: "+61 400 000 000"
  companyName: "Acme Corp"
  jobTitle: "Product Manager"
  notes: "Met at the Melbourne conference"
```

If `displayName` contains a space, it's automatically split into first and last name.

## Update an Existing Contact

> "Update Jane's email to jane.smith@newcompany.com"

```
tool: manage-contact
params:
  action: "update"
  id: "contact-id..."
  email: "jane.smith@newcompany.com"
```

Only the fields you specify are updated — existing fields are preserved.

## Delete a Contact

```
tool: manage-contact
params:
  action: "delete"
  id: "contact-id..."
```

A deleted contact doesn't go to **Deleted Items**, and Microsoft Graph doesn't document a way to restore it (Outlook's **Recover deleted items** may work for a limited time, but don't rely on it), so treat it as permanent. Add `dryRun: true` to check which contact an ID belongs to first. Nothing is deleted; the preview reads:

```
DRY RUN — nothing was changed.

Deletes contact 'John Smith' (john@example.com; Acme Corp).
```

## Parameter Reference

| Parameter | What it does | Used with |
|-----------|-------------|-----------|
| `action` | `list`, `search`, `get`, `create`, `update`, `delete` | All |
| `id` | Contact ID | `get`, `update`, `delete` |
| `displayName` | Full name | `create`, `update` |
| `email` | Primary email address | `create`, `update` |
| `mobilePhone` | Mobile phone number | `create`, `update` |
| `companyName` | Company name | `create`, `update` |
| `jobTitle` | Job title | `create`, `update` |
| `notes` | Personal notes | `create`, `update` |
| `query` | Search text | `search` |
| `count` | Number of results | `list`, `search` |
| `dryRun` | Preview which contact would be deleted, without deleting it | `delete` |

## Tips

- At least `displayName` or `email` is required when creating a contact
- Use `search-people` for broader searches (directory + recent contacts) — see [Find Contacts and People](find-contacts-and-people.md)
- Contacts sync across Outlook desktop, web, and mobile

## Related

- [Find Contacts and People](find-contacts-and-people.md) — search for people across all sources
- [Tools Reference — manage-contact](../../quickrefs/tools-reference.md#contacts-2-tools)
