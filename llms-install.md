# Installing Outlook Assistant

## Quick Install (npx — no global install needed)

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "outlook": {
      "command": "npx",
      "args": ["-y", "@littlebearapps/outlook-assistant"],
      "env": {
        "OUTLOOK_CLIENT_ID": "<user-must-provide>",
        "OUTLOOK_CLIENT_SECRET": "<user-must-provide>"
      }
    }
  }
}
```

## Prerequisites

1. **Node.js 18.18 or newer** must be installed
2. **Azure app registration** is required for authentication (free tier works)

## Getting the Client ID and Secret

Users must create an Azure app registration to get credentials:

1. Go to https://portal.azure.com/ and sign in
2. Search for "App registrations" → click "New registration"
3. Name: "Outlook Assistant" (or any name)
4. Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"
5. Redirect URI: platform "Web", URI `http://localhost:3333/auth/callback`
6. Click "Register"
7. Copy the **Application (client) ID** → this is `OUTLOOK_CLIENT_ID`

### Create a client secret:
1. Go to "Certificates & secrets" → "New client secret"
2. Add a description, select expiration, click "Add"
3. **Copy the Value immediately** (not the Secret ID) → this is `OUTLOOK_CLIENT_SECRET`

### Add API permissions:
1. Go to "API permissions" → "Add a permission" → "Microsoft Graph" → "Delegated permissions"
2. Add: `offline_access`, `User.Read`, `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.Read`, `Calendars.ReadWrite`, `Contacts.Read`, `Contacts.ReadWrite`, `People.Read`, `MailboxSettings.ReadWrite`
3. Click "Add permissions"

### Enable device code sign-in (the default auth method):
1. Go to "Authentication" → "Add a platform" → "Mobile and desktop applications"
2. Check `https://login.microsoftonline.com/common/oauth2/nativeclient` and click "Configure"
3. Under "Advanced settings", set "Allow public client flows" to **Yes** and save

## First-Time Authentication

After configuring the MCP server (device code flow, no auth server needed):

1. Use the `auth` tool with `action=authenticate` — it returns a short code and the URL `https://microsoft.com/devicelogin`
2. Open the URL on any device (a private/incognito window avoids cached sessions), enter the code, sign in and grant permissions
3. Use the `auth` tool with `action=device-code-complete` — tokens are saved to `~/.outlook-assistant-tokens.json` and refresh automatically

**Browser redirect flow (alternative)**: start the auth server with `npm run auth-server` from a source checkout, or `node "$(npm root -g)/@littlebearapps/outlook-assistant/outlook-auth-server.js"` from a global install, then call `auth` with `action=authenticate` and `method=browser`. The auth server reads `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` from the environment or a `.env` file in the directory you start it from.

## Optional Settings

Add these to the same `env` block if needed:

| Variable | Purpose |
|----------|---------|
| `OUTLOOK_AUTH_AUDIENCE` | `consumers` for Azure apps registered as personal-accounts-only (fixes `AADSTS9002331`); `organizations` or a tenant GUID for work-only apps. Default `common` |
| `OUTLOOK_DEFAULT_TIMEZONE` | IANA timezone for calendar times (default `Australia/Melbourne`) |
| `OUTLOOK_MAX_EMAILS_PER_SESSION` | Cap on sends per server session |
| `OUTLOOK_ALLOWED_RECIPIENTS` | Comma-separated allowlist of recipient domains/addresses |
| `OUTLOOK_SHARED_MAILBOX` | Opt-in shared-mailbox support, work/school accounts only: `read` or `true` (read and organise). Also add `Mail.Read.Shared` (and `Mail.ReadWrite.Shared` for `true`) in Azure, restart, then run `auth` with `action=authenticate` and `force=true` |

## Configuration Files by Client

### Claude Desktop
File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

### Claude Code
```bash
claude mcp add outlook -- npx @littlebearapps/outlook-assistant
```

### Cursor
File: `.cursor/mcp.json` in your project root

### Windsurf
File: `~/.codeium/windsurf/mcp_config.json`

## Verify Installation

After authentication, test with:
- `auth` tool with `action=status` — should report "Authenticated and ready"
- `auth` tool with `action=about` — shows the connected mailbox, version and granted scopes
- `search-emails` with no parameters — should list recent inbox emails

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Invalid client secret" (AADSTS7000215) | Use the secret **Value**, not the Secret ID. Also check it hasn't expired. v3.11.0+ appends an explanation to Microsoft's raw error |
| Auth URL doesn't work | Browser flow only: start the auth server first. With the default device code flow, use `microsoft.com/devicelogin` |
| Device code "invalid_client" | Enable "Allow public client flows" in Azure → Authentication → Advanced settings |
| "Shared-mailbox support is turned off" | Set `OUTLOOK_SHARED_MAILBOX`, restart, and re-authenticate with `force=true` (work/school accounts only) |
| "EADDRINUSE :3333" | Run `npx kill-port 3333` then restart auth server |
| Empty API responses | Run `auth` tool with `action=status` to check token |
| Search returns no results (personal account) | Use `from`, `subject`, `to` filters instead of `query` |
