# Search and reading

Read this when you need to find, list, read or monitor email efficiently, or when search results look wrong.

## Default pattern

1. `search-emails` with bounds (`folder`, `from`, `subject`, `receivedAfter`/`receivedBefore`, `count`) and `outputVerbosity: "minimal"`.
2. Pick the few IDs that matter.
3. `read-email` on those IDs only.

Never list a whole mailbox to answer a narrow question. Every result goes into the conversation (see [privacy](privacy.md)).

## Choosing the mode

| Goal                                        | Call                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Recent mail in a folder                     | `search-emails` with no filters (`folder`, default `inbox`)                                                                    |
| Sender, subject, date, unread, attachments  | `search-emails` structured filters: `from`, `to`, `subject`, `receivedAfter`, `receivedBefore`, `unreadOnly`, `hasAttachments` |
| Words that may be in the body, or KQL        | `searchExpression`, optionally with `searchAllFolders: true`                                                                   |
| A thread                                    | `conversationId` (up to 100 messages, oldest first)                                                                            |
| Threads rather than messages                | `groupByConversation: true`                                                                                                    |
| One message by RFC Message-ID               | `internetMessageId`                                                                                                            |
| Only what changed since last time           | `deltaMode: true` (see below)                                                                                                  |
| Folder sizes before searching               | `folders` action=`stats` or action=`list` with `includeItemCounts`                                                             |
| Who someone is                              | `search-people` (contacts, directory, recent correspondents)                                                                   |

## Personal vs work/school search

| Input              | Work/school (Microsoft 365)                                                          | Personal Outlook.com                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `query` | Graph `$search` over subject, body and sender; a date or boolean window is applied to its results (newest first, at most 250 read). With `from`/`to`/`subject`: those as a server-side filter, `query` matched against subject, preview and sender | The same. If nothing passes: a subject substring match (every word in the subject) with the filters server-side |
| `searchExpression` | Graph `$search` (KQL) over the whole message, body included, newest first | The same for expressions with `AND`/`OR`/`NOT`, `received>=…` or several words (v3.14.2). One made only of `from:`, `to:` and `subject:` terms is answered by filters (`raw-kql-translated`), which do apply the date and boolean parameters |
| `to`               | Server-side filter                                                                   | Matched locally over the most recent messages only (500 by default). Pair with `receivedAfter`/`receivedBefore` to reach older mail |
| Structured filters | Reliable                                                                             | The most reliable option                                                                                                            |

With `searchExpression`, write the KQL plainly (`from:example.com AND subject:"quarterly report"`): the server sends it to Graph as one quoted string. Operators are upper-case (`AND`, `OR`, `NOT`); terms match whole words or their beginnings. It takes the place of the other search parameters. When `$search` answers, `receivedAfter`/`receivedBefore` and the boolean filters are not applied: they come back in `droppedFilters`. To limit by date, put it in the expression (`invoice AND received>=2026-01-01`). Because `$search` reads bodies, a hit can match on body text alone and look unrelated to the subject you expected. Across all folders, `$search` leaves out Deleted Items and Junk Email; the structured filters cover every folder.

## Check `_meta.searchMetadata`

Every search response carries it. Read it before acting on results:

- `finalStrategy` names the strategy that answered: `combined-search`, `single-term-*`, `client-side-*`, `boolean-filters-only`, `raw-kql` (a `searchExpression` answered by `$search`), `raw-kql-translated` or `recent-emails`.
- `recent-emails` means no filter was applied: you are looking at recent mail, not matches.
- `orderedWithinPage: true` means a `query` was answered by `$search`: results are newest first within what Graph returned, not across the whole mailbox.
- `partialCoverage: true` (with `narrowedCandidates`) means filters were applied locally to that many messages and Graph had more: other matches may exist. Narrow the search rather than reading the results as complete.
- `searchWindowUnreached: true` (with `searchResultsRead`) means a `query`'s date window was older than anything `$search` paging returned, so the results are subject matches only. To search bodies in that window, put the date in a `searchExpression` (`invoice AND received<=2025-10-01`).
- `droppedFilters` lists filters that could not be honoured. It should be empty. If it isn't, the results are broader than asked: narrow again (tighter dates, a different filter) rather than acting on them.
- `truncated: true` (with `candidatesScanned` and `scanLimit`) means a local scan stopped before the end. "No match" is then not proof of absence; narrow the date window and search again.
- `kqlTranslatedTo` shows how a `searchExpression` was rewritten as filters after `$search` rejected it or found nothing.

## Paging: use date windows

There is no page cursor. `count` defaults to 25 for a list and 10 for a search, with a maximum of 50. When a result says more are available, narrow `receivedAfter`/`receivedBefore` and search window by window, rather than asking for more at once. A `query` alone reads at most 250 `$search` results for a window; for older mail, add `from` or `subject` so the window is applied server-side.

## Verbosity and body length

| `outputVerbosity`    | `search-emails`                          | `read-email` body                 |
| -------------------- | ---------------------------------------- | --------------------------------- |
| `minimal`            | ID, subject, sender                      | Preview only                      |
| `standard` (default) | Adds date, read state, attachment marker | Up to 2,000 characters            |
| `full`               | Adds recipients, importance, preview     | Up to 40,000 characters, plus IDs |

Verbosity also controls which fields are fetched, so `minimal` is cheaper as well as shorter. A cut body ends with a note on how to get the rest; only fetch more if the task needs it. `export` target=`message` writes a whole message to a file, which is a local write: ask first (see [privacy](privacy.md)).

## Delta sync

1. `search-emails` with `deltaMode: true` and no token. A large first sync arrives over several pages, each returning a continuation token: keep calling with it until a delta token comes back. Pass the same `maxResults` on every page.
2. Store the delta token. Next time, pass it as `deltaToken` to get only changes. Every verbosity lists changed messages by ID and removed ones by ID. An updated message carries only its changed properties (`changed: isRead`), with no subject or sender: read it by ID if you need them.
3. The token encodes its own mailbox and folder, so `folder` and `sharedMailbox` don't apply when you pass it.
4. If the token has expired, start a fresh initial sync.

## Batches

Prefer one batch call to many single calls: `update-email` `ids` (flag, unflag, complete), `apply-category` `messageIds`, `folders` action=`move` `emailIds` (comma-separated), `export` `emailIds` (at most 100 per call). Batch changes still need the user's go-ahead where the single change would.

## Attachments and headers

- `attachments` action=`list` (metadata) before `view` (inline text, JSON or XML) or `download` (writes a file; ask first).
- `read-email` with `headersMode: true` and `importantOnly: true` shows SPF, DKIM and DMARC results for a suspicious sender (see [prompt-injection](prompt-injection.md)).

## When things look wrong

- Run `auth action=about` first. It shows the connected mailbox, time zone, read-only mode, and configured versus granted scopes.
- `Authentication required`: follow the next step in the message (`auth` action=`authenticate`).
- 403: a missing permission or a policy block. Report it; don't route around it.
- 404 on an ID from a shared mailbox: pass the same `sharedMailbox` (see [shared-mailboxes](shared-mailboxes.md)).
- 404 after a move: the message has a new ID. Search again; never construct IDs yourself.

Before sending, `get-mail-tips` checks recipients (see [email-sending](email-sending.md)).
