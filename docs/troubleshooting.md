# Troubleshooting

Common issues and their fixes. For getting-started guidance, see [`docs/how-to/getting-started/`](how-to/getting-started/). For architecture and module layout, see [`docs/architecture.md`](architecture.md).

## Common Issues

| Issue | Solution |
|-------|----------|
| `AADSTS7000215` (invalid secret) | Use the secret **VALUE**, not the Secret ID, from Azure > Certificates & secrets. The Value is shown only once at creation — if you navigated away, create a new secret. An **expired** secret gives the same error. Since v3.11.0 the server keeps Microsoft's original error text and appends this remediation to it, so you no longer have to look the code up (#69) |
| `AADSTS9002331` ("configured for Microsoft Account users only … use /consumers") | Your Azure app is registered as "Personal Microsoft accounts only". Set `OUTLOOK_AUTH_AUDIENCE=consumers` in your MCP client `env` block (v3.8.0+). Single-tenant apps need their tenant GUID; multi-tenant apps can use the default (`common`). |
| A tool says "Shared-mailbox support is turned off" | Shared mailboxes are opt-in (work/school only). Set `OUTLOOK_SHARED_MAILBOX=read` (read) or `=true` (read and organise) in the server's `env` block, restart, then run `auth action=authenticate force=true`. `auth action=about` shows whether the shared scopes were granted. |
| `OUTLOOK_SHARED_MAILBOX` is on and a personal account's sign-in fails, then hands you a second device code | Device-code flow only: personal accounts can't be granted the `.Shared` scopes, so Outlook Assistant retries once with the standard scopes — enter the second code. Simpler: leave `OUTLOOK_SHARED_MAILBOX` unset on personal accounts. The browser flow (`npm run auth-server`) requests the configured scopes with **no** fallback, so don't enable the setting if you sign in that way. |
| `OUTLOOK_SHARED_MAILBOX` is on and work/school sign-in shows "Need admin approval" or fails with `AADSTS65001` | Your tenant doesn't let users consent to `Mail.Read.Shared`/`Mail.ReadWrite.Shared`. Ask an admin to grant consent for the app, then re-run `auth action=authenticate force=true`. If that isn't possible, unset `OUTLOOK_SHARED_MAILBOX` and restart — sign-in goes back to the standard scopes. Scopes are never silently downgraded on a consent error. |
| `EADDRINUSE :3333` | `npx kill-port 3333` then restart auth server |
| Module not found | Run `npm install` |
| Auth URL doesn't work | Start auth server first: `npm run auth-server` |
| Empty API response | Check auth status with `auth` tool (action=status) |
| `search-emails` returns no results | On personal accounts, `query` auto-falls back to subject search (v3.5.2). Use `subject`, `from`, `to`, `receivedAfter` filters for best results |
| `create-event` wrong timezone | Omit the `Z` suffix on times for local timezone. `Z` suffix = UTC, which may be hours off |
| Auth server "missing client ID" | Ensure `OUTLOOK_CLIENT_ID`/`OUTLOOK_CLIENT_SECRET` are set as env vars for the auth server process |
| Device code `authenticate` returns nothing / empty output | Fixed in v3.8.2 — earlier versions rendered a failed initiation as empty output (the underlying error was swallowed). Update to v3.8.2+, which shows the real error plus a hint. Common causes: `AADSTS9002331` (set `OUTLOOK_AUTH_AUDIENCE=consumers`), `invalid_client` (enable public client flows), or blocked outbound network access to `login.microsoftonline.com` (e.g. a sandboxed connector). (#213) |
| Device code "invalid_client" | Enable "Allow public client flows" in Azure Portal > App registrations > Authentication |
| Device code sign-in shows "wrongplace" | Normal — sign-in completed. Close the browser, call `device-code-complete` |
| Device code sign-in redirects to localhost | Use incognito/private browser for `microsoft.com/devicelogin` |
| `device-code-complete` hangs | Tool is polling (not a permission prompt). Wait 10-15s. If still hanging, sign-in didn't complete — get new code, use incognito browser |
| `device-code-complete` "no pending flow" | Fixed in v3.7.2 — device code state now persists to disk, surviving MCP server restarts. Update to v3.7.2+ |
| Token refresh fails after ~60 min (device code) | Fixed in v3.7.2 — earlier versions sent `client_secret` for public client refresh. Update to v3.7.2+ |
| `search-emails` returns 503 error | Fixed in v3.5.2 — `query` now falls back to `contains(subject)` on personal accounts. For body search, use `searchExpression` (#98) |
| `send-email` returns Graph 400 `ErrorInvalidRecipients` with literal-bracket address | Fixed in v3.7.4 — pass recipients as a comma-separated string (`to: "a@x.com,b@x.com"`), not an array literal. Earlier versions silently stringified array shapes; v3.7.4 rejects both live arrays and JSON-encoded array strings at the MCP boundary with a friendly hint. (#168) |
| `search-emails kqlQuery=...` returns unrelated recent emails | Fixed in v3.7.4 — earlier versions auto-wrapped the `kqlQuery` in extra quotes (breaking phrases like `subject:"foo bar"`) and silently fell through to combined-search when Graph returned 0, dropping the filter. v3.7.4 trusts your expression syntax and never falls through. v3.10.0 adds one deliberate, disclosed exception — see the field-scoped translation row below. (#169 V37-F-1) |
| Can't move or address a nested folder (e.g. a subfolder) | Fixed in v3.9.0 — address folders by path, e.g. `targetFolder="Parent/Child"`, or by `targetFolderId` / `folderId`. Run `folders action=list` to see each folder's full path and ID. Earlier versions resolved only top-level folder names. (#216) |
| `searchAllFolders: true` returns fewer results than an inbox search | Fixed in v3.9.0 — cross-folder search now returns a superset of an inbox-scoped search; broadening the scope never shrinks the result set. (#169) |
| `searchExpression="from:…"` / `subject:"…"` returns 0 on a personal account | Fixed in v3.10.0 — field-scoped `$search` expressions return nothing on personal Outlook.com accounts even when matching mail exists. Expressions built purely from `from:`, `to:` and `subject:` terms are now translated into the closest equivalent OData filters and retried (strategy `raw-kql-translated`, rewrite recorded in `searchMetadata.kqlTranslatedTo`) — note a `subject:` term becomes a substring match, so the translation is close rather than identical. Boolean operators, grouping, wildcards and other field prefixes are deliberately not translated and still terminate. Unscoped expressions were never affected. (#217) |
| Search with two filters returns results matching only one of them | Fixed in v3.10.0 — when Graph rejected the combined filter, the ladder returned the first single-term result set and dropped the rest, while still reporting `filterApplied: true`. Remaining terms are now applied locally, and `searchMetadata.droppedFilters` reports anything that could not be honoured. (#229) |
| `search-emails` with an apostrophe in `from`/`to` finds nothing | Fixed in v3.10.0 — values such as `O'Brien` were interpolated unescaped into the OData filter, producing a Graph 400 that the fallback ladder swallowed into "No emails found". (#230) |
| Empty search suggests "use `from` filter instead of `to`" | Fixed in v3.10.0 — that suggestion had been false since v3.7.1 added the client-side `to` fallback, and it printed on every empty search regardless of what you actually supplied. No-results guidance is now derived from the parameters you passed and the strategies actually attempted, and reports any client-side fallback including how many messages it examined. (#231) |
| `to` combined with `receivedAfter`/`receivedBefore` returns mail addressed to someone else | Fixed in v3.11.1 — the single-term rung built the recipient filter and then had it overwritten by the date/boolean filter, so the request went out carrying only the date window and the whole window came back labelled `single-term-to` with `filterApplied: true`. `from`, `subject` and `query` were affected identically. Filters now compose. (defect report 2026-09-09) |
| `export target=messages` writes fewer files than the IDs you passed | Fixed in v3.11.1 — per-message filenames were `<date>_<subject>`, so every message in a same-day reply chain overwrote the previous one while the summary still reported `Failed 0`. Filenames now carry the message time, collisions get a numbered suffix instead of clobbering (`-1`, `-2` since v3.12.1; `_2`, `_3` before), and `_meta.manifest` maps each requested ID to the path actually written so you can reconcile. Attachment names had the same defect (`emailId.substring(0, 8)` is a shared prefix across a mailbox, not a disambiguator). (extends #82, which covered only the aggregated CSV) |
| `searchExpression` returns irrelevant top hits where `query` finds the right message | Working as designed, now documented. They are different requests, not the same one ranked differently: an untranslated `searchExpression` goes to Graph `$search`, which matches the whole message including the body and ranks by relevance with no date sort — so a term buried in a body can outrank the obvious subject-line match. `query` on a personal account is a subject substring match, which is why it looks more accurate for subject terms and misses body text entirely. Pick `query` for subject terms, `searchExpression` to reach bodies. |
| A `to` search misses mail you know exists further back | The server-side recipient filter is rejected on personal Outlook.com, so `to` is matched locally over the 500 most recent messages. On a large archive that silently excludes anything older. Since v3.11.1 the response says so whenever the scan was truncated (previously only on empty results). Narrow with `receivedAfter`/`receivedBefore`, or raise `OUTLOOK_SEARCH_SCAN_LIMIT` (max 5000). |
| `list-events` only shows upcoming events | That's the default. Pass `startAfter`, `startBefore` and/or `subject` (v3.12.0+) to look back or search by name — supplying any of them replaces the implicit "from now" bound. `startBefore` alone, or `subject` alone, returns the most recent matches first. |
| `list-events` returns `Invalid startAfter` / `Invalid startBefore` | Dates must be ISO 8601 with `Z` or a ±hh:mm offset, e.g. `2026-01-01T00:00:00Z` or `2026-01-01T09:00:00+10:00`. Zone-less (`2026-01-01T09:00:00`), date-only (`2026-01-01`), impossible (`2026-02-30…`) and pre-1900 dates are rejected rather than guessed, and `startAfter` must be earlier than `startBefore`. Nothing is sent to Graph when an argument is invalid. |
| `Invalid resource path: IDs must not contain "." or ".." path segments` | Since v3.12.0 a message, folder or attachment ID containing a `.` or `..` path segment (including percent-encoded forms) is refused before any request is made, so it can't be resolved against a different Graph resource. Real Graph IDs never contain these segments — copy the ID again from `search-emails` or `folders action=list`. |
| A tool hangs, or fails with `Request timed out after 60000 ms` | Since v3.12.1 a Graph request attempt that receives no data for `OUTLOOK_REQUEST_TIMEOUT_MS` (default 60000 ms) is abandoned instead of waiting forever. This is an inactivity timeout, not an overall deadline: a slow response that keeps arriving isn't cut off. Read requests are retried once after a timeout or dropped connection; writes are not, so check whether a timed-out change (a move or flag, say) actually landed before repeating it. A sent email is never re-sent after a timeout. On a slow link, raise `OUTLOOK_REQUEST_TIMEOUT_MS`. |
| `API call failed with status 429` (throttling), or `503`/`504` | Microsoft Graph throttles bursts of requests. Since v3.12.1 these are retried automatically up to 3 times, waiting as long as Graph's `Retry-After` header asks (or backing off up to 30 seconds), with at most 4 requests in flight at once. POST requests (send, reply, move, `$batch`) are only retried on `429`, and only when Graph asks for a wait of 10 seconds or less (20 seconds in total), so a send can't outlast your MCP client's own timeout and be repeated. If you still see the error, Graph asked for a longer wait (over 60 seconds, or over 10 seconds for a send) or kept throttling — wait a minute, check whether a send actually went out, then repeat with a smaller batch. |
| `Refusing to call non-Graph URL` | A `deltaToken` or continuation link pointed somewhere other than `https://graph.microsoft.com` (v3.11.2+). Pass the token exactly as a previous `search-emails deltaMode=true` call returned it, or start a fresh delta sync. |
| `Refusing to write file outside outputDir` | `export` and `attachments action=download` keep every file they name inside `outputDir` (v3.12.0+; before v3.12.1 the message read `Refusing to write export file outside outputDir`). You shouldn't see this in normal use; if you do, report it with the arguments you used. |
| `OUTLOOK_SHARED_MAILBOX` is set but `auth action=about` shows the `.Shared` scopes as not granted | A token refresh never adds scopes: since v3.12.0 it requests only the scopes granted at sign-in plus `offline_access` (#241), so an existing token keeps its old scope set. Restart the server and run `auth action=authenticate force=true` once. If they're still not granted, the account is personal (it can't hold them) or the device-code flow fell back to the standard scopes — see the rows above. |
| `kqlQuery` shown as deprecated | `kqlQuery` was renamed to `searchExpression` in v3.9.0 (it was always a Microsoft Graph `$search` expression, never full KQL). The `kqlQuery` alias still works for back-compat — prefer `searchExpression`. |
| Shared-mailbox **read** works but **move/categorise/flag/create-folder** fails with `404 ErrorInvalidMailboxItemId`, "folder not found", or the change lands in your own mailbox | The write tool must target the shared mailbox, and the token must carry `Mail.ReadWrite.Shared`. (1) Pass `sharedMailbox` (alias `email`) on the write tool — `folders action=move`, `folders action=create`, `apply-category`, `update-email`. (2) Set `OUTLOOK_SHARED_MAILBOX=true` (`read` requests only `Mail.Read.Shared`), add the delegated `Mail.ReadWrite.Shared` permission to your Azure app and grant consent. (3) Restart and **re-authenticate** with `auth action=authenticate force=true` so the token includes the new scope. Omitting `sharedMailbox` targets your own mailbox, where the shared message ID doesn't exist (the 404); a missing scope makes the shared-scoped request fail with 403 — it never falls back to your own mailbox. |
| `Invalid mailbox "…" — expected a shared mailbox email address` | `sharedMailbox` (or `email`) must be a plain email address such as `team@contoso.com`. Since v3.12.0 only printable ASCII is accepted, so look-alike characters (full-width `／`, zero-width spaces), `#`, `%`, `/` and spaces are refused. User GUIDs aren't accepted either. |
| Mail sent/replied/forwarded "from" a shared mailbox arrives from your own address | Working as designed — shared-mailbox support covers reading and organising only. `send-email` and `draft` (create/update/send/delete, reply, reply-all, forward) always act on the signed-in user's mailbox and accept no `sharedMailbox` parameter; `Mail.Send.Shared` is not requested. Use the Outlook UI for send-as / send-on-behalf. |

## Checking Authentication State

The simplest check is from your AI assistant: `auth action=status` reports whether the token is valid and when it expires, and `auth action=about` shows the connected mailbox, the configured and granted scopes, shared-mailbox status and the safety-belt settings, without ever printing a token.

From a shell:

```bash
# Token state (redacted)
cat ~/.outlook-assistant-tokens.json | python3 -c "import json,sys; t=json.load(sys.stdin); print('auth_method:', t.get('auth_method')); print('expires_at:', t.get('expires_at')); print('has access_token:', bool(t.get('access_token')))"

# Pending device-code state (only present between authenticate and device-code-complete)
ls -la ~/.outlook-assistant-pending-auth.json 2>/dev/null || echo "No pending flow"
```

## Forcing a Fresh Auth

Usually `auth action=authenticate force=true` is enough, followed by `auth action=device-code-complete`. If tokens are corrupted or stuck:

```bash
rm ~/.outlook-assistant-tokens.json ~/.outlook-assistant-pending-auth.json
# Then call the auth tool again with action=authenticate
```

## Reporting Issues

Report issues at <https://github.com/littlebearapps/outlook-assistant/issues> with:

- Error message (full text)
- The output of `auth action=about` (version, configured and granted scopes; it never includes tokens). Don't paste the token file.
- Auth method: device code or browser
- Account type: personal (Microsoft/Outlook.com) or work/school
