---
title: "How to Connect Outlook to Your AI Assistant"
description: "Set up Outlook Assistant so your AI assistant can read and manage your email, calendar, and contacts."
tags: [outlook-assistant, getting-started, how-to]
---

# How to Connect Outlook to Your AI Assistant

Connect your Microsoft 365 or Outlook.com account so your AI assistant can search emails, manage your calendar, and work with contacts on your behalf.

## Install Outlook Assistant

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

Outlook Assistant needs an Azure app registration to access the Microsoft Graph API. This is free and takes about 10 minutes.

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

![Claude Desktop config file with Outlook Assistant entry highlighted](../../assets/screenshots/connect-outlook-to-claude-01.png)

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

Any MCP-compatible client can use Outlook Assistant. Set the command to `npx -y @littlebearapps/outlook-mcp` and pass the two environment variables.

## Understanding the Two Processes

Outlook Assistant has two separate processes that serve different purposes:

| Process | Purpose | When to run | How it runs |
|---------|---------|-------------|-------------|
| **MCP server** (`index.js`) | Handles all 20 Outlook tools — searching emails, reading calendar, etc. | Always (runs automatically) | Your MCP client starts it from your MCP config |
| **Auth server** (`outlook-auth-server.js`) | Handles OAuth login — the one-time browser authentication flow | Only during initial setup or re-authentication | You start it manually with `npx @littlebearapps/outlook-mcp auth-server` |

**Key points:**
- The **MCP server** is what your AI assistant talks to. It starts automatically when your MCP client launches.
- The **auth server** is a temporary helper that runs on port 3333 to receive the OAuth callback from Microsoft. You only need it when authenticating or re-authenticating.
- After authentication succeeds, you can stop the auth server. The MCP server handles token refresh on its own.
- Both processes need `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET`. The MCP config `"env"` block provides these to the MCP server automatically. For the auth server, you need to either set them as shell environment variables or have a `.env` file in the project root.

## Authenticate for the First Time

1. Start the OAuth server:

```bash
npx @littlebearapps/outlook-mcp auth-server
```

> **Important**: The auth server needs `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` environment variables. These are **not** automatically inherited from your MCP client's config — that config only applies to the MCP server process. Either:
> - Create a `.env` file in the project root (copy from `.env.example`), or
> - Export the variables in your shell before running the command

2. Ask your AI assistant to authenticate:

> "Connect to my Outlook account"

Your AI assistant will call the `auth` tool with `action: authenticate` and return a URL.

3. Open the URL in your browser, sign in with your Microsoft account, and grant permissions.

![Microsoft permissions consent screen during OAuth](../../assets/screenshots/connect-outlook-to-claude-02.png)

4. After granting access, the browser redirects to `localhost:3333` and tokens are saved automatically to `~/.outlook-mcp-tokens.json`.

## Verify It's Working

Ask your AI assistant:

> "Check my Outlook connection status"

The `auth` tool is called with `action: status`. You should see your email address and token expiry time.

![Auth tool success message showing authenticated status](../../assets/screenshots/connect-outlook-to-claude-03.png)

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
