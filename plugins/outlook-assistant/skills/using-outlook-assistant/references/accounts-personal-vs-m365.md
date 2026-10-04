# Personal vs work/school accounts

Read this when behaviour depends on whether the user signed in with a personal Outlook.com account or a work/school Microsoft 365 account.

## Tell which one you have

Run `auth action=about`. The `Mailbox` row shows the signed-in address; consumer domains (`outlook.com`, `hotmail.com`, `live.com` and similar) mean a personal account. If you're unsure, ask the user once rather than guessing. Signs of a personal account: mail tips always come back empty, `find-meeting-rooms` returns nothing, and `search-emails` reports `client-side-*` or `raw-kql-translated` strategies.

## Safety net upstream

| Protection                                               | Personal Outlook.com | Work/school (Microsoft 365)   |
| -------------------------------------------------------- | -------------------- | ----------------------------- |
| Tenant data-loss prevention (DLP) on outgoing mail       | None                 | If the organisation set it up |
| Admin-managed threat protection on links and attachments | None                 | If the organisation set it up |
| Retention, litigation hold, eDiscovery                   | None                 | Often on                      |
| Admin consent and app blocking                           | None                 | Often on                      |
| Conditional Access (device, location, MFA)               | None                 | Often on                      |
| Mail tips before sending                                 | Not available        | Available                     |

On a personal account nothing stands between a mistake and the outside world. Apply the strictest reading of the hard rules there: draft first, confirm every outward action in full, and never assume a recipient is "internal".

On a work account, upstream controls are not a reason to relax. They are also not yours to test: a DLP block, a 403, a Conditional Access failure or an admin-consent error is final (hard rule 5). Report it in plain words and stop.

## Work/school specifics

- **Retention and eDiscovery.** Sent mail, deleted mail and edits may be kept and discoverable after the user deletes them. Write every message as if it will be read later by someone else.
- **Sensitivity labels.** These tools don't show or apply Microsoft Purview sensitivity labels. If the user mentions a label, or the content looks classified, tell them to check the label in Outlook before anything leaves. The `sensitivity` field on events and rules (`normal`, `personal`, `private`, `confidential`) is a different, older marker.
- **Admin consent.** Some permissions need an administrator. `auth action=about` lists configured versus granted scopes; a missing scope is the user's or admin's call, not something to work around.
- **External recipients.** Previews and mail tips count addresses outside the user's domain as external. Point these out before anything is sent.

## Features that differ

| Feature                                                     | Personal Outlook.com                                            | Work/school                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| Free-text search (`query`, `searchExpression`)              | Limited; falls back automatically. Structured filters work best | Full server-side search                              |
| `to` filter                                                 | Local scan of recent mail only                                  | Server-side                                          |
| `get-mail-tips`, `checkRecipients`                          | No tips returned; can't refuse a send                           | Full                                                 |
| Shared mailboxes (`sharedMailbox`, `access-shared-mailbox`) | Not available                                                   | Opt-in (see [shared-mailboxes](shared-mailboxes.md)) |
| `find-meeting-rooms`                                        | Empty list                                                      | Needs a room-lookup permission granted by an admin   |
| Automatic replies                                           | Scheduled only (`startDateTime` + `endDateTime`)                | Scheduled or always on                               |
| Focused Inbox overrides                                     | May be stored without changing where mail lands                 | Full                                                 |

Search details are in [search-and-reading](search-and-reading.md); automatic replies in [rules-and-settings](rules-and-settings.md).

## Sign-in audience

`OUTLOOK_AUTH_AUDIENCE` tells the server which accounts its Azure app accepts:

| Value              | Accounts                                                      |
| ------------------ | ------------------------------------------------------------- |
| `common` (default) | Personal and work/school                                      |
| `consumers`        | Personal only. Needed when sign-in fails with `AADSTS9002331` |
| `organizations`    | Work/school only                                              |
| a tenant GUID      | One organisation only                                         |

This is server configuration. If sign-in fails with an audience error, tell the user which value the error points to and that they change it in the MCP server's settings, then restart. Don't edit their configuration yourself unless they ask.

## Signing in

- `auth` action=`status` before a multi-step task. Refresh tokens last about 90 days.
- `auth` action=`authenticate` defaults to the device-code flow: give the user the code and URL exactly as returned, then call action=`device-code-complete` once they say they've finished. Suggest a private browser window if the wrong account keeps signing in.
- If sign-in says no client ID is configured, ask the user for their Azure Application (client) ID and pass it as `clientId`. It isn't a secret, but never ask for a client secret or password in the chat.
