# Outlook Assistant plugin

Connect your AI assistant to Microsoft Outlook. Search, read and send email, manage drafts, schedule and update meetings, look up and edit contacts, and configure folders, rules, categories and out-of-office, all from the conversation. Works with personal Outlook.com and work/school Microsoft 365 accounts.

This plugin runs the open-source [Outlook Assistant](https://github.com/littlebearapps/outlook-assistant) MCP server (`@littlebearapps/outlook-assistant` on npm, pinned to an exact version) as a local process on your machine. It works with Claude Code, GitHub Copilot (VS Code and Copilot CLI) and Cursor.

## Before you start

Outlook Assistant uses **your own** Azure app registration, so no third party ever holds your mailbox access. Setting one up takes about 10 minutes and is free:

1. Register an app in the [Azure portal](https://portal.azure.com) → App registrations.
2. Under **Authentication**, add the *Mobile and desktop applications* platform and turn on **Allow public client flows**.
3. Copy the **Application (client) ID**. You don't need a client secret for the default device-code sign-in.

Step-by-step guide with screenshots: [Connect Outlook to Claude](https://github.com/littlebearapps/outlook-assistant/blob/main/docs/how-to/getting-started/connect-outlook-to-claude.md).

## Sign in

Ask your assistant to "connect to Outlook".

- If you haven't given it your client ID yet, it will ask for it and save it to `~/.outlook-assistant-config.json`.
- It then shows a short code. Enter that code at `microsoft.com/devicelogin`, sign in, and approve the permissions.

In Claude Code you can also enter the client ID when you enable the plugin.

## What it can do

22 tools across email, calendar, contacts, folders, rules, categories and mailbox settings. Full list: [tools reference](https://github.com/littlebearapps/outlook-assistant/blob/main/docs/quickrefs/tools-reference.md).

**It can act on your behalf.** It can send email and meeting invitations, send or delete drafts, decline, cancel or delete meetings, set automatic replies, create or change inbox rules, and delete folders, contacts and categories. These tools are marked destructive, so clients that honour MCP safety annotations, such as Claude Code, ask before running them unless you've set the client to auto-approve them. The built-in safety controls are:

- `dryRun` previews for sending, drafts, rules, new events, every meeting action (update, decline, cancel, delete), automatic replies, and folder and contact deletes.
- Pre-send recipient checks (out-of-office, full mailbox, external recipients); when the check is on, a send to a flagged recipient is refused until the warnings are acknowledged.
- A per-session limit on sends, drafts and rule changes (10 each by default in this plugin).
- An optional recipient allowlist.
- An optional read-only mode that refuses every change before it runs.
- MCP safety annotations on every tool.
- Sending from shared mailboxes is never supported.

## Data and privacy

- The server talks only to Microsoft: `login.microsoftonline.com` for sign-in and `graph.microsoft.com` for your mail, calendar and contacts. There's no Little Bear Apps backend and no telemetry.
- Your OAuth tokens are stored locally in `~/.outlook-assistant-tokens.json`. The client ID you enter is saved locally in `~/.outlook-assistant-config.json`.
- Email content the tools return goes to the AI model you're using, under that client's own data policy.
- By default the server's own log (stderr) has one line per tool call (tool, action, outcome, duration), never its arguments or email content. `OUTLOOK_DEBUG=true` adds detail for troubleshooting, with addresses and IDs redacted.
- Attachments and exports are written only when you ask, and only to the folder you choose (your system temp folder by default).

More detail is in the [security policy](https://github.com/littlebearapps/outlook-assistant/blob/main/SECURITY.md) and the [privacy policy](https://littlebearapps.com/privacy/).

## Settings

| Setting | Environment variable | Default |
|---|---|---|
| Azure application (client) ID | `OUTLOOK_CLIENT_ID` | asked for at sign-in |
| Sign-in audience | `OUTLOOK_AUTH_AUDIENCE` | `common` |
| Send limit per session | `OUTLOOK_MAX_EMAILS_PER_SESSION` | `10` |
| Allowed recipients | `OUTLOOK_ALLOWED_RECIPIENTS` | none (all allowed) |
| Read-only mode | `OUTLOOK_READ_ONLY` | `false` |

Claude Code shows these as plugin settings. Other environment variables, such as `OUTLOOK_SHARED_MAILBOX` and `OUTLOOK_IMMUTABLE_IDS`, are in the [main README](https://github.com/littlebearapps/outlook-assistant#configuration). Use a manual MCP configuration if you need them.

## Support

[Issues](https://github.com/littlebearapps/outlook-assistant/issues) · [Troubleshooting](https://github.com/littlebearapps/outlook-assistant/blob/main/docs/troubleshooting.md) · MIT licence
