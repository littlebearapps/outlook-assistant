---
title: "KQL Search Reference for Outlook Assistant"
description: "Use Microsoft Graph $search expressions (KQL-style syntax) to write precise search queries for emails by date, sender, subject, and message properties."
tags: [outlook-assistant, advanced, how-to, reference]
---

# KQL Search Reference

The `searchExpression` parameter lets you pass a raw Microsoft Graph `$search` expression — KQL-style syntax, but **not** full KQL — for precise searches when the standard filter parameters aren't enough.

## Using `searchExpression` in Outlook Assistant

Pass the expression through the `searchExpression` parameter (formerly `kqlQuery`, still accepted as a deprecated alias):

```
tool: search-emails
params:
  searchExpression: "from:sarah@company.com AND subject:quarterly"
```

A `searchExpression` takes the place of the other search parameters (`from`, `subject`, `query`) and goes to Graph `$search`.

### How it is sent (v3.14.2)

Graph reads KQL (operators, comparisons, mixed terms) only when the **whole expression is one double-quoted string**. Since v3.14.2 (#333) Outlook Assistant sends it that way, so you write the KQL plainly. The one exception is an expression made only of `from:`, `to:` and `subject:` terms, which is sent as written, exactly as before (see [below](#which-expressions-translate-on-personal-accounts)):

| You pass | Sent to Graph as `$search` |
|----------|----------------------------|
| `from:sarah@company.com AND subject:quarterly` | `"from:sarah@company.com AND subject:quarterly"` |
| `body:"quarterly report" OR cc:sarah` | `"body:\"quarterly report\" OR cc:sarah"` (your quotes are escaped inside) |
| `"invoice" OR "receipt"` | `"\"invoice\" OR \"receipt\""` |
| `"from:sarah AND received>=2026-01-01"` (already one quoted string) | unchanged |
| `invoice` | `"invoice"` |
| `from:sarah@company.com`, `subject:"quarterly report"`, `from:sarah subject:review` (only `from:`/`to:`/`subject:` terms) | as written, unquoted (unchanged from v3.14.1) |

Before v3.14.2 an expression with a colon or a space was sent unquoted. On a personal mailbox that was a `400` syntax error for a field scope or comparison, and a multi-word expression was answered with the newest mail, unfiltered (see [the live matrix](#live-test-matrix-personal-account)).

An expression made only of `from:`, `to:` and `subject:` terms keeps the v3.14.1 sequence so that its results do not change in a patch release: it is sent as written, and where Graph rejects it (personal accounts answer `400`) or finds nothing, it is run as OData filters. Those match substrings, cover every folder you searched and apply `receivedAfter`/`receivedBefore` and the boolean parameters. Sending these to `$search` first would give KQL word matching and newest-first order but fewer results in some cases (no Deleted Items or Junk Email, no substring matches), so that choice waits on a Microsoft 365 test ([#334](https://github.com/littlebearapps/outlook-assistant/issues/334)). To get `$search` for a single field today, add an operator or quote the whole expression yourself: `"from:sarah@company.com"`.

## Basic Keyword Search

Search across the whole message (subject, body, addresses):

```
searchExpression: "budget approval"
```

Several words must **all** appear, in any order: this is not a phrase match. For an exact phrase, scope it to a field with quotes, or quote the phrase inside the expression:

```
searchExpression: "subject:\"budget approval\""
searchExpression: "\"budget approval\" OR \"spending review\""
```

In `$search`, a term matches a whole word or the beginning of one: `subject:pass AND received>=2020-01-01` matches "password" and "passport", and `assword` matches nothing. (An expression that is only `subject:pass` is answered by the substring filter instead: see [How it is sent](#how-it-is-sent-v3142).)

## Search by Field

| Field | Example |
|-------|---------|
| Sender (name or address) | `from:sarah@company.com`, `from:company.com`, `from:sarah` |
| Recipient | `to:team@company.com` |
| CC | `cc:manager@company.com` |
| Subject | `subject:quarterly`, `subject:"quarterly report"` |
| Body | `body:unsubscribe` |

## Combine Conditions

Operators are **upper-case**. A lower-case `and` is read as another word to find.

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

Two terms on the same field with no operator between them (`subject:invoice subject:receipt`) are an **OR**; on different fields, or as plain words, they are an AND. Write the operator to be sure.

## Date Ranges

```
searchExpression: "received>=2026-01-01 AND received<=2026-01-31"
```

```
searchExpression: "sent>=2026-02-01"
```

`received:2026-10-08` (or `received=`) is that whole day in UTC; `received<=2026-10-08` includes it. A full timestamp works too: `received>=2026-10-08T00:00:00Z AND received<2026-10-08T06:00:00Z`. Keywords such as `received:today` and `received:"this week"` are accepted.

The `receivedAfter`/`receivedBefore` parameters (and `hasAttachments`/`unreadOnly`) do **not** apply to a `searchExpression` answered by `$search`. Since v3.14.2 they are listed in `_meta.searchMetadata.droppedFilters` with a note (#329). Put the date in the expression.

## Attachment and Flag Filters

```
searchExpression: "hasattachment:true"
```

```
searchExpression: "isread:false"
```

Field names are case-insensitive (`hasAttachment:true` and `hasattachments:true` behave the same).

## Common Patterns

| Goal | Search Expression |
|------|-------------------|
| Emails from a specific sender this year | `from:boss@company.com AND received>=2026-01-01` |
| Unread emails with attachments | `isread:false AND hasattachment:true` |
| Emails about a project from anyone | `subject:"Project Alpha" OR body:"Project Alpha"` |
| Emails from a domain | `from:company.com` |
| Recent emails excluding a sender | `received>=2026-02-01 NOT from:newsletter@company.com` |
| Invoices with an attachment | `subject:(invoice OR receipt) AND hasattachment:true` |

## What `$search` covers

- **Folders.** With `searchAllFolders: true`, Graph `$search` leaves out **Deleted Items and Junk Email**. On the test mailbox, six messages in Deleted Items were found by the same expression only when `folder: "deleteditems"` was named, and none of the first 50 hits for four broad expressions sat in either folder (708 and 604 messages). The structured filters (`from`, `to`, `subject`, dates) are OData `$filter` and do cover every folder.
- **Order.** Results come back newest first.
- **Body matches.** An unscoped term matches the whole message including the body, so a hit can have an unrelated-looking subject.

## `searchExpression` vs Filter Parameters

| Approach | Personal Account | Work/School Account | When to use |
|----------|-----------------|---------------------|-------------|
| Filter params (`from`, `subject`, etc.) | Full support | Full support | **Recommended default** — substring matches, every folder, all accounts |
| `query` param | `$search` alone, date and boolean filters applied to its results (at most 250 read, v3.14.2); auto-fallback | Full support | Free-text search over subject, body and sender |
| `searchExpression` param | With operators, comparisons or several words: KQL sent as one quoted string (v3.14.2), so `AND`/`OR`/`NOT`, dates and flags work. Only `from:`/`to:`/`subject:` terms: answered by OData filters, as before | Same requests; not yet verified live | Boolean logic, date ranges inside the expression, fields the filters don't have (`body:`, `cc:`) |

> **Important**: Microsoft's `$search` takes no `$filter` or `$orderby`. Since v3.14.2 `query` sends `$search` on its own and applies a date or boolean window to its results (reading at most 250; `partialCoverage` says when more remained), or with `from`, `to` or `subject` sends those as the filter and matches `query` locally; if nothing passes, it falls back through OData filters, boolean filters, and a client-side scan. `searchExpression` falls back only for the expressions it can reproduce as filters (`from:`, `to:`, `subject:` — see below); anything else ends with an explicit "no results", never a broader search you didn't ask for.
>
> Whatever runs, `_meta.searchMetadata` tells you which strategy answered (`raw-kql` for `$search`, `raw-kql-translated` for the filter retry) and `droppedFilters` lists any filter that could not be honoured. Anything in `droppedFilters` means the result set is broader than your query (#229); the expected case is a date or boolean parameter passed with a `searchExpression` (#329).
>
> **Unscoped expressions and `query` both reach `$search`.** `searchExpression: "invoice"` and `query: "invoice"` send the same `$search` (before v3.14.2, `query` always fell back to a subject substring match on personal accounts, #261). `query` then applies the date window to its results; with `from`, `to` or `subject`, those go to Graph as a filter and `query` is matched locally instead. Use `query` when you also want those filters; use `searchExpression` for KQL the filters can't express.

## Which expressions translate on personal accounts

An expression made only of `from:`, `to:` and `subject:` terms is sent to `$search` as written. When Graph rejects it (personal accounts) or returns nothing, it is translated into the equivalent OData filters and run down the normal search ladder (v3.10.0, #217). The result is reported as strategy `raw-kql-translated`, with the rewrite in `_meta.searchMetadata.kqlTranslatedTo`. The filters match substrings, cover every folder you searched (Deleted Items and Junk Email included with `searchAllFolders`) and take `receivedAfter`/`receivedBefore` and the boolean parameters. The same retry runs for such an expression that you quoted as a whole, when `$search` finds nothing for it.

The translator is deliberately strict — it declines anything whose meaning it cannot reproduce, because guessing would return mail you didn't ask for.

| Expression | If `$search` rejects it or finds nothing |
|------------|----------------------------|
| `from:sarah@company.com` | Retried as a `from` filter |
| `to:team@company.com` | Retried as a `to` filter |
| `subject:"quarterly report"` | Retried as a `subject` substring filter |
| `from:sarah subject:review` | Retried with both filters |
| `budget approval` (unscoped) | Not retried — no results |
| `from:sarah AND subject:review` | Not retried — boolean operators |
| `(from:sarah OR from:james)` | Not retried — grouping |
| `from:sar*` | Not retried — wildcards |
| `body:urgent`, `cc:manager@x.com` | Not retried — field outside `from`/`to`/`subject` |
| `received>=2026-01-01` | Not retried — use the `receivedAfter` parameter with the structured filters |
| `from:a from:b` | Not retried — repeated field is ambiguous |

## Live test matrix (personal account)

Measured on 10 October 2026 against a personal Outlook.com mailbox with read-only `GET /me/messages?$search=…&$top=50` requests (#333). "Verified" means every returned message was checked against the condition. **Microsoft 365 has not been tested**; Microsoft's own examples use the whole-quoted form.

| Expression | Unquoted | Whole-quoted |
|------------|----------|--------------|
| `invoice` (one word) | 200 | 200, the same messages |
| `reset your password` (several words) | 200, but the 50 newest messages in the mailbox, unfiltered | 200, messages with all three words (any order) |
| `invoice AND receipt`, `invoice OR receipt`, `invoice NOT receipt` | 200, the same 50 newest messages for all three, unfiltered | 200, three different result sets |
| `zzzqqqxxx yyywwwvvv` (words in no message) | 200, the 50 newest messages | 200, no results |
| `from:example.com.au`, `from:user@example.com`, `from:label` | 400 `Syntax error: character ':' is not valid` | 200, verified 50/50 for a sender with mail outside Deleted Items |
| `to:user@example.com`, `to:label` | 400 | 200, verified 50/50 |
| `cc:label` | not run | 200, verified 50/50 |
| `subject:password` | 400 | 200, verified 50/50 |
| `subject:"reset your password"` | 400 | 400 with the inner quotes left bare; 200 with them backslash-escaped, verified 14/14 |
| `body:unsubscribe` | not run | 200 |
| `received>=2026-10-01`, `received<2023-01-01` | 400 `character '>' is not valid` | 200, verified 50/50 |
| `received>=2026-10-01 AND received<=2026-10-05` | 400 | 200, verified 24/24 |
| `invoice AND received<2023-01-01` | 400 | 200, verified 50/50 |
| `sent>=2026-10-01` | not run | 200, verified 50/50 |
| `from:a AND subject:b`, `(from:a OR from:b) AND subject:c` | 400 | 200, verified |
| `subject:invoice NOT subject:receipt` | not run | 200, verified 50/50 |
| `from:a and subject:b` (lower-case operator) | not run | 200, but a different, smaller set than `AND` |
| `hasattachment:true`, `hasattachments:true`, `hasAttachment:true` | 400 | 200, verified 50/50, the same messages |
| `invoice AND hasattachment:true` | 400 | 200, verified 50/50 |
| `isread:false` | 400 | 200, verified 50/50 |
| `"invoice" OR "receipt"` (separately quoted) | 200, the 50 newest messages, unfiltered | 200 with inner quotes escaped, the same set as `invoice OR receipt` |
| `nosuchfield:value` | not run | 200, no results |

Whole-quoting never changed the result of an expression that already worked unquoted: the only such form is a single word, which Outlook Assistant has always quoted.

Through `search-emails` on the same mailbox, v3.14.1 against v3.14.2:

| `searchExpression` | v3.14.1 | v3.14.2 |
|--------------------|--------|---------|
| `invoice`, `"reset your password"` | `raw-kql`, 25 results | the same 25 results |
| `invoice OR receipt`, `"invoice" OR "receipt"` | `raw-kql`, the 25 newest messages (unfiltered) | `raw-kql`, 25 matching messages |
| `zzzqqqxxx yyywwwvvv` | `raw-kql`, the 25 newest messages (unfiltered) | `raw-kql`, no results |
| `invoice AND received<2023-01-01` | `raw-kql-error`, no results | `raw-kql`, 25 results |
| `hasattachment:true AND subject:invoice` | `raw-kql-error`, no results | `raw-kql`, 25 results |
| `from:microsoft.com`, `from:user@example.com`, with and without `receivedAfter`/`receivedBefore` or `unreadOnly` | one 400, then `raw-kql-translated` | the same requests and the same messages |
| `to:label`, with and without `receivedAfter`; `subject:x` with fewer matches than `count`, with and without a window | one 400, then `raw-kql-translated` | the same messages |
| `subject:password`, `from:microsoft.com` (more matches than `count`) | `raw-kql-translated`, the 25 oldest | `raw-kql-translated`, the 25 newest (#331) |
| `from:label` (no dot) | `raw-kql-translated`, display-name matches only | `raw-kql-translated`, name or address matches (#328) |
| `subject:"reset your password"` | `raw-kql-translated`, 15 results | the same 15 |
| `from:user@example.com` (all of that sender's mail is in Deleted Items) | `raw-kql-translated`, 6 results | the same 6 |

## Tips

- Write the expression plainly; Outlook Assistant quotes it as a whole where Graph needs that, and escapes your own `"` and `\` inside it
- Multi-word phrases need their own quotes: `subject:"Project Alpha"`
- Operators are upper-case: `AND`, `OR`, `NOT`
- Graph `$search` matching is case-insensitive and matches whole words or their beginnings, not substrings
- Dates are `YYYY-MM-DD` (UTC days) or full ISO timestamps
- If a `searchExpression` returns no results, check `_meta.searchMetadata.finalStrategy` — then try the structured filters, which match substrings and cover Deleted Items and Junk Email

## Related

- [Find Emails](../email/find-emails.md) — standard search with filter parameters
- [Find Emails — Search Across All Folders](../email/find-emails.md#search-across-all-folders)
- [Tools Reference — search-emails](../../quickrefs/tools-reference.md#email-8-tools)
