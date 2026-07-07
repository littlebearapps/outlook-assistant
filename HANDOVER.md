# Outlook Assistant Handover

Date: 2026-06-28

## Current State

This repo is in late MVP / early production-hardening shape. It is not a prototype. The Node MCP server starts successfully, exposes the expected Outlook tools, and has a broad passing Jest suite.

The current working tree was cleaned and committed after a stabilization pass. `git status` was clean after the latest commits.

## Recent Stabilization Commits

- `e618607 fix(security): harden oauth state and attachment downloads`
  - Validates OAuth callback `state` values in `auth/oauth-server.js`.
  - Rejects invalid or replayed OAuth states.
  - Sanitizes attachment filenames before writing downloaded files.
  - Adds regression tests for OAuth state mismatch/replay and attachment path traversal-style filenames.

- `aab0ec6 test(auth): isolate device code state path`
  - Adds `OUTLOOK_DEVICE_CODE_STATE_PATH` override.
  - Keeps device-code auth tests from touching the real home-directory pending auth file.

- `157462c chore: sync lockfile version and ignore npm cache`
  - Syncs `package-lock.json` version from `3.7.4` to `3.8.1`.
  - Ignores `.npm-cache/`.
  - Removes generated `.npm-cache/` from the working tree.

## Verification Evidence

Commands run successfully:

```bash
npm test
```

Result:

```text
Test Suites: 29 passed, 29 total
Tests: 751 passed, 751 total
Snapshots: 0 total
```

```bash
npm run lint
```

Result:

```text
0 errors, 25 existing warnings
```

MCP stdio smoke test was also run with `USE_TEST_MODE=true`.

Result:

```text
Server: outlook-assistant v3.8.1
Tool count: 22
```

Tools listed:

```text
auth
list-events
create-event
manage-event
search-emails
read-email
send-email
draft
update-email
attachments
export
get-mail-tips
folders
manage-rules
manage-contact
search-people
manage-category
apply-category
manage-focused-inbox
mailbox-settings
access-shared-mailbox
find-meeting-rooms
```

Expected warning without credentials:

```text
TokenStorage: OUTLOOK_CLIENT_ID is not configured. Token operations will fail.
```

This is expected in local test-mode smoke checks without real Azure credentials.

## Production Go-Live Status

Live verification completed on 2026-07-07. Evidence is recorded in `orchestration/STATE.md`:

- Baseline verified: 29 Jest suites / 751 tests passing; lint 0 errors.
- Azure/Entra app configured for device-code auth with public client flows enabled.
- Device-code authentication completed for `david.basseal@vitasci.com.au`.
- Read-only smoke checks passed in order: auth status, auth about, recent email list, read one email, list calendar events, list folders.
- Send safety verified: dry-run preview, recipient allowlist block, session rate limit block, and exactly one live self-send to the owner address.

Next phase: execute Phase 1 from `orchestration/00-SCOPE-PROPOSAL.md` (v3.7.5 polish slate). Keep using device-code auth unless a later task explicitly requires a different auth model.

Recommended MCP client config shape:

```json
{
  "mcpServers": {
    "outlook": {
      "command": "node",
      "args": [
        "/Users/davidbasseal/Developer/EMAIL-Assistant-Repos/outlook-assistant/index.js"
      ],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-azure-application-client-id",
        "OUTLOOK_AUTH_METHOD": "device-code",
        "OUTLOOK_AUTH_AUDIENCE": "common",
        "OUTLOOK_MAX_EMAILS_PER_SESSION": "10",
        "OUTLOOK_ALLOWED_RECIPIENTS": "owner@example.com",
        "OUTLOOK_DEFAULT_TIMEZONE": "Australia/Sydney"
      }
    }
  }
}
```

For device-code auth, `OUTLOOK_CLIENT_SECRET` is not required when Azure public client flow is enabled. Keep real secrets only in local MCP config or local environment files. Do not commit secrets.

## Azure Setup Checklist

Create or update an Azure / Entra app registration:

- Supported account type: Accounts in any organizational directory and personal Microsoft accounts.
- This matches the default `OUTLOOK_AUTH_AUDIENCE=common`.
- Add platform: Mobile and desktop applications.
- Add/check redirect URI:

```text
https://login.microsoftonline.com/common/oauth2/nativeclient
```

- Enable public client flows.
- Add Microsoft Graph delegated permissions:

```text
offline_access
User.Read
Mail.Read
Mail.ReadWrite
Mail.Send
Calendars.Read
Calendars.ReadWrite
Contacts.Read
Contacts.ReadWrite
People.Read
MailboxSettings.ReadWrite
```

Optional work/school-only permissions:

```text
Mail.Read.Shared
Place.Read.All
```

Only set `OUTLOOK_AUTH_AUDIENCE` if the Azure app is not configured for both personal and work/school accounts:

```text
common
consumers
organizations
<tenant-guid>
```

## Live Smoke Test Order

Start with read-only checks only:

1. `auth` with `action=status`
2. `auth` with `action=about`
3. List recent emails
4. Read one email
5. List calendar events
6. List folders

Do not test live sending until read-only checks pass.

When testing sending later:

- Use `dryRun: true` first.
- Keep `OUTLOOK_ALLOWED_RECIPIENTS` configured.
- Keep `OUTLOOK_MAX_EMAILS_PER_SESSION` configured.

## Common Auth Failures

| Failure | Likely Cause | Fix |
|---|---|---|
| `AADSTS7000215` | Used Secret ID instead of secret Value | Create/copy the client secret Value |
| `AADSTS9002331` | Personal-only app using `/common` | Set `OUTLOOK_AUTH_AUDIENCE=consumers` |
| `AADSTS50059` | Single-tenant app using `/common` or no tenant audience | Set `OUTLOOK_AUTH_AUDIENCE=<tenant-guid>` from the app registration's Directory (tenant) ID |
| `AADSTS50011` | Redirect URI mismatch | Add the exact required redirect URI |
| Device code `invalid_client` | Public client flow disabled | Enable public client flows |
| Browser auth URL fails | Auth server not running | Run `npm run auth-server` first |
| `EADDRINUSE :3333` | Port already used | Stop existing process or free port 3333 |
| 403 after auth | Missing Graph permission or consent | Add delegated permissions and re-authenticate |
| New scopes not picked up | Old token file | Delete `~/.outlook-assistant-tokens.json` and authenticate again |

## Important Notes

- `test-direct.sh` is not a valid smoke test for the main MCP server because `index.js` uses stdio transport, not a TCP listener.
- `npm run test-mode` expands to `USE_TEST_MODE=true node index.js`.
- The separate browser auth server is only needed for browser auth:

```bash
npm run auth-server
```

- Browser auth callback URI:

```text
http://localhost:3333/auth/callback
```
