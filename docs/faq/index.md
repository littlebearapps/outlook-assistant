---
title: "Outlook Assistant — Frequently Asked Questions"
description: "Common questions about Outlook Assistant: installation, supported accounts, Azure permissions, token storage, send safety controls, updates, and uninstall."
---

# Frequently Asked Questions

> Quick answers to the questions users ask most often. Also surfaced at <https://littlebearapps.com/help/outlook-assistant/faq/>.

For full setup steps, see [Getting Started](how-to/getting-started/connect-outlook-to-claude.md). For known issues and recovery steps, see [Troubleshooting](troubleshooting.md).

## How do I install Outlook Assistant?

The fastest path is to use `npx` directly in your MCP client config — no global install required:

```json
{
  "mcpServers": {
    "outlook": {
      "command": "npx",
      "args": ["@littlebearapps/outlook-assistant"],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-application-client-id",
        "OUTLOOK_CLIENT_SECRET": "your-client-secret-VALUE"
      }
    }
  }
}
```

If you prefer a global install, `npm install -g @littlebearapps/outlook-assistant`. From source, clone the repo and run `npm install`. You also need a Microsoft Azure app registration (free tier is sufficient) — see the [Azure Setup Guide](guides/azure-setup.md) for a full walkthrough including first-time Azure account creation.

Configuration snippets for Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Codex CLI, Gemini CLI, and OpenCode are in the [README](../README.md#3-configure-your-mcp-client).

## Does Outlook Assistant work with personal Outlook.com accounts?

Yes. Outlook Assistant supports both personal Microsoft accounts (Outlook.com, Hotmail, Live.com) and work/school Microsoft 365 accounts. A few features are 365-only because Microsoft Graph itself doesn't expose them on personal accounts — meeting room search (`find-meeting-rooms`), shared mailbox access (`access-shared-mailbox`), pre-send mail tips (`get-mail-tips`), and Focused Inbox routing.

On personal accounts, Microsoft's `$search` API has limited support for free-text queries, so Outlook Assistant falls back through up to four progressive search strategies (server `$search` → `contains(subject)` → client-side body/subject/from scan → recent message listing) and exposes which strategy ran in the response's `_meta.searchMetadata` block. For the most direct results, use structured filters (`from`, `subject`, `to`, `receivedAfter`) where possible. The full per-feature compatibility matrix is in the [README's Account Compatibility section](../README.md#account-compatibility).

## What Microsoft Graph permissions does Outlook Assistant need, and why?

Outlook Assistant uses delegated Microsoft Graph permissions — it accesses your mailbox on your behalf, never with elevated rights:

- **`offline_access`** — issues refresh tokens so you don't have to sign in every hour
- **`User.Read`** — your display name and email, shown in `auth about` so you can confirm which mailbox is connected
- **`Mail.Read`, `Mail.ReadWrite`, `Mail.Send`** — email operations across the 8 email tools
- **`Calendars.Read`, `Calendars.ReadWrite`** — events listing, creation, and management
- **`Contacts.Read`, `Contacts.ReadWrite`** — contact CRUD via `manage-contact`
- **`MailboxSettings.ReadWrite`** — auto-replies, working hours, master categories, Focused Inbox overrides
- **`People.Read`** — `search-people` relevance-ranked lookups

Two permissions are work/school only and optional: **`Mail.Read.Shared`** for shared mailboxes and **`Place.Read.All`** (admin consent required) for meeting room search. You grant these once during initial sign-in; they're scoped to your account and revocable any time at <https://account.live.com/consent/manage> (personal) or in your tenant admin console (work/school).

## Where are my tokens stored, and what happens when they expire?

Access and refresh tokens are stored at **`~/.outlook-assistant-tokens.json`** with file mode `0o600` (owner read/write only). Token refresh is automatic — the access token (~60 minutes) refreshes transparently via the stored refresh token, so the only time you'll re-authenticate is when the **refresh token expires (~90 days)**. From v3.7.2 onward, refresh works correctly for both public and confidential client flows.

If tokens get corrupted or stuck:

```bash
rm ~/.outlook-assistant-tokens.json ~/.outlook-assistant-pending-auth.json
# Then call the auth tool again with action=authenticate
```

The pending-auth file (also at `~/.outlook-assistant-pending-auth.json`, also `0o600`) only exists between calling `authenticate` and `device-code-complete` — its purpose is to make device-code auth survive MCP server restarts (Untether/Telegram bridges, Claude Desktop session changes, etc.).

## Can I use Outlook Assistant in read-only mode?

Yes. Two layers of control let you scope what Outlook Assistant can do:

1. **Azure permissions.** When you register the app, request only the read scopes — `Mail.Read`, `Calendars.Read`, `Contacts.Read`, `User.Read`, `offline_access` — and skip the `*ReadWrite` and `Mail.Send` scopes. Tools that need write access will fail at the Graph layer, which is the correct behaviour.
2. **Send-safety belts.** Even with full permissions, you can configure `OUTLOOK_MAX_EMAILS_PER_SESSION` (rate cap on `send-email` + `draft send`) and `OUTLOOK_ALLOWED_RECIPIENTS` (allowlist of approved addresses or domains). `auth action=about` reports their state and prints a setup hint when unset. See the [Recommended setup snippet](../README.md#safety--token-efficiency) in the README and [`.mcp.json.example`](../.mcp.json.example) for the copy-paste template.

Every tool also carries [MCP annotations](https://modelcontextprotocol.io/docs/concepts/tools#annotations) (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so AI clients can auto-approve safe reads and prompt for confirmation on destructive operations.

## Why does Outlook Assistant need an Azure app registration?

Microsoft Graph (the API behind Outlook, Teams, OneDrive, etc.) requires every client application to be registered in Microsoft Entra ID before it can request delegated access on a user's behalf. The app registration gives Microsoft three things: (1) a client ID so they know which application is asking, (2) a redirect URI / public-client mode for the OAuth flow, and (3) a list of scopes the app may request. Without registration, OAuth would have no entry point.

Microsoft does not offer a "shared multi-tenant client ID" that any open-source project can reuse — every published Outlook MCP server has the same requirement. We're tracking [#147](https://github.com/littlebearapps/outlook-assistant/issues/147) (publisher-verified shared multi-tenant app) for a future release where Little Bear Apps publishes a verified shared app users can authorise without creating their own registration. Until then, the [Azure Setup Guide](guides/azure-setup.md) walks through the process in about 10 minutes.

## What's the difference between device code and browser authentication?

**Device code flow (default in v3.1.0+, recommended)** doesn't need an auth server, port forwarding, or local browser — you call `auth action=authenticate`, visit a URL on any device with the displayed code, sign in, then call `auth action=device-code-complete`. It works headless, over SSH, and through remote bridges like Telegram. Device code state is persisted to `~/.outlook-assistant-pending-auth.json` so the flow survives MCP server restarts (a real issue for hosts that restart between tool calls; fixed in v3.7.2).

**Browser redirect flow (optional)** runs a local auth server on port 3333 and uses the standard OAuth redirect URI (`http://localhost:3333/auth/callback`). Convenient on a graphical workstation, but it needs an open port and a local browser — neither is available in many MCP host environments. Start it with `npm run auth-server`, then call `auth action=authenticate method=browser`.

Most users should pick device code unless they have a specific reason to use the redirect flow. Both write to the same token file and the resulting MCP server behaviour is identical.

## How do I update Outlook Assistant?

Outlook Assistant is published to npm as **`@littlebearapps/outlook-assistant`**. The simplest path is to let your MCP client pick up the latest version automatically — most clients call `npx @littlebearapps/outlook-assistant` which fetches the latest published version on each spawn. To pin a version, replace `@littlebearapps/outlook-assistant` with `@littlebearapps/outlook-assistant@3.7.4` (or whichever version) in your MCP client config.

If you installed globally, `npm update -g @littlebearapps/outlook-assistant` (or `npm install -g @littlebearapps/outlook-assistant@latest`). If you cloned from source, `git pull && npm install`. After updating, restart your MCP client so the running server picks up the new code — Node module caching means the previously-loaded source stays in memory until the server process is recycled.

For a list of what's in each version, see [`CHANGELOG.md`](../CHANGELOG.md). Active and upcoming work is in [`ROADMAP.md`](../ROADMAP.md).

## How do I uninstall Outlook Assistant?

Three steps, in any order:

1. **Remove the entry from your MCP client config.** Delete the `"outlook"` block from `claude_desktop_config.json`, `.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, or wherever it lives, and restart the client.
2. **Delete local tokens and pending auth state**:
   ```bash
   rm -f ~/.outlook-assistant-tokens.json ~/.outlook-assistant-pending-auth.json
   ```
3. **Revoke the Azure app's access to your account.** For personal Microsoft accounts, visit <https://account.live.com/consent/manage>; for work/school accounts, your tenant admin's "Enterprise applications" console. Removing the app revokes any outstanding refresh tokens immediately. If the Azure app registration is yours and no longer needed, you can delete it from <https://portal.azure.com/> > App registrations.

If you installed globally, finish with `npm uninstall -g @littlebearapps/outlook-assistant`. From source, just delete the cloned directory.

## Will Outlook Assistant send my email content to Little Bear Apps or any other server?

**No.** Outlook Assistant runs entirely on your machine and talks directly to Microsoft Graph at `https://graph.microsoft.com`. Your email content, calendar, contacts, and tokens never transit any Little Bear Apps infrastructure — there is no LBA server in the loop. The only network traffic the MCP server initiates is the OAuth handshake with `login.microsoftonline.com` (Microsoft's identity service) and the Graph API calls themselves.

What your MCP client (Claude Desktop, Claude Code, Cursor, Windsurf, etc.) does with the data the tools return is governed by *that* client's privacy policy. Most cloud-hosted AI assistants will send tool results upstream to the AI provider as part of the conversation context. If that's a concern, see the AI client's documentation on retention and training opt-outs, or use a self-hosted MCP host.

## Where can I get help, report a bug, or request a feature?

- **Bugs and feature requests** — open an issue at <https://github.com/littlebearapps/outlook-assistant/issues>. Include the version (`auth action=about`), the tool call that failed, and the exact error text.
- **Security concerns** — see the [Security Policy](../SECURITY.md). Don't open public issues for vulnerabilities.
- **General usage questions** — the [How-To Guides](how-to/index.md) cover 29 practical scenarios across email, calendar, contacts, settings, and AI agents.
- **What's coming next** — [`ROADMAP.md`](../ROADMAP.md) is the active milestone snapshot; the [GitHub milestones page](https://github.com/littlebearapps/outlook-assistant/milestones) is authoritative.
