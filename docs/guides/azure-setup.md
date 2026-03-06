# Azure Setup Guide

> **Summary**: Register a Microsoft Azure app so Outlook Assistant can access your email, calendar, and contacts through the Microsoft Graph API.

This guide walks through the full Azure setup from scratch, including creating an account if you don't have one. The whole process takes about 10 minutes.

## Prerequisites

- A web browser
- A Microsoft account (personal Outlook.com/Hotmail, or work/school)
- Node.js 18+ and Outlook Assistant installed ([see README](../../README.md#quick-start))

## 1. Create an Azure Account

> **Already have an Azure account?** Skip to [Step 2: Register an App](#2-register-an-app).

Sign up for a free account at [azure.microsoft.com/free](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account). You'll need:

- A phone number for verification
- A credit or debit card

### Important: Payment Method Required

Microsoft **requires** a payment method even for the free tier. Your card won't be charged — there's only a temporary $1 authorisation hold for verification, which is reversed.

However, **if you don't add a payment method**, Microsoft will deactivate your account after approximately 30 days. The app registration you create will stop working.

### What About Costs?

App registration is part of **Microsoft Entra ID Free tier** and costs nothing. You don't need to pay anything to use Outlook Assistant. The free tier includes:

| What | Cost |
|------|------|
| App registration | Free (always) |
| Microsoft Graph API calls (delegated) | Free (always) |
| $200 Azure credit | First 30 days (not needed for Outlook Assistant) |

> **Gotcha**: After 30 days, Azure disables "pay-as-you-go" subscriptions that haven't been upgraded. Your app registration still works because it's part of the always-free Entra ID tier — but you must have a valid payment method on file to keep your account active.

## 2. Register an App

### Navigate to App Registrations

1. Sign in to [portal.azure.com](https://portal.azure.com)
2. In the top search bar, type **App registrations** and select it

> **Note**: App registrations are part of **Microsoft Entra ID** (formerly Azure Active Directory). Microsoft's newer portal at [entra.microsoft.com](https://entra.microsoft.com) also provides access via Identity > Applications > App registrations. Both portals work identically — use whichever you prefer.

### Create the Registration

3. Click **New registration**
4. Fill in the form:

| Field | What to Enter |
|-------|---------------|
| **Name** | `Outlook Assistant Server` (or any name you like — you can change it later) |
| **Supported account types** | Select **Accounts in any organizational directory and personal Microsoft accounts** |
| **Redirect URI — Platform** | Select **Web** |
| **Redirect URI — URI** | `http://localhost:3333/auth/callback` |

5. Click **Register**

### Copy Your Application ID

After registration, you'll see the app's **Overview** page. Copy the **Application (client) ID** — this is a UUID like `12345678-abcd-1234-efgh-123456789012`.

This becomes your `OUTLOOK_CLIENT_ID`.

> **What about Directory (tenant) ID?** You don't need it. Outlook Assistant uses the `/common/` endpoint which supports all account types automatically.

### Account Type Explained

The recommended setting — "any organizational directory and personal Microsoft accounts" — means:

| Account Type | Supported |
|--------------|-----------|
| Personal (Outlook.com, Hotmail, Live) | Yes |
| Work/school (Microsoft 365) | Yes |
| Any organisation's Microsoft 365 | Yes |

If you only use a personal Outlook.com account, you could select "Personal Microsoft accounts only" instead, but the broader setting works for everyone.

## 3. Add API Permissions

Outlook Assistant needs permission to access your mailbox data. These are **delegated permissions** — the app acts on your behalf and can only access what you can access.

### Add the Permissions

1. From your app registration, click **API permissions** in the left sidebar
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Select **Delegated permissions**
5. Search for and check each permission below, then click **Add permissions**

### Required Permissions

| Permission | What It Allows |
|------------|----------------|
| `offline_access` | Keep access between sessions (refresh tokens) |
| `User.Read` | Read your basic profile |
| `Mail.Read` | Read your emails |
| `Mail.ReadWrite` | Read, create, update, and delete emails |
| `Mail.Send` | Send emails on your behalf |
| `Calendars.Read` | Read your calendar events |
| `Calendars.ReadWrite` | Create, update, and delete calendar events |
| `Contacts.Read` | Read your contacts |
| `Contacts.ReadWrite` | Create, update, and delete contacts |
| `MailboxSettings.ReadWrite` | Read and update mailbox settings (auto-replies, working hours, categories) |
| `People.Read` | Search for relevant people |

### Optional Permissions

| Permission | What It Allows |
|------------|----------------|
| `Mail.Read.Shared` | Read shared mailboxes (only if you use the `access-shared-mailbox` tool) |
| `Place.Read.All` | Search for meeting rooms (only if you use the `find-meeting-rooms` tool) |

> **Tip**: You can add all permissions now, or start with the required ones and add optional ones later. You'll need to re-authenticate after adding new permissions.

### For Work/School Accounts: Admin Consent

If you're using a work/school Microsoft 365 account, your organisation may require **admin consent** for certain permissions. This depends on your organisation's **user consent settings** in Microsoft Entra ID — it is not a universal Microsoft requirement. Some organisations restrict users from granting apps access to mail and calendar data without admin approval.

**How to tell if admin consent is needed**: When you try to authenticate, Microsoft will either let you grant permissions yourself, or show a message saying "Need admin approval". If you see the latter, your organisation requires admin consent for this app.

**If you're the admin**: Click the **Grant admin consent for [your organisation]** button on the API permissions page.

**If you're not the admin**: Ask your IT administrator to grant consent. They can do this from the Entra admin centre, or you can share the app's Application ID with them.

**Personal Outlook.com accounts** are not affected — you can grant consent yourself during the OAuth flow.

## 4. Create a Client Secret

The client secret proves your app's identity when requesting tokens.

1. From your app registration, click **Certificates & secrets** in the left sidebar
2. Click the **Client secrets** tab
3. Click **New client secret**
4. Enter a description (e.g. `Outlook Assistant`)
5. Select an expiration:

| Option | When to Use |
|--------|-------------|
| **24 months** | Personal/hobby use (less rotation hassle) |
| **12 months** | Balanced option |
| **6 months** | Microsoft's recommended default for production |

6. Click **Add**

### Copy the Secret Value — Now

After clicking Add, the portal shows three columns:

| Column | What It Is | Use This? |
|--------|-----------|-----------|
| **Description** | The label you entered | No |
| **Value** | The actual secret (e.g. `aB1cD~2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX`) | **YES — this is your `OUTLOOK_CLIENT_SECRET`** |
| **Secret ID** | A GUID identifying the secret object | **NO — do not use this** |

> **WARNING**: The **Value** is only shown once. If you navigate away without copying it, you'll need to create a new secret. Copy it now and store it securely.

The most common setup error is using the **Secret ID** (a UUID) instead of the **Value** (a longer string with special characters). This causes the `AADSTS7000215` error.

### When Your Secret Expires

Set a calendar reminder before your secret expires. To rotate:

1. Create a new secret (while the old one still works)
2. Update your `OUTLOOK_CLIENT_SECRET` configuration
3. Verify authentication works
4. Delete the old secret

## 5. Configure Outlook Assistant

You now have two values:
- **Application (client) ID** → `OUTLOOK_CLIENT_ID`
- **Client secret Value** → `OUTLOOK_CLIENT_SECRET`

### Option A: MCP Client Config (Recommended)

Add to your MCP client config (example for Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "outlook": {
      "command": "npx",
      "args": ["@littlebearapps/outlook-mcp"],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-application-client-id",
        "OUTLOOK_CLIENT_SECRET": "your-client-secret-VALUE"
      }
    }
  }
}
```

### Option B: Environment File

If running from source, create a `.env` file:

```bash
OUTLOOK_CLIENT_ID=your-application-client-id
OUTLOOK_CLIENT_SECRET=your-client-secret-VALUE
USE_TEST_MODE=false
```

> **Backwards compatibility**: The server also accepts `MS_CLIENT_ID` and `MS_CLIENT_SECRET`.

## Verify It Works

### 1. Start the Auth Server

```bash
npm run auth-server
```

> **Note**: The auth server reads `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` from environment variables (or the legacy `MS_CLIENT_ID`/`MS_CLIENT_SECRET` aliases). When running from source, ensure your `.env` file is in the project root. When using an MCP client, the env vars from your MCP config are passed automatically to the server process.

You should see:

```
Auth server listening on http://localhost:3333
```

### 2. Authenticate

In your AI assistant, use the `auth` tool with `action=authenticate`. It returns a Microsoft login URL.

1. Open the URL in your browser
2. Sign in with your Microsoft account
3. Review and accept the requested permissions
4. You'll see a success message in the browser

Tokens are saved to `~/.outlook-mcp-tokens.json` and refresh automatically.

### 3. Verify Access

In your AI assistant, use the `auth` tool with `action=status`. You should see:

```
Authenticated as: your.email@outlook.com
```

Then try `search-emails` to confirm email access is working.

## Troubleshooting

### AADSTS7000215: Invalid Client Secret

**Cause**: You're using the Secret **ID** instead of the Secret **Value**.

**Fix**: Go to Azure Portal > your app > **Certificates & secrets**. If you can still see the Value, copy it. If not, create a new secret and copy the Value immediately.

**Other causes**:
- Secret has expired (check the expiration date)
- Whitespace was accidentally included when copying
- The secret belongs to a different app registration

---

### AADSTS50011: Redirect URI Mismatch

**Cause**: The redirect URI in your app registration doesn't match what the auth server sends.

**Fix**:
1. Go to Azure Portal > your app > **Authentication**
2. Under Platform configurations, check that `http://localhost:3333/auth/callback` is listed
3. Make sure the platform is **Web** (not SPA or Mobile)
4. The URI must match exactly — check for typos, trailing slashes, and http vs https

---

### Permission Denied / 403 Errors

**Cause**: Missing API permissions or consent not granted.

**Fix**:
1. Check that all required permissions are added (see [Step 3](#3-add-api-permissions))
2. For work accounts: admin consent may be required — ask your IT admin
3. Delete `~/.outlook-mcp-tokens.json` and re-authenticate to pick up new permissions

---

### Token Refresh Fails After Days/Weeks

**Cause**: Refresh tokens can expire after extended inactivity (90+ days) or when passwords change.

**Fix**: Delete `~/.outlook-mcp-tokens.json` and re-authenticate:

```bash
rm ~/.outlook-mcp-tokens.json
npm run auth-server
# Then use the auth tool with action=authenticate in your AI assistant
```

---

### "EADDRINUSE: address already in use :::3333"

**Cause**: The auth server port is already in use.

**Fix**:

```bash
npx kill-port 3333
npm run auth-server
```

---

### Missing Permissions / Scope Mismatch After Adding New Permissions

**Cause**: You added new API permissions in Azure Portal but your existing tokens still have the old scopes.

**Fix**: Delete your token file and re-authenticate to pick up the new permissions:

```bash
rm ~/.outlook-mcp-tokens.json
npm run auth-server
# Then use the auth tool with action=authenticate in your AI assistant
```

After re-authenticating, use the `auth` tool with `action=status` to verify the new scopes appear in the token.

## What's Next?

- [Connect Outlook to Your AI Assistant](../how-to/getting-started/connect-outlook-to-claude.md) — Install, configure your MCP client, and authenticate
- [README](../../README.md) — Full feature overview and configuration
- [Tools Reference](../quickrefs/tools-reference.md) — All 20 tools with parameters
- [Back to Docs](../README.md)
