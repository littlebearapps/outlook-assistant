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
        "OUTLOOK_CLIENT_ID": "<user-must-provide>"
      }
    }
  }
}
```

## Plugin Install (Claude Code, GitHub Copilot CLI, Cursor)

The plugin in `plugins/outlook-assistant/` runs a pinned server version and adds the `using-outlook-assistant` skill and a safety hook that asks the user before sends, deletes, rules and automatic replies.

- Claude Code: `claude plugin marketplace add littlebearapps/outlook-assistant`, then `claude plugin install outlook-assistant@littlebearapps`. The plugin asks for its settings (client ID, read-only mode, confirmation level and others) when enabled.
- GitHub Copilot CLI: `copilot plugin marketplace add littlebearapps/outlook-assistant`, then `copilot plugin install outlook-assistant@littlebearapps`. No plugin settings: the user gives the client ID at sign-in, and the hook's confirmation level comes from the `OUTLOOK_CONFIRM_LEVEL` environment variable (`outward`, `all-writes` or `off`).
- Cursor (v3.14.0 plugin or later): loads the folder as a Cursor plugin (`.cursor-plugin/plugin.json`); in Cursor CLI, pass it with `--plugin-dir`. The v3.13.0 plugin fails sign-in in Cursor with `AADSTS900023`; use the manual config instead.

Client limits (for example, Cursor's prompt doesn't show the hook's reason): `docs/how-to/getting-started/supported-clients.md`.

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

If the client ID is left out of the config, the `auth` tool asks for it at sign-in (`auth action=authenticate clientId=<id>`) and saves it to `~/.outlook-assistant-config.json`.

### Create a client secret (browser flow only):
The default device-code sign-in doesn't need a secret; skip this unless you'll use `method=browser`, and then add `OUTLOOK_CLIENT_SECRET` to the `env` block.
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
| `OUTLOOK_MAX_EMAILS_PER_SESSION` | Default per-session cap for `send-email`, `draft` and `manage-rules` (override one tool with `OUTLOOK_MAX_<TOOL>_PER_SESSION`, e.g. `OUTLOOK_MAX_SEND_EMAIL_PER_SESSION`) |
| `OUTLOOK_ALLOWED_RECIPIENTS` | Comma-separated allowlist of recipient domains/addresses |
| `OUTLOOK_READ_ONLY` | `true` refuses every tool call that would change something (sending, drafts, moves, deletes, rules, settings, file writes), dry runs included; reads and sign-in still work |
| `OUTLOOK_SHARED_MAILBOX` | Opt-in shared-mailbox support, work/school accounts only: `read` or `true` (read and organise). Also add `Mail.Read.Shared` (and `Mail.ReadWrite.Shared` for `true`) in Azure, restart, then run `auth` with `action=authenticate` and `force=true` |
| `OUTLOOK_SEARCH_SCAN_LIMIT` | Messages scanned by the local search fallback on personal accounts (default 500, max 5000) |
| `OUTLOOK_REQUEST_TIMEOUT_MS` | Per-attempt Graph inactivity timeout in milliseconds (default 60000); not an overall deadline |
| `OUTLOOK_DEBUG` | `true` for detailed stderr logs while troubleshooting (addresses and IDs redacted). Off by default: one line per tool call, no arguments |

Run `npx @littlebearapps/outlook-assistant --help` for the full list of environment variables.

`OUTLOOK_CONFIRM_LEVEL` is not a server variable: the plugin's safety hook reads it from the client's environment in GitHub Copilot, VS Code and Cursor. Don't put it in the server's `env` block.

## Configuration Files by Client

### Claude Desktop
File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

### Claude Code
```bash
claude mcp add outlook -e OUTLOOK_CLIENT_ID=<user-must-provide> -- npx -y @littlebearapps/outlook-assistant
```

### VS Code / GitHub Copilot
File: `.vscode/mcp.json` in your project root, or the user `mcp.json` (Command Palette → **MCP: Open User Configuration**). VS Code uses a top-level `servers` key instead of `mcpServers`, with `"type": "stdio"` on the entry.

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
| "Authentication required." | Sign in with `auth` `action=authenticate`; `action=status` shows whether a token is saved |
| Search returns no results (personal account) | Use `from`, `subject`, `to` filters instead of `query` |
