# Troubleshooting

Common issues and their fixes. For getting-started guidance, see [`docs/how-to/getting-started/`](how-to/getting-started/). For architecture and module layout, see [`docs/architecture.md`](architecture.md).

## Common Issues

| Issue | Solution |
|-------|----------|
| `AADSTS7000215` (invalid secret) | Use the secret **VALUE**, not the Secret ID, from Azure > Certificates & secrets. The Value is shown only once at creation — if you navigated away, create a new secret. An **expired** secret gives the same error. Since v3.11.0 the server keeps Microsoft's original error text and appends this remediation to it, so you no longer have to look the code up (#69) |
| `AADSTS9002331` ("configured for Microsoft Account users only … use /consumers") | Your Azure app is registered as "Personal Microsoft accounts only". Set `OUTLOOK_AUTH_AUDIENCE=consumers` in your MCP client `env` block (v3.8.0+). Single-tenant apps need their tenant GUID; multi-tenant apps can use the default (`common`). |
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
| `kqlQuery` shown as deprecated | `kqlQuery` was renamed to `searchExpression` in v3.9.0 (it was always a Microsoft Graph `$search` expression, never full KQL). The `kqlQuery` alias still works for back-compat — prefer `searchExpression`. |

## Checking Authentication State

```bash
# Token state (redacted)
cat ~/.outlook-assistant-tokens.json | python3 -c "import json,sys; t=json.load(sys.stdin); print('auth_method:', t.get('auth_method')); print('expires_at:', t.get('expires_at')); print('has access_token:', bool(t.get('access_token')))"

# Pending device-code state (only present between authenticate and device-code-complete)
ls -la ~/.outlook-assistant-pending-auth.json 2>/dev/null || echo "No pending flow"
```

## Forcing a Fresh Auth

If tokens are corrupted or stuck:

```bash
rm ~/.outlook-assistant-tokens.json ~/.outlook-assistant-pending-auth.json
# Then call the auth tool again with action=authenticate
```

## Reporting Issues

Report issues at <https://github.com/littlebearapps/outlook-assistant/issues> with:

- Error message (full text)
- Contents of the token file (redact `access_token` and `refresh_token`)
- Auth method: device code or browser
- Account type: personal (Microsoft/Outlook.com) or work/school
