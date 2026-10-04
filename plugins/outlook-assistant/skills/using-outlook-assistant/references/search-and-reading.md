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
| Words that may be in the body (work/school) | `searchExpression`, optionally with `searchAllFolders: true`                                                                   |
| A thread                                    | `conversationId` (up to 100 messages, oldest first)                                                                            |
| Threads rather than messages                | `groupByConversation: true`                                                                                                    |
| One message by RFC Message-ID               | `internetMessageId`                                                                                                            |
| Only what changed since last time           | `deltaMode: true` (see below)                                                                                                  |
| Folder sizes before searching               | `folders` action=`stats` or action=`list` with `includeItemCounts`                                                             |
| Who someone is                              | `search-people` (contacts, directory, recent correspondents)                                                                   |

## Personal vs work/school search

| Input              | Work/school (Microsoft 365)                                                          | Personal Outlook.com                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `query`            | Server-side search                                                                   | Subject substring only: every word must be in the subject. Bodies are not searched                                                  |
| `searchExpression` | Graph `$search` over the whole message, body included. Ranked by relevance, not date | Only `from:`, `to:` and `subject:` terms are translated and retried (`raw-kql-translated`); free text and `AND`/`OR` are not        |
| `to`               | Server-side filter                                                                   | Matched locally over the most recent messages only (500 by default). Pair with `receivedAfter`/`receivedBefore` to reach older mail |
| Structured filters | Reliable                                                                             | The most reliable option                                                                                                            |

With `searchExpression`, quote your own phrases (`subject:"quarterly report"`). It takes the place of the other search parameters. Because results are ranked by relevance, top hits can look unrelated to a subject you expected.

## Check `_meta.searchMetadata`

Every search response carries it. Read it before acting on results:

- `finalStrategy` names the strategy that answered: `combined-search`, `single-term-*`, `client-side-*`, `boolean-filters-only`, `raw-kql-translated` or `recent-emails`.
- `recent-emails` means no filter was applied: you are looking at recent mail, not matches.
- `droppedFilters` lists filters that could not be honoured. It should be empty. If it isn't, the results are broader than asked: narrow again (tighter dates, a different filter) rather than acting on them.
- `truncated: true` (with `candidatesScanned` and `scanLimit`) means a local scan stopped before the end. "No match" is then not proof of absence; narrow the date window and search again.
- `kqlTranslatedTo` shows how a `searchExpression` was rewritten on a personal account.

## Paging: use date windows

There is no page cursor. `count` defaults to 25 for a list and 10 for a search, with a maximum of 50. When a result says more are available, narrow `receivedAfter`/`receivedBefore` and search window by window, rather than asking for more at once.

## Verbosity and body length

| `outputVerbosity`    | `search-emails`                          | `read-email` body                 |
| -------------------- | ---------------------------------------- | --------------------------------- |
| `minimal`            | ID, subject, sender                      | Preview only                      |
| `standard` (default) | Adds date, read state, attachment marker | Up to 2,000 characters            |
| `full`               | Adds recipients, importance, preview     | Up to 40,000 characters, plus IDs |

Verbosity also controls which fields are fetched, so `minimal` is cheaper as well as shorter. A cut body ends with a note on how to get the rest; only fetch more if the task needs it. `export` target=`message` writes a whole message to a file, which is a local write: ask first (see [privacy](privacy.md)).

## Delta sync

1. `search-emails` with `deltaMode: true` and no token. A large first sync arrives over several pages, each returning a continuation token: keep calling with it until a delta token comes back. Pass the same `maxResults` on every page.
2. Store the delta token. Next time, pass it as `deltaToken` to get only changes.
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
