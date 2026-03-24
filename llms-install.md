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

1. **Node.js 18+** must be installed
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

## First-Time Authentication

After configuring the MCP server:

1. Start the auth server: `npx @littlebearapps/outlook-assistant-auth` (or run `npm run auth-server` from source)
2. Use the `auth` tool with `action=authenticate` to get an OAuth URL
3. Open the URL in a browser, sign in with your Microsoft account
4. Grant permissions — tokens are saved to `~/.outlook-assistant-tokens.json` and refresh automatically

**Note**: The auth server needs `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` as environment variables. If running it separately from the MCP server, export them in your shell or create a `.env` file.

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
- `auth` tool with `action=status` — should show "authenticated"
- `search-emails` with no parameters — should list recent inbox emails

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Invalid client secret" (AADSTS7000215) | Use the secret **Value**, not the Secret ID |
| Auth URL doesn't work | Start the auth server first |
| "EADDRINUSE :3333" | Run `npx kill-port 3333` then restart auth server |
| Empty API responses | Run `auth` tool with `action=status` to check token |
| Search returns no results (personal account) | Use `from`, `subject`, `to` filters instead of `query` |
