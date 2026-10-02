---
title: "KQL Search Reference for Outlook Assistant"
description: "Use Microsoft Graph $search expressions (KQL-style syntax) to write precise search queries for emails by date, sender, subject, and message properties."
tags: [outlook-assistant, advanced, how-to, reference]
---

# KQL Search Reference

The `searchExpression` parameter lets you pass a raw Microsoft Graph `$search` expression — KQL-style syntax, but **not** full KQL — for precise searches when the standard filter parameters aren't enough.

## Using `searchExpression` in Outlook Assistant

Pass a raw Graph `$search` expression through the `searchExpression` parameter (formerly `kqlQuery`, still accepted as a deprecated alias):

```
tool: search-emails
params:
  searchExpression: "from:sarah@company.com AND subject:quarterly"
```

When you use `searchExpression`, it bypasses other search parameters (`from`, `subject`, etc.) and sends the raw expression directly to the Graph API.

## Basic Keyword Search

Search across all fields:

```
searchExpression: "budget approval"
```

## Search by Field

| Field | Example |
|-------|---------|
| Sender | `from:sarah@company.com` |
| Recipient | `to:team@company.com` |
| Subject | `subject:quarterly report` |
| Body | `body:action required` |
| CC | `cc:manager@company.com` |

> **Personal accounts (issue [#217](https://github.com/littlebearapps/outlook-assistant/issues/217))**: Personal Outlook.com accounts reject field-scoped `$search` outright — Graph answers `subject:"invoice"` or `from:github.com` with a syntax error or an empty set even when the mail is plainly there. Since **v3.10.0**, expressions built purely from `from:`, `to:` and `subject:` terms are translated into the closest equivalent OData filters and retried down the normal fallback ladder, reported as strategy `raw-kql-translated` with the rewrite recorded in `_meta.searchMetadata.kqlTranslatedTo`. The translation is close rather than identical — a KQL `subject:` term becomes a substring match. `body:`, `cc:`, `received:`, `hasAttachment:` and `isRead:` are **not** translated. See [Which expressions translate](#which-expressions-translate-on-personal-accounts) below.

## Combine Conditions

> These operators are a **work/school account** feature. On a personal Outlook.com account Graph rejects them and Outlook Assistant will not guess at a rewrite — use the structured filter parameters instead. See [Which expressions translate](#which-expressions-translate-on-personal-accounts).

### AND — both must match

```
searchExpression: "from:sarah AND subject:quarterly"
```

### OR — either must match

```
searchExpression: "from:sarah OR from:james"
```

### NOT — exclude results

```
searchExpression: "subject:report NOT from:noreply@github.com"
```

### Parentheses — group conditions

```
searchExpression: "(from:sarah OR from:james) AND subject:review"
```

## Date Ranges

```
searchExpression: "received>=2026-01-01 AND received<=2026-01-31"
```

```
searchExpression: "sent>=2026-02-01"
```

## Attachment and Flag Filters

```
searchExpression: "hasAttachment:true"
```

```
searchExpression: "isRead:false"
```

## Common Patterns

| Goal | Search Expression |
|------|-------------------|
| Emails from a specific sender this year | `from:boss@company.com AND received>=2026-01-01` |
| Unread emails with attachments | `isRead:false AND hasAttachment:true` |
| Emails about a project from anyone | `subject:\"Project Alpha\" OR body:\"Project Alpha\"` |
| Emails from a domain | `from:@company.com` |
| Recent emails excluding newsletters | `received>=2026-02-01 NOT from:newsletter@` |

## `searchExpression` vs Filter Parameters

| Approach | Personal Account | Work/School Account | When to use |
|----------|-----------------|---------------------|-------------|
| Filter params (`from`, `subject`, etc.) | Full support | Full support | **Recommended default** — reliable on all accounts |
| `query` param | Limited (auto-fallback) | Full support | Free-text search; falls back to filters on personal accounts |
| `searchExpression` param | Field-scoped `from:`/`to:`/`subject:` translated to filters and retried (v3.10.0); everything else terminates with an explicit no-results | Full support | Complex queries: AND/OR/NOT, date ranges, multi-field (work accounts only) |

> **Important**: On personal Outlook.com accounts, `query` and `searchExpression` use Microsoft's `$search` API, which is not fully supported. `query` falls back through OData filters, boolean filters, and a client-side scan. `searchExpression` falls back only for the expressions it can reproduce exactly (`from:`, `to:`, `subject:` — see below); anything else deliberately terminates with an explicit "no results" rather than quietly running a broader search you didn't ask for. Structured filter parameters (`from`, `subject`, `to`, `receivedAfter`, `hasAttachments`, `unreadOnly`) use OData `$filter` and work reliably on all account types — they remain the most direct route.
>
> Whatever runs, `_meta.searchMetadata` tells you which strategy answered and `droppedFilters` lists any filter that could not be honoured. `droppedFilters` should always be empty; anything else means the result set is broader than your query (#229).
>
> **Unscoped expressions are a different search from `query`, not a synonym.** `searchExpression: "invoice"` reaches Graph `$search` untouched, which matches the **whole message including the body** and orders results by **relevance**, not by date. `query: "invoice"` on a personal account becomes a subject substring match that never reads bodies. So the same term can legitimately produce two different result sets: `searchExpression` may return a message whose subject looks unrelated (the term is in its body), and `query` may miss a message that is obviously about the term (it isn't in the subject). Neither is a dropped filter. Reach for `query` when your term is in a subject line, `searchExpression` when you need body content.

## Which expressions translate on personal accounts

The translator is deliberately strict — it declines anything whose meaning it cannot reproduce exactly, because guessing would return mail you didn't ask for.

| Expression | Personal account behaviour |
|------------|---------------------------|
| `from:sarah@company.com` | Translated → `from` filter |
| `to:team@company.com` | Translated → `to` filter |
| `subject:"quarterly report"` | Translated → `subject` substring filter |
| `from:sarah subject:review` | Translated → both filters combined |
| `budget approval` (unscoped) | Sent to `$search` unchanged — never affected by #217 |
| `from:sarah AND subject:review` | **Not** translated — boolean operators |
| `(from:sarah OR from:james)` | **Not** translated — grouping |
| `from:sar*` | **Not** translated — wildcards |
| `body:urgent`, `cc:manager@x.com` | **Not** translated — field outside `from`/`to`/`subject` |
| `received>=2026-01-01` | **Not** translated — use the `receivedAfter` parameter |
| `from:a from:b` | **Not** translated — repeated field is ambiguous |

For anything in the "not translated" rows on a personal account, use the structured filter parameters instead — they express the same intent through `$filter` and work everywhere.

## Tips

- Enclose multi-word phrases in escaped quotes: `subject:\"Project Alpha\"`
- Graph `$search` matching is case-insensitive
- Date format is `YYYY-MM-DD`
- If a `searchExpression` returns no results, check `_meta.searchMetadata.finalStrategy` — then try the simpler `query` parameter or the structured filters, which are more forgiving

## Related

- [Find Emails](../email/find-emails.md) — standard search with filter parameters
- [Find Emails — Search Across All Folders](../email/find-emails.md#search-across-all-folders)
- [Tools Reference — search-emails](../../quickrefs/tools-reference.md#email-6-tools)
