---
title: "How to Verify Your Outlook Connection"
description: "Check your authentication status, re-authenticate after token expiry, and confirm which account is connected."
tags: [outlook-mcp, getting-started, how-to]
---

# How to Verify Your Outlook Connection

Check whether Outlook MCP is authenticated, see which account is connected, and re-authenticate when tokens expire.

## Check Authentication Status

Ask Claude:

> "Check my Outlook auth status"

Claude calls the `auth` tool:

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

<!-- SCREENSHOT: auth tool status output showing authenticated user -->

## Re-authenticate After Token Expiry

Tokens expire periodically (typically after 1 hour, with automatic refresh). If refresh fails, re-authenticate:

1. Start the auth server:

```bash
npx @littlebearapps/outlook-mcp auth-server
```

2. Ask Claude:

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

> "Show Outlook MCP server info"

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
| Auth succeeds but API calls fail | Insufficient permissions | Add missing permissions in [Azure Portal](https://portal.azure.com) and re-consent |
| "AADSTS700082" | Refresh token expired (>90 days inactive) | Re-authenticate with `force: true` |
| Token file exists but auth reports failure | Corrupted token file | Delete `~/.outlook-mcp-tokens.json` and re-authenticate |

## Tips

- Tokens auto-refresh in the background — you rarely need to manually re-authenticate
- If you switch Microsoft accounts, use `force: true` to authenticate with the new account
- The token file at `~/.outlook-mcp-tokens.json` contains sensitive credentials — don't share or commit it

## Related

- [Connect Outlook to Claude](connect-outlook-to-claude.md) — initial setup walkthrough
- [Azure Setup Guide](../../guides/azure-setup.md) — app registration and permissions
- [Tools Reference — auth](../../quickrefs/tools-reference.md#auth-1-tool) — full parameter reference
