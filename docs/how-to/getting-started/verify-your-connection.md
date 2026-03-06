---
title: "How to Verify Your Outlook Connection"
description: "Check your authentication status, re-authenticate after token expiry, and confirm which account is connected."
tags: [outlook-mcp, getting-started, how-to]
---

# How to Verify Your Outlook Connection

Check whether Outlook Assistant is authenticated, see which account is connected, and re-authenticate when tokens expire.

## Check Authentication Status

Ask your AI assistant:

> "Check my Outlook auth status"

The `auth` tool is called:

```
tool: auth
params:
  action: status
```

A healthy response shows:

- **Authenticated**: Yes
- **Account**: your-email@outlook.com
- **Token expires**: date and time
- **Scopes**: the permissions granted

If the token has expired, the tool will report it and suggest re-authenticating.

![Auth tool status output showing authenticated user](../../assets/screenshots/verify-your-connection-01.png)

## Re-authenticate After Token Expiry

Tokens expire periodically (typically after 1 hour, with automatic refresh). If refresh fails, re-authenticate:

1. Start the auth server:

```bash
npx @littlebearapps/outlook-mcp auth-server
```

2. Ask your AI assistant:

> "Re-authenticate my Outlook account"

```
tool: auth
params:
  action: authenticate
  force: true
```

The `force: true` parameter bypasses the existing (expired) token and starts a fresh OAuth flow.

3. Open the URL, sign in, and grant permissions as before.

## Check Server Information

To see the server version and capabilities:

> "Show Outlook Assistant server info"

```
tool: auth
params:
  action: about
```

This returns the server version, available tools, and configuration details.

## Common Connection Problems

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Not authenticated" | No token file exists | Run through the [initial setup](connect-outlook-to-claude.md) |
| "Token expired" with auto-refresh failure | Refresh token revoked or client secret changed | Re-authenticate with `force: true` |
| Auth succeeds but API calls fail with 403 | Insufficient permissions | Add missing permissions in [Azure Portal](https://portal.azure.com), then delete `~/.outlook-mcp-tokens.json` and re-authenticate to pick up new scopes |
| "AADSTS700082" | Refresh token expired (>90 days inactive) | Re-authenticate with `force: true` |
| "AADSTS7000215" | Client secret is wrong (using Secret ID instead of Value) or has expired | Check [Azure Setup Guide — Client Secret](../../guides/azure-setup.md#4-create-a-client-secret) |
| "Need admin approval" during OAuth | Organisation requires admin consent | Ask your IT admin to grant consent — see [Admin Consent](../../guides/azure-setup.md#for-workschool-accounts-admin-consent) |
| Token file exists but auth reports failure | Corrupted token file | Delete `~/.outlook-mcp-tokens.json` and re-authenticate |
| Auth server says "missing client ID" | Auth server does not have env vars | Create a `.env` file or export `OUTLOOK_CLIENT_ID`/`OUTLOOK_CLIENT_SECRET` in your shell — see [Connect guide](connect-outlook-to-claude.md#authenticate-for-the-first-time) |
| `search-emails` returns no results | Personal account `$search` limitation | Use `subject`, `from`, `to`, `receivedAfter` filters instead of `query` — see [Known Limitations](../../../README.md#known-limitations) |

## Tips

- Tokens auto-refresh in the background — you rarely need to manually re-authenticate
- If you switch Microsoft accounts, use `force: true` to authenticate with the new account
- The token file at `~/.outlook-mcp-tokens.json` contains sensitive credentials — don't share or commit it

## Frequently Asked Questions

### How often do I need to re-authenticate?

Rarely. Access tokens expire after about 1 hour, but the MCP server automatically refreshes them using the refresh token stored in `~/.outlook-mcp-tokens.json`. Refresh tokens last up to 90 days of inactivity. You only need to manually re-authenticate if:

- You have not used Outlook Assistant for more than 90 days
- You changed your Microsoft account password
- Your client secret expired (check the expiration date in Azure Portal)
- An admin revoked your app's consent

### Can I use Outlook Assistant on multiple computers?

Yes, but each computer needs its own authentication. The token file (`~/.outlook-mcp-tokens.json`) is stored locally and is not shared between machines. Run through the [authentication steps](connect-outlook-to-claude.md#authenticate-for-the-first-time) on each computer.

Your Azure app registration and client credentials (`OUTLOOK_CLIENT_ID`/`OUTLOOK_CLIENT_SECRET`) are the same across all computers — only the token file differs.

### What is the auth server and do I need it running all the time?

No. The auth server (port 3333) is only needed during the OAuth login flow. Once you have authenticated and tokens are saved, you can stop it. See [Understanding the Two Processes](connect-outlook-to-claude.md#understanding-the-two-processes) for details.

### My client secret is expiring soon — how do I rotate it?

See [When Your Secret Expires](../../guides/azure-setup.md#when-your-secret-expires) in the Azure Setup Guide.

## Related

- [Connect Outlook to Your AI Assistant](connect-outlook-to-claude.md) — initial setup walkthrough
- [Azure Setup Guide](../../guides/azure-setup.md) — app registration and permissions
- [Tools Reference — auth](../../quickrefs/tools-reference.md#auth-1-tool) — full parameter reference
