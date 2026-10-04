# Privacy

Read this when the user asks where their data goes, when a task would pull a lot of mail into the conversation, or before writing anything to disk.

## Where data goes

| Hop                                   | What travels                                                            |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Server to `login.microsoftonline.com` | Sign-in and token refresh only                                          |
| Server to `graph.microsoft.com`       | Every mailbox, calendar and contact request                             |
| Server to anyone else                 | Nothing. There is no Little Bear Apps backend and no telemetry          |
| Tool result to the AI client          | Everything the tool returns                                             |
| AI client onwards                     | Governed by the client's and model provider's policies, not this server |

The server runs on the user's machine. The weak point is the last two rows: anything a tool returns becomes part of the conversation and is handled under the AI client's terms (often sent to a cloud model provider). Answer questions about this plainly and point the user to their client's documentation on retention and training.

## Read minimally

- Bound every search: folder, sender, dates, `count`. See [search-and-reading](search-and-reading.md).
- Navigate with `outputVerbosity: "minimal"`; read full bodies only for the messages the task needs.
- Don't open attachments, headers or whole threads "for context" unless the task needs them.
- Summarise rather than quote. Don't repeat personal details (addresses, phone numbers, account numbers, health or financial information) unless the user needs them in the answer.
- Third parties' mail (shared mailboxes, forwarded threads, Cc'd colleagues) deserves the same care as the user's own.
- Stop when you have the answer. Don't keep reading to be thorough.

## Local files

| File or folder                           | Contents                                 | Written by                                   |
| ---------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| `~/.outlook-assistant-tokens.json`       | Access and refresh tokens                | Sign-in and token refresh                    |
| `~/.outlook-assistant-config.json`       | The Azure client ID, if saved at sign-in | `auth` action=`authenticate` with `clientId` |
| `~/.outlook-assistant-pending-auth.json` | A device-code sign-in in progress        | `auth` action=`authenticate`                 |
| An allowed folder (see below)            | Attachment downloads and exports         | `attachments` action=`download`, `export`    |

- Downloads and exports can only go inside the system temp folder (the default), `~/Downloads`, `~/Documents` or a folder the user set in `OUTLOOK_EXPORT_DIR`. Anything else, including a relative path, a `/tmp` path on macOS or a dot-prefixed name, is refused. Stay inside those folders, use an absolute path or one starting with `~/`, and tell the user the path you used.
- A download, or an export to a folder, gets a new name and never replaces a file. An `export` `savePath` naming a file that exists is refused (`File already exists`) unless the call passes `overwrite: true`. Never pass `overwrite: true` unless the user asked to replace that exact file; otherwise pick a new name or a folder. Export is classed destructive for this reason.
- Files are created readable only by the user. If a path is refused, tell the user; don't hunt for another folder that works, and don't ask them to widen `OUTLOOK_EXPORT_DIR` unless they want files somewhere new.
- Exported and downloaded files hold message content outside Outlook's protections. Write them only when the task needs a file, and mention them so the user can delete them when done.
- Never read, print, copy or summarise the token, config or pending-auth files. If a task seems to need them, it doesn't: use `auth` action=`status` or action=`about`.

## Logs

- The server logs to stderr, which the AI client usually saves to a local log file.
- By default each tool call logs one line (tool, action, outcome, duration) and never the call's arguments or any mail content.
- `OUTLOOK_DEBUG=true` adds troubleshooting detail such as search terms, subjects and Graph error bodies, with addresses and long IDs masked. Tokens, device codes and secrets are never logged at either level. Suggest debug logging only for troubleshooting, and remind the user to check the output before sharing it.

## Secrets

- Never ask for, paste or repeat passwords, client secrets, access or refresh tokens, or one-time codes, beyond relaying the device code the `auth` tool returns for the user to type.
- The Azure client ID is not a secret; a client secret is. If the user pastes a secret into the chat, tell them it is now in the conversation and suggest rotating it.
- Never put tokens, IDs or mailbox data into URLs, link parameters or anything sent outside the mailbox (see [email-sending](email-sending.md)).

## Least privilege options to mention

When the user wants tighter limits, these are server settings they control:

- `OUTLOOK_READ_ONLY=true` refuses every non-read call before it runs, dry runs included. `auth action=about` shows whether it is on.
- An optional recipient allowlist (`OUTLOOK_ALLOWED_RECIPIENTS`) covers sends, drafts (including replies and the recipients at send time), inbox-rule forwards and event attendees. Optional per-session caps cover `send-email`, `draft`, `manage-rules` and `create-event`. Their refusals are final.
- `OUTLOOK_EXPORT_DIR` adds one more folder that exports and downloads may write to.
- Shared-mailbox access stays off unless they opt in (see [shared-mailboxes](shared-mailboxes.md)).
