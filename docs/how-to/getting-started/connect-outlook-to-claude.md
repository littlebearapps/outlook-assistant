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
npm install -g @littlebearapps/outlook-assistant
```

Or clone and install locally:

```bash
git clone https://github.com/littlebearapps/outlook-assistant.git
cd outlook-assistant
npm install
```

## Register an Azure App

Outlook Assistant needs an Azure app registration to access the Microsoft Graph API. This is free and takes about 10 minutes.

Follow the full walkthrough in the [Azure Setup Guide](../../guides/azure-setup.md), or the short version:

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration** (no redirect URI needed at this stage)
3. Under **Certificates & secrets**, create a new client secret — copy the **Value** (not the Secret ID)
4. Under **Authentication** > **Add a platform** > **Mobile and desktop applications** — check `https://login.microsoftonline.com/common/oauth2/nativeclient`
5. Under **Authentication** > **Advanced settings** — set **"Allow public client flows"** to **Yes**
6. Under **API permissions**, add these Microsoft Graph **delegated** permissions:
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
      "args": ["-y", "@littlebearapps/outlook-assistant"],
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
      "args": ["-y", "@littlebearapps/outlook-assistant"],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-client-id",
        "OUTLOOK_CLIENT_SECRET": "your-secret-value"
      }
    }
  }
}
```

### Other MCP Clients

Any MCP-compatible client can use Outlook Assistant. Set the command to `npx -y @littlebearapps/outlook-assistant` and pass the two environment variables.

## Authenticate for the First Time

### Device Code Flow (Recommended)

The device code flow works everywhere — no auth server, no SSH tunnels, no port forwarding. Ideal for remote, headless, and standard setups alike.

> **Azure prerequisite**: In Azure Portal > App registrations > your app > **Authentication** > Advanced settings, set **"Allow public client flows"** to **Yes**.

1. Ask your AI assistant to authenticate:

> "Connect to my Outlook account"

Your AI assistant will call the `auth` tool with `action: authenticate`. You'll receive a short code and a URL.

2. Visit the URL (https://microsoft.com/devicelogin) in a **private/incognito browser window**, on any device — it doesn't need to be the same machine running Outlook Assistant.

> **Tip**: Use incognito/private browsing to avoid cached sessions from previous OAuth flows interfering with device code sign-in.

3. Enter the code, sign in with your Microsoft account, and grant permissions.

![Microsoft permissions consent screen during OAuth](../../assets/screenshots/connect-outlook-to-claude-02.png)

4. Tell your AI assistant you've completed sign-in. It will call `auth` with `action: device-code-complete` to finish authentication. Tokens are saved to `~/.outlook-assistant-tokens.json`.

### Browser Redirect Flow (Alternative)

If you prefer the traditional OAuth browser redirect (e.g. for localhost development):

1. Start the auth server:

```bash
npx @littlebearapps/outlook-assistant auth-server
```

> **Important**: The auth server needs `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` environment variables. Either:
> - Create a `.env` file in the project root (copy from `.env.example`), or
> - Export the variables in your shell before running the command

2. Ask your AI assistant:

> "Connect to my Outlook account using browser auth"

Your AI assistant will call the `auth` tool with `action: authenticate, method: browser` and return a URL.

3. Open the URL in your browser, sign in, and grant permissions. After granting access, the browser redirects to `localhost:3333` and tokens are saved automatically to `~/.outlook-assistant-tokens.json`.

4. You can stop the auth server after authentication succeeds.

## Understanding the Processes

| Process | Purpose | When to run |
|---------|---------|-------------|
| **MCP server** (`index.js`) | Handles all 21 Outlook tools | Always — your MCP client starts it automatically |
| **Auth server** (`outlook-auth-server.js`) | Handles browser OAuth redirect flow | Only if using `method=browser` during authentication |

**Key points:**
- With **device code flow** (default), you only need the MCP server — no auth server needed at all.
- The **auth server** is only required for the browser redirect flow. It runs on port 3333 to receive the OAuth callback.
- **Tokens auto-refresh** in the background. You rarely need to re-authenticate (only after ~90 days of inactivity).

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
| Auth URL doesn't open | Start the auth server first with `npx @littlebearapps/outlook-assistant auth-server` |
| Permissions error after login | Check API permissions in Azure Portal and grant admin consent if required |
| Token file not found | Tokens are stored at `~/.outlook-assistant-tokens.json` — check the file exists after auth |

## Related

- [Azure Setup Guide](../../guides/azure-setup.md) — full Azure walkthrough with screenshots
- [Verify Your Connection](verify-your-connection.md) — check auth status and re-authenticate
- [Find Emails](../email/find-emails.md) — your first search after connecting
- [Tools Reference](../../quickrefs/tools-reference.md) — all 22 tools with parameters
