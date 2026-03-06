---
title: "KQL Search Reference for Outlook Assistant"
description: "Use Keyword Query Language to write precise search queries for emails by date, sender, subject, and message properties."
tags: [outlook-assistant, advanced, how-to, reference]
---

# KQL Search Reference

KQL (Keyword Query Language) lets you write precise search queries when the standard filter parameters aren't enough.

## Using KQL in Outlook Assistant

Pass raw KQL queries through the `kqlQuery` parameter:

```
tool: search-emails
params:
  kqlQuery: "from:sarah@company.com AND subject:quarterly"
```

When you use `kqlQuery`, it bypasses other search parameters (`from`, `subject`, etc.) and sends the raw query directly to the Graph API.

## Basic Keyword Search

Search across all fields:

```
kqlQuery: "budget approval"
```

## Search by Field

| Field | Example |
|-------|---------|
| Sender | `from:sarah@company.com` |
| Recipient | `to:team@company.com` |
| Subject | `subject:quarterly report` |
| Body | `body:action required` |
| CC | `cc:manager@company.com` |

## Combine Conditions

### AND — both must match

```
kqlQuery: "from:sarah AND subject:quarterly"
```

### OR — either must match

```
kqlQuery: "from:sarah OR from:james"
```

### NOT — exclude results

```
kqlQuery: "subject:report NOT from:noreply@github.com"
```

### Parentheses — group conditions

```
kqlQuery: "(from:sarah OR from:james) AND subject:review"
```

## Date Ranges

```
kqlQuery: "received>=2026-01-01 AND received<=2026-01-31"
```

```
kqlQuery: "sent>=2026-02-01"
```

## Attachment and Flag Filters

```
kqlQuery: "hasAttachment:true"
```

```
kqlQuery: "isRead:false"
```

## Common KQL Patterns

| Goal | KQL Query |
|------|-----------|
| Emails from a specific sender this year | `from:boss@company.com AND received>=2026-01-01` |
| Unread emails with attachments | `isRead:false AND hasAttachment:true` |
| Emails about a project from anyone | `subject:\"Project Alpha\" OR body:\"Project Alpha\"` |
| Emails from a domain | `from:@company.com` |
| Recent emails excluding newsletters | `received>=2026-02-01 NOT from:newsletter@` |

## KQL vs Filter Parameters

| Approach | Personal Account | Work/School Account | When to use |
|----------|-----------------|---------------------|-------------|
| Filter params (`from`, `subject`, etc.) | Full support | Full support | **Recommended default** — reliable on all accounts |
| `query` param | Limited / may fail | Full support | Free-text search (work accounts only) |
| `kqlQuery` param | Limited / may fail | Full support | Complex queries: AND/OR/NOT, date ranges, multi-field (work accounts only) |

> **Important**: On personal Outlook.com accounts, `query` and `kqlQuery` use Microsoft's `$search` API which is not fully supported. Searches may silently return no results. Always prefer structured filter parameters (`from`, `subject`, `to`, `receivedAfter`, `hasAttachments`, `unreadOnly`) — these use OData `$filter` and work reliably on all account types.
>
> If you must use `kqlQuery`, test with a simple query first to confirm it works with your account type.

## Tips

- Enclose multi-word phrases in escaped quotes: `subject:\"Project Alpha\"`
- KQL is case-insensitive
- Date format in KQL is `YYYY-MM-DD`
- If a KQL query returns no results, try the simpler `query` parameter first — it's more forgiving

## Related

- [Find Emails](../email/find-emails.md) — standard search with filter parameters
- [Find Emails — Search Across All Folders](../email/find-emails.md#search-across-all-folders)
- [Tools Reference — search-emails](../../quickrefs/tools-reference.md#email-6-tools)
