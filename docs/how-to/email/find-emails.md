---
title: "How to Find Emails"
description: "Search your inbox by sender, subject, date range, or keywords — including across all folders."
tags: [outlook-mcp, email, how-to]
---

# How to Find Emails

Search and filter your emails to find exactly what you need. With no search terms, Outlook MCP lists your most recent messages.

## List Recent Emails

Ask Claude to show your latest emails:

> "Show me my recent emails"

```
tool: search-emails
```

With no parameters, this returns the 25 most recent emails from your inbox.

## Search by Sender

> "Find emails from sarah@company.com"

```
tool: search-emails
params:
  from: "sarah@company.com"
```

You can also search by partial name:

```
tool: search-emails
params:
  from: "Sarah"
```

## Search by Subject

> "Find emails about the quarterly report"

```
tool: search-emails
params:
  subject: "quarterly report"
```

The `subject` parameter uses an OData filter (`contains(subject, ...)`) which works reliably on both personal and work/school accounts.

## Search by Keywords

> "Search my emails for budget approval"

```
tool: search-emails
params:
  query: "budget approval"
```

The `query` parameter searches across subject, body, and other fields.

> **Personal accounts**: Free-text `query` search uses Microsoft's `$search` API, which may not work on personal Outlook.com accounts. If you get no results, use the structured filter parameters (`subject`, `from`, `to`, `receivedAfter`) instead. See [Account Compatibility](../../../README.md#account-compatibility) for details.

## Filter by Date Range

> "Show me emails from January 2026"

```
tool: search-emails
params:
  receivedAfter: "2026-01-01"
  receivedBefore: "2026-02-01"
```

Dates use ISO 8601 format (`YYYY-MM-DD` or full `YYYY-MM-DDTHH:MM:SSZ`).

## Find Unread Emails Only

> "Show me my unread emails"

```
tool: search-emails
params:
  unreadOnly: true
```

## Find Emails with Attachments

> "Find emails with attachments from this month"

```
tool: search-emails
params:
  hasAttachments: true
  receivedAfter: "2026-03-01"
```

## Search a Specific Folder

By default, searches look in the inbox. To search another folder:

> "Show me my sent emails to john@company.com"

```
tool: search-emails
params:
  folder: "sentitems"
  to: "john@company.com"
```

Common folder names: `inbox`, `sentitems`, `drafts`, `deleteditems`, `archive`, `junkemail`.

## Search Across All Folders

> "Search all my folders for the contract document"

```
tool: search-emails
params:
  query: "contract document"
  searchAllFolders: true
```

## Combine Filters

Filters stack — use multiple parameters together:

> "Find unread emails from Sarah with attachments received this week"

```
tool: search-emails
params:
  from: "Sarah"
  unreadOnly: true
  hasAttachments: true
  receivedAfter: "2026-02-24"
```

## Control the Number of Results

```
tool: search-emails
params:
  count: 10
```

| Mode | Default count | Maximum |
|------|--------------|---------|
| List (no query) | 25 | 50 |
| Search | 10 | 50 |

![Claude returning search results with email list](../../assets/screenshots/find-emails-01.png)

## Parameter Reference

| Parameter | What it does | Example |
|-----------|-------------|---------|
| `query` | Free-text search across all fields | `"budget approval"` |
| `from` | Filter by sender email or name | `"sarah@company.com"` |
| `to` | Filter by recipient | `"team@company.com"` |
| `subject` | Filter by subject line | `"quarterly report"` |
| `folder` | Which folder to search | `"sentitems"` |
| `unreadOnly` | Only unread messages | `true` |
| `hasAttachments` | Only messages with attachments | `true` |
| `receivedAfter` | Received after this date (ISO 8601) | `"2026-01-01"` |
| `receivedBefore` | Received before this date | `"2026-02-01"` |
| `searchAllFolders` | Search every folder | `true` |
| `count` | Number of results to return | `10` |
| `kqlQuery` | Raw KQL for advanced queries | `"from:ceo AND hasAttachment:true"` |
| `outputVerbosity` | Detail level: minimal, standard, full | `"minimal"` |

## Tips

- No query parameters = list mode (most recent emails first)
- Use `outputVerbosity: "minimal"` when you just need subject lines and dates
- For advanced queries, see the [KQL Search Reference](../advanced/kql-search-reference.md)
- Combine `from` + `receivedAfter` for the most targeted searches
- **Personal accounts (Outlook.com)**: Free-text `query` and `kqlQuery` may not work. Prefer `subject`, `from`, `to`, and date range filters for reliable results. See [Account Compatibility](../../../README.md#account-compatibility)

## Related

- [Read Email Threads](read-email-threads.md) — read an email after finding it
- [Export Emails](export-emails.md) — save search results to disk
- [KQL Search Reference](../advanced/kql-search-reference.md) — advanced query patterns
- [Tools Reference — search-emails](../../quickrefs/tools-reference.md#email-6-tools)
