# Troubleshooting

Common issues and their fixes. For getting-started guidance, see [`docs/how-to/getting-started/`](how-to/getting-started/). For architecture and module layout, see [`docs/architecture.md`](architecture.md).

## Common Issues

| Issue | Solution |
|-------|----------|
| `AADSTS7000215` (invalid secret) | The server now explains this directly: use the client secret **Value**, not the Secret ID from Azure Portal > App registrations > Certificates & secrets. |
| `AADSTS65001` / `consent_required` | The app is requesting a permission the user/admin has not consented to. For delegated To Do scopes, re-run device-code auth after adding permissions. For client credentials, a tenant admin must grant application permission consent. |
| `AADSTS9002331` ("configured for Microsoft Account users only … use /consumers") | Your Azure app is registered as "Personal Microsoft accounts only". Set `OUTLOOK_AUTH_AUDIENCE=consumers` in your MCP client `env` block (v3.8.0+). Single-tenant apps need their tenant GUID; multi-tenant apps can use the default (`common`). |
| `AADSTS50059` ("No tenant-identifying information found") | Your Azure app is likely single-tenant ("My organisation only") but the server is using the default `common` audience. Set `OUTLOOK_AUTH_AUDIENCE` to the app registration's Directory (tenant) ID, then authenticate again. |
| `OUTLOOK_TENANT_ID must be a tenant GUID` | Client credentials auth cannot use `common`, `consumers`, or `organizations`. Set `OUTLOOK_TENANT_ID` and `OUTLOOK_AUTH_AUDIENCE` to the app registration's Directory tenant ID. |
| Client credentials certificate/key error | Confirm `OUTLOOK_CERT_PATH` points to the public certificate PEM and `OUTLOOK_KEY_PATH` points to the private key PEM. Use `chmod 600` and never commit these files. |
| App-only `Access denied` on mailbox calls | Confirm Graph application permissions, admin consent, `OUTLOOK_TARGET_USER`, and Exchange mailbox scoping. App-only tokens have no `/me`; Outlook Assistant rewrites calls to `/users/{OUTLOOK_TARGET_USER}/...`. |
| `EADDRINUSE :3333` | `npx kill-port 3333` then restart auth server |
| Module not found | Run `npm install` |
| Auth URL doesn't work | Start auth server first: `npm run auth-server` |
| Empty API response | Check auth status with `auth` tool (action=status) |
| `search-emails` returns no results | On personal accounts, `query` auto-falls back to subject search (v3.5.2). Use `subject`, `from`, `to`, `receivedAfter` filters for best results |
| `create-event` wrong timezone | Omit the `Z` suffix on times for local timezone. `Z` suffix = UTC, which may be hours off |
| Auth server "missing client ID" | Ensure `OUTLOOK_CLIENT_ID`/`OUTLOOK_CLIENT_SECRET` are set as env vars for the auth server process |
| Device code "invalid_client" | Enable "Allow public client flows" in Azure Portal > App registrations > Authentication |
| Device code sign-in shows "wrongplace" | Normal — sign-in completed. Close the browser, call `device-code-complete` |
| Device code sign-in redirects to localhost | Use incognito/private browser for `microsoft.com/devicelogin` |
| `device-code-complete` hangs | Tool is polling (not a permission prompt). Wait 10-15s. If still hanging, sign-in didn't complete — get new code, use incognito browser |
| `device-code-complete` "no pending flow" | Fixed in v3.7.2 — device code state now persists to disk, surviving MCP server restarts. Update to v3.7.2+ |
| Token refresh fails after ~60 min (device code) | Fixed in v3.7.2 — earlier versions sent `client_secret` for public client refresh. Update to v3.7.2+ |
| `search-emails` returns 503 error | Fixed in v3.5.2 — `query` now falls back to `contains(subject)` on personal accounts. For raw Graph `$search`, use `searchQuery` (`kqlQuery` remains a legacy alias). (#98, #169) |
| `send-email` returns Graph 400 `ErrorInvalidRecipients` with literal-bracket address | Fixed in v3.7.4 — pass recipients as a comma-separated string (`to: "a@x.com,b@x.com"`), not an array literal. Earlier versions silently stringified array shapes; v3.7.4 rejects both live arrays and JSON-encoded array strings at the MCP boundary with a friendly hint. (#168) |
| `search-emails searchQuery=...` or `kqlQuery=...` returns unrelated recent emails | Fixed in v3.7.4 — earlier versions auto-wrapped the raw Graph search expression in extra quotes (breaking phrases like `subject:"foo bar"`) and silently fell through to combined-search when Graph returned 0, dropping the filter. Current versions trust your syntax and never fall through. `searchQuery` is the canonical name; `kqlQuery` is a backwards-compatible alias. (#169 V37-F-1) |

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
