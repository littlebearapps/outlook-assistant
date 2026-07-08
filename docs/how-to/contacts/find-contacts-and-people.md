---
title: "How to Find Contacts and People"
description: "Search your contacts, organisational directory, and recent communications to find people quickly."
tags: [outlook-assistant, contacts, how-to]
---

# How to Find Contacts and People

Find people across your personal contacts, company directory, and recent email history using two different search tools.

## Search by Relevance (People API)

The `search-people` tool searches broadly — your contacts, organisational directory, and people you've recently communicated with:

> "Find Sarah from marketing"

```
tool: search-people
params:
  query: "Sarah"
```

> "Who do I know at Contoso?"

```
tool: search-people
params:
  query: "Contoso"
  count: 10
```

Results are ranked by relevance — people you interact with frequently appear first.

## Find Managers and Direct Reports

On Microsoft 365 work/school accounts, `search-people` can also read organisation
hierarchy:

```
tool: search-people
params:
  action: "manager"
```

```
tool: search-people
params:
  action: "directReports"
  userId: "person@company.com"
```

Org hierarchy lookup is not available for personal Outlook.com accounts. Your
Azure app registration may also need the delegated Microsoft Graph
`User.Read.All` permission; if you add that permission later, delete the token
file and authenticate again so Microsoft issues a token with the new scope.

## Search Your Contact Book

The `manage-contact` tool searches only your personal contacts:

> "Search my contacts for John Smith"

```
tool: manage-contact
params:
  action: "search"
  query: "john smith"
```

## List All Contacts

> "Show me all my contacts"

```
tool: manage-contact
params:
  action: "list"
```

Control the number returned:

```
tool: manage-contact
params:
  action: "list"
  count: 100
```

## Which Tool Should I Use?

| Tool | Searches | Best for |
|------|----------|----------|
| `search-people` | Contacts + directory + recent emails; work/school hierarchy actions | Finding anyone you've interacted with; checking manager/direct reports |
| `manage-contact` (search) | Personal contacts only | Looking up saved contact details |

Use `search-people` when you're not sure where the person is — it casts a wider net. Use `manage-contact` when you know the person is in your contact book and want their full details.

## Tips

- `search-people` is read-only and auto-approved — fast for quick lookups
- People API results include job titles and departments from your organisation's directory
- For managing contacts (create, update, delete), see [Manage Contacts](manage-contacts.md)

## Related

- [Manage Contacts](manage-contacts.md) — create, update, and delete contacts
- [Find Emails](../email/find-emails.md) — search emails from a specific person
- [Tools Reference — search-people](../../quickrefs/tools-reference.md#contacts-2-tools)
