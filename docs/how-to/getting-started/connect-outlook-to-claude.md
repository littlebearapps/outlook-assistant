---
title: "How to Connect Outlook to Claude"
description: "Set up Outlook MCP so Claude can read and manage your email, calendar, and contacts."
tags: [outlook-mcp, getting-started, how-to]
---

# How to Connect Outlook to Claude

Connect your Microsoft 365 or Outlook.com account so Claude can search emails, manage your calendar, and work with contacts on your behalf.

## Install Outlook MCP

Install the package globally:

```bash
npm install -g @littlebearapps/outlook-mcp
```

Or clone and install locally:

```bash
git clone https://github.com/littlebearapps/outlook-mcp.git
cd outlook-mcp
npm install
```

## Register an Azure App

Outlook MCP needs an Azure app registration to access the Microsoft Graph API. This is free and takes about 10 minutes.

Follow the full walkthrough in the [Azure Setup Guide](../../guides/azure-setup.md), or the short version:

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Set the redirect URI to `http://localhost:3333/auth/callback` (platform: **Web**)
4. Under **Certificates & secrets**, create a new client secret — copy the **Value** (not the Secret ID)
5. Under **API permissions**, add these Microsoft Graph **delegated** permissions:
   - `offline_access` — refresh tokens between sessions
   - `User.Read` — basic profile
   - `Mail.Read`, `Mail.ReadWrite`, `Mail.Send` — email operations
   - `Calendars.Read`, `Calendars.ReadWrite` — calendar operations
   - `Contacts.Read`, `Contacts.ReadWrite` — contact management
   - `MailboxSettings.ReadWrite` — settings, categories, auto-replies
   - `People.Read` — people search

**Optional** (work/school accounts only):
   - `Mail.Read.Shared` — shared mailbox access
   - `Place.Read.All` — meeting room search (requires admin consent)

> **Common mistake**: Copy the secret **Value**, not the Secret ID. Using the wrong one causes `AADSTS7000215` errors.

## Add to Your AI Tool

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "outlook": {
      "command": "npx",
      "args": ["-y", "@littlebearapps/outlook-mcp"],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-client-id",
        "OUTLOOK_CLIENT_SECRET": "your-secret-value"
      }
    }
  }
}
```

![Claude Desktop config file with Outlook MCP entry highlighted](../../assets/screenshots/connect-outlook-to-claude-01.png)

### Claude Code

Add to your `.mcp.json` or project settings:

```json
{
  "mcpServers": {
    "outlook": {
      "command": "npx",
      "args": ["-y", "@littlebearapps/outlook-mcp"],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-client-id",
        "OUTLOOK_CLIENT_SECRET": "your-secret-value"
      }
    }
  }
}
```

### Other MCP Clients

Any MCP-compatible client can use Outlook MCP. Set the command to `npx -y @littlebearapps/outlook-mcp` and pass the two environment variables.

## Authenticate for the First Time

1. Start the OAuth server:

```bash
npx @littlebearapps/outlook-mcp auth-server
```

> **Note**: The auth server needs `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` environment variables. When using Claude Desktop or Claude Code, these are passed from your MCP config automatically. When running from source, ensure your `.env` file is in the project root.

2. Ask Claude to authenticate:

> "Connect to my Outlook account"

Claude will call the `auth` tool with `action: authenticate` and return a URL.

3. Open the URL in your browser, sign in with your Microsoft account, and grant permissions.

![Microsoft permissions consent screen during OAuth](../../assets/screenshots/connect-outlook-to-claude-02.png)

4. After granting access, the browser redirects to `localhost:3333` and tokens are saved automatically to `~/.outlook-mcp-tokens.json`.

## Verify It's Working

Ask Claude:

> "Check my Outlook connection status"

Claude calls the `auth` tool with `action: status`. You should see your email address and token expiry time.

![Claude showing auth tool success message](../../assets/screenshots/connect-outlook-to-claude-03.png)

Then try a simple read:

> "Show me my last 5 emails"

If you see your recent emails, everything is connected.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `AADSTS7000215` (invalid secret) | Use the secret **Value**, not the Secret ID |
| `EADDRINUSE :3333` | Run `npx kill-port 3333` then restart the auth server |
| Auth URL doesn't open | Start the auth server first with `npx @littlebearapps/outlook-mcp auth-server` |
| Permissions error after login | Check API permissions in Azure Portal and grant admin consent if required |
| Token file not found | Tokens are stored at `~/.outlook-mcp-tokens.json` — check the file exists after auth |

## Related

- [Azure Setup Guide](../../guides/azure-setup.md) — full Azure walkthrough with screenshots
- [Verify Your Connection](verify-your-connection.md) — check auth status and re-authenticate
- [Find Emails](../email/find-emails.md) — your first search after connecting
- [Tools Reference](../../quickrefs/tools-reference.md) — all 20 tools with parameters
