---
title: "Outlook Assistant — Frequently Asked Questions"
description: "Common questions about Outlook Assistant: installation, supported clients and accounts, Azure permissions, token storage, send safety controls, updates, and uninstall."
---

# Frequently Asked Questions

> Quick answers to the questions users ask most often. Also surfaced at <https://littlebearapps.com/help/outlook-assistant/faq/>.

For full setup steps, see [Getting Started](../how-to/getting-started/connect-outlook-to-claude.md). For known issues and recovery steps, see [Troubleshooting](../troubleshooting.md).

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

If you prefer a global install, `npm install -g @littlebearapps/outlook-assistant`. From source, clone the repo and run `npm install`. You also need a Microsoft Azure app registration (free tier is sufficient) — see the [Azure Setup Guide](../guides/azure-setup.md) for a full walkthrough including first-time Azure account creation.

Configuration snippets for Claude Desktop, Claude Code, VS Code / GitHub Copilot, Cursor, and Windsurf are in the [README](../../README.md#3-configure-your-mcp-client). Any other MCP client works the same way: run `npx -y @littlebearapps/outlook-assistant` and pass the environment variables in the client's `env` settings (the server doesn't read a `.env` file). `OUTLOOK_CLIENT_SECRET` is only needed for the browser sign-in flow; the default device code flow uses just `OUTLOOK_CLIENT_ID`.

If your client can't set environment variables at all (for example, the GitHub Copilot and Cursor plugins), give your AI assistant your Azure Application (client) ID when you sign in. It calls `auth action=authenticate clientId=<id>`, which saves the ID to `~/.outlook-assistant-config.json` and starts device code sign-in. A client ID isn't a secret, and `OUTLOOK_CLIENT_ID` takes precedence whenever it's set. See [Clients That Can't Set Environment Variables](../how-to/getting-started/connect-outlook-to-claude.md#clients-that-cant-set-environment-variables).

In Claude Code, GitHub Copilot CLI and Cursor you can install the plugin instead, which runs a pinned version of the server and adds the `using-outlook-assistant` skill and a safety hook. In Claude Code: `claude plugin marketplace add littlebearapps/outlook-assistant`, then `claude plugin install outlook-assistant@littlebearapps`. In Copilot CLI: `copilot plugin marketplace add littlebearapps/outlook-assistant`, then `copilot plugin install outlook-assistant@littlebearapps`. Cursor needs the v3.14.0 plugin or later. See [Supported Clients and Their Limits](../how-to/getting-started/supported-clients.md) for each client's steps.

## Which AI clients does Outlook Assistant work with, and what are their limits?

Any MCP client can run Outlook Assistant, and in every client the server enforces its own checks: read-only mode, the optional recipient allowlist and send cap, `dryRun` previews, the pre-send recipient check with `acknowledgeWarnings`, and MCP annotations and server instructions for the model. What varies is the plugin's extra layers:

- **Claude Code:** the plugin installs the skill and a hook that asks you before anything that reaches other people, deletes something or keeps acting, with a plain-English reason. Set how often it asks with the **Confirmation level** setting. In bypass permissions mode Claude Code may auto-approve the hook's prompts (`send-email` and `create-event` always ask), and in headless `-p` runs a prompt becomes a denial.
- **GitHub Copilot CLI:** the same skill and hook, with the reason shown. Set the level with the `OUTLOOK_CONFIRM_LEVEL` environment variable. A hook that times out lets the call through, and `-p` runs and the cloud agent turn a prompt into a denial.
- **VS Code with GitHub Copilot:** reads the same hook file; according to VS Code's source it shows the reason, but this hasn't been checked by hand yet.
- **Cursor** (v3.14.0 plugin or later): the skill loads and the hook runs, but Cursor's own "Run this MCP tool?" prompt doesn't show the hook's reason, and an `Mcp(...)` allow rule, or `--force` / Run Everything mode, runs the call without asking. Only Cursor CLI has been checked, not the desktop app. The v3.13.0 plugin fails to sign in from Cursor with `AADSTS900023`; use a manual MCP configuration with `OUTLOOK_CLIENT_ID` set instead.
- **Codex CLI, Gemini CLI, Claude Desktop, Windsurf and other clients:** a manual MCP configuration with the server's checks, annotations and instructions, but no hook. Clients that support Agent Skills can use a copy of the skill folder.

The full comparison is in [Supported Clients and Their Limits](../how-to/getting-started/supported-clients.md), and test results per client are in the [cross-client verification matrix](../cross-client-matrix.md).

## Does Outlook Assistant work with personal Outlook.com accounts?

Yes. Outlook Assistant supports both personal Microsoft accounts (Outlook.com, Hotmail, Live.com) and work/school Microsoft 365 accounts. A few features are 365-only because Microsoft Graph itself doesn't expose them on personal accounts — meeting room search (`find-meeting-rooms`), shared mailbox access (`access-shared-mailbox` and the opt-in `sharedMailbox` parameter), pre-send mail tips (`get-mail-tips`), and Focused Inbox routing.

On personal accounts, Microsoft's `$search` API has limited support for free-text queries, so Outlook Assistant falls back through up to four progressive search strategies (server `$search` → `contains(subject)` → client-side body/subject/from scan → recent message listing) and exposes which strategy ran in the response's `_meta.searchMetadata` block. For the most direct results, use structured filters (`from`, `subject`, `to`, `receivedAfter`) where possible. The full per-feature compatibility matrix is in the [README's Account Compatibility section](../../README.md#account-compatibility).

Personal accounts also reject **field-scoped** `$search` expressions outright — `searchExpression="from:someone@example.com"` returns a Graph syntax error, even though the mail is there. From v3.10.0 expressions built purely from `from:`, `to:` and `subject:` terms are translated into the closest equivalent OData filters and retried automatically, reported as strategy `raw-kql-translated` (#217) — the translation is close rather than identical, since a `subject:` term becomes a substring match. Unscoped expressions like `searchExpression="invoice"` were never affected. Expressions that can't be reproduced exactly — free text, `AND`/`OR`, grouping, wildcards, unknown field prefixes — are deliberately not retried, because guessing at their meaning would return mail you didn't ask for.

Two personal-account behaviours worth knowing when a search surprises you. First, `query` and `searchExpression` are not two spellings of the same search: `searchExpression` goes to Graph `$search`, which matches the whole message including the body and ranks by relevance rather than date, while `query` falls back to a subject substring match that never reads bodies. So `searchExpression` can surface a message whose subject looks unrelated, and `query` can miss one whose subject doesn't contain your term — reach for `query` on a subject term, `searchExpression` for body content. Second, personal accounts reject the server-side recipient filter, so `to` is matched locally over the 500 most recent messages (raise with `OUTLOOK_SEARCH_SCAN_LIMIT`, max 5000). On a large archive that excludes older mail, so pair `to` with `receivedAfter`/`receivedBefore` to reach further back; from v3.11.1 the response tells you whenever that scan was truncated, whether or not it matched.

When a search returns nothing, `_meta.searchMetadata.droppedFilters` tells you whether every filter you supplied was actually honoured. It should always be empty; anything else means the response is broader than your query (#229).

## How do I access custom subfolders of a shared mailbox?

Shared/delegated mailbox tools reach **custom subfolders and localised folder names**, not just Microsoft's well-known folders (Inbox, Sent, Archive, etc.). This needs a work/school account, delegate access to the mailbox (admin-configured in Exchange), and the opt-in **`OUTLOOK_SHARED_MAILBOX`** setting: set it to `read` (requests **`Mail.Read.Shared`**) or `true` (read and organise, also requests **`Mail.ReadWrite.Shared`**), restart the server, then re-authenticate with `auth action=authenticate force=true`. `auth action=about` shows whether the shared scopes were granted. Without the setting, `access-shared-mailbox` still reads well-known folders or a folder ID, but custom names, nested paths, `listFolders` and every other tool's `sharedMailbox` parameter are refused with these setup steps. See [Access Shared Mailboxes](../how-to/advanced/access-shared-mailboxes.md) for the full guide.

Four entry points:

1. **Discover the folder tree.** Call `access-shared-mailbox` with `listFolders: true` (or `folders action=list, sharedMailbox: "shared@company.com"`) to enumerate the reachable folders with their names, full paths, IDs, and item counts. The listing is best-effort: if a branch can't be traversed (depth limit, throttling, or a per-folder permission error), the output says so explicitly — check for traversal warnings before concluding a folder doesn't exist.
2. **Read a custom folder.** Pass `folder` as a display name (`Archiv`), a nested path (`Inbox/Vendors/Acme`), or a raw `folderId` to `access-shared-mailbox`. Localised and case-insensitive names resolve correctly.
3. **Search within a custom folder.** `search-emails` accepts `sharedMailbox` (alias `email`) alongside `folder` (name or path) or `searchAllFolders: true`.
4. **Open an individual message.** Message IDs are *mailbox-scoped*, so once you have an ID from `access-shared-mailbox` or `search-emails`, pass the **same** `sharedMailbox` (alias `email`) to `read-email` (full body or `headersMode` forensic headers), `attachments` (list/view/download), and `export` (`message`, `messages`, `conversation`, or `mime`) to open it. Conversation retrieval (`search-emails` with `conversationId` or `groupByConversation`) is mailbox-aware too. Omitting it makes the tool look the ID up in *your* mailbox, where it doesn't exist — the source of the `404 ErrorInvalidMailboxItemId` error.

Before v3.12.0 only well-known folder names resolved, so custom folders returned an `ErrorInvalidIdMalformed` error — that gap is closed.

You can also **organise** a shared mailbox — move messages between its folders (`folders action=move, sharedMailbox: …`), create and delete folders (`folders action=create` / `delete`), apply categories (`apply-category`), and flag/mark-read (`update-email`) all accept `sharedMailbox` (alias `email`). These writes need `OUTLOOK_SHARED_MAILBOX=true` and the **`Mail.ReadWrite.Shared`** permission; after adding it in Azure you must re-authenticate (`force=true`) so the token carries the new scope. Without it, the write stays scoped to the shared mailbox and fails (typically 403 access denied) until the scope and delegate access are in place — it never silently lands in your own mailbox. (Separately, *omitting* `sharedMailbox` on the write call targets your own mailbox, where the shared message ID doesn't exist — that's the source of `404 ErrorInvalidMailboxItemId`.)

Shared-mailbox support stops at reading and organising: **sending, drafts, replies, and forwards from a shared mailbox are not supported.** `send-email` and `draft` (create/update/send/delete, reply, reply-all, forward) always act on the signed-in user's own mailbox, and `Mail.Send.Shared` is not requested. Use the Outlook UI for send-as / send-on-behalf. Mailbox settings, inbox rules and Focused Inbox likewise apply only to your own mailbox.

## What Microsoft Graph permissions does Outlook Assistant need, and why?

Outlook Assistant uses delegated Microsoft Graph permissions — it accesses your mailbox on your behalf, never with elevated rights:

- **`offline_access`** — issues refresh tokens so you don't have to sign in every hour
- **`User.Read`** — your display name and email, shown in `auth about` so you can confirm which mailbox is connected
- **`Mail.Read`, `Mail.ReadWrite`, `Mail.Send`** — email operations across the 8 email tools
- **`Calendars.Read`, `Calendars.ReadWrite`** — events listing, creation, and management
- **`Contacts.Read`, `Contacts.ReadWrite`** — contact CRUD via `manage-contact`
- **`MailboxSettings.ReadWrite`** — auto-replies, working hours, master categories, Focused Inbox overrides
- **`People.Read`** — `search-people` relevance-ranked lookups

Sign-in asks for this whole set every time, on both the device-code and browser paths. The scopes come from the server, not from your Azure app registration: the API-permissions list there doesn't cap what you're asked to consent to, so leaving a permission off it doesn't stop it being requested.

Three permissions are work/school only and optional: **`Mail.Read.Shared`** to read shared mailboxes, **`Mail.ReadWrite.Shared`** to write to them (move/categorise/flag/mark-read), and **`Place.Read.All`** (admin consent required, and not requested at sign-in by default) for meeting room search. They're scoped to your account and revocable any time at <https://account.live.com/consent/manage> (personal) or in your tenant admin console (work/school). The two `.Shared` scopes are **opt-in**: they're requested only when you set `OUTLOOK_SHARED_MAILBOX=read` (read) or `=true` (read and organise), restart the server, and re-authenticate with `auth action=authenticate force=true`. Leave it unset on personal Microsoft accounts, which can't be granted them. If you do enable it on a personal account, the **device-code flow** retries once with the standard scopes (one extra code); the **browser flow** (`npm run auth-server`) has no fallback. If your work/school tenant won't let you consent (`AADSTS65001` or "Need admin approval"), ask an admin to grant consent, or unset the setting to sign in with the standard scopes — Outlook Assistant never silently downgrades your scopes on a consent error.

To see exactly what you were granted, call `auth action=about`: it lists the configured scopes, the granted scopes and the shared-mailbox status, without ever showing a token.

## Where are my tokens stored, and what happens when they expire?

Access and refresh tokens are stored at **`~/.outlook-assistant-tokens.json`** with file mode `0o600` (owner read/write only). Token refresh is automatic — the access token (~60 minutes) refreshes transparently via the stored refresh token, so the only time you'll re-authenticate is when the **refresh token expires (~90 days)**. From v3.7.2 onward, refresh works correctly for both public and confidential client flows.

From v3.12.0, a refresh asks Microsoft only for the scopes you were granted at sign-in, plus `offline_access` so that a new refresh token keeps being issued (#241). The upside is that a refresh can't fail by asking for a scope you never consented to. The flip side: a refresh never *adds* scopes, so after adding a permission in Azure or turning on `OUTLOOK_SHARED_MAILBOX`, run `auth action=authenticate force=true` once.

If tokens get corrupted or stuck:

```bash
rm ~/.outlook-assistant-tokens.json ~/.outlook-assistant-pending-auth.json
# Then call the auth tool again with action=authenticate
```

The pending-auth file (also at `~/.outlook-assistant-pending-auth.json`, also `0o600`) only exists between calling `authenticate` and `device-code-complete` — its purpose is to make device-code auth survive MCP server restarts (Untether/Telegram bridges, Claude Desktop session changes, etc.).

## Can I use Outlook Assistant in read-only mode?

Yes. Set **`OUTLOOK_READ_ONLY=true`** in your MCP client's `env` block (or turn on **Read-only mode** in the Claude Code plugin settings) and restart the server. It then refuses every tool call or action that isn't a read before it runs, so nothing reaches Microsoft and nothing is written locally: no sends, drafts, moves, flags, deletes, rules, settings changes, exports or attachment downloads, and no `dryRun` previews either. Searching and reading mail, calendar and contacts still work, and so does signing in. `true`, `1`, `yes` and `on` switch it on; an unrecognised value also switches it on, with a warning. `auth action=about` shows whether it's on. See [Trying It Out Safely](../how-to/getting-started/connect-outlook-to-claude.md#trying-it-out-safely).

Read-only mode is enforced by the server, not by Microsoft. Sign-in still requests the full scope set on both the device-code and browser paths, and trimming your Azure app registration won't change that: its API-permissions list doesn't cap what you consent to (see the permissions question above). When you do allow changes, these controls make sure nothing happens without your approval:

1. **Your MCP client's approval prompts.** Auto-approve only the tools marked `readOnlyHint` (see the annotations below) and leave every other tool on "ask" — or deny it outright — so a write, send or delete can't run until you approve that call. In Claude Code, `send-email` and `create-event` always ask, even in auto-accept or bypass modes, because they carry the `anthropic/requiresUserInteraction` flag. With the plugin in Claude Code, GitHub Copilot or Cursor, a safety hook also asks before anything that reaches other people, deletes something or keeps acting; how well that works varies by client (see [Supported Clients and Their Limits](../how-to/getting-started/supported-clients.md)). Many write tools also take `dryRun: true` to preview a change without making it: `send-email`, `draft` create, `create-event` and `manage-event` (who would be emailed, with a count of external addresses), `mailbox-settings` set-auto-replies, `manage-rules` create/update, and `folders` and `manage-contact` delete (what would be lost). Every other call with `dryRun: true` is refused before it runs, so a preview never sends, deletes or changes anything for real.
2. **Pre-send recipient checks.** With `checkRecipients: true`, `send-email` refuses to send when Microsoft 365 mail tips show an out-of-office reply, a full mailbox, a delivery restriction, an external recipient or a group with external members, and lists the warnings. It sends only when repeated with `acknowledgeWarnings: true`. Personal Outlook.com accounts return no mail tips, so the check can't catch anything there.
3. **Send-safety belts.** Even with full permissions, you can configure `OUTLOOK_MAX_EMAILS_PER_SESSION` and `OUTLOOK_ALLOWED_RECIPIENTS` (allowlist of approved addresses or domains). `OUTLOOK_MAX_EMAILS_PER_SESSION` is the default per-session cap for every rate-limited tool — `send-email` (shared with `draft send`), `draft` create/update/reply/reply-all/forward, `manage-rules` and `create-event` — each counted separately; override one tool with `OUTLOOK_MAX_<TOOL>_PER_SESSION` (e.g. `OUTLOOK_MAX_MANAGE_RULES_PER_SESSION`). Leave it unset for no limit. **Setting it to `0` blocks the tool completely** (since v3.14.1; before that, `0` meant no limit), so `OUTLOOK_MAX_EMAILS_PER_SESSION=0` stops all sending, drafting, invitations and rule changes, and `OUTLOOK_MAX_SEND_EMAIL_PER_SESSION=0` stops only sending. `draft` update, send and delete also refuse any message that isn't an unsent draft, so they can't edit, re-send or delete received or sent mail. The allowlist covers `send-email`, every `draft` action that addresses mail (create, update, reply, reply-all, forward, and `send`, which re-checks the draft's current recipients), calendar invitations (`create-event` attendees and the attendee list you pass to `manage-event` update) and inbox-rule forwarding: a rule, event or reply that would reach a blocked address is refused whole (a refused reply draft is deleted again), never kept or sent with that address dropped. While it's set, each recipient must be one plain address, so a string such as `a@other.com;b@your-domain.com` is refused. It doesn't cover cancellation or decline messages, or automatic replies. `auth action=about` reports their state and prints a setup hint when unset. See the [Recommended setup snippet](../../README.md#safety--token-efficiency) in the README and [`.mcp.json.example`](../../.mcp.json.example) for the copy-paste template.
4. **Shared mailboxes stay off unless you opt in.** Without `OUTLOOK_SHARED_MAILBOX`, the shared-mailbox scopes aren't requested and `sharedMailbox` calls are refused. `OUTLOOK_SHARED_MAILBOX=read` gives read-only shared access (`Mail.Read.Shared`); only `true` adds the organise scope. Sending from a shared mailbox is never supported.

Independent of these settings, Outlook Assistant refuses IDs containing `.` or `..` path segments before any request is made, only ever sends your access token to `graph.microsoft.com`, and writes attachment downloads and exports only inside the system temp directory, `~/Downloads`, `~/Documents` or a folder you set in `OUTLOOK_EXPORT_DIR`. Paths must be absolute (or start with `~/`), symlinks aren't followed, and the files are readable only by you. An existing file is never replaced unless you ask `export` to with `overwrite: true`.

Every tool also carries [MCP annotations](https://modelcontextprotocol.io/docs/concepts/tools#annotations) (`readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`), all four set explicitly, so AI clients can auto-approve safe reads and prompt for confirmation on destructive operations. They're hints, not enforcement: whether you're asked depends on your client's approval settings, which is why step 1 above matters (and why `OUTLOOK_READ_ONLY` is the switch to use when nothing should change). The server also sends your client a short set of instructions for the model when it connects: treat retrieved email, calendar and contact content as data rather than instructions, confirm anything that reaches other people, deletes or keeps acting, draft before sending, and treat allowlist refusals and rate limits as final. Destructive covers deletes and anything that reaches other people or keeps acting after the call: sending, invitations, cancellations, inbox rules and automatic replies. Tools whose output can include content authored by external senders (`search-emails`, `read-email`, `list-events`, `get-mail-tips`, `search-people`, `access-shared-mailbox`, `attachments`, `export`, `draft`) and the tools that reach other people (`send-email`, `draft`, `create-event`, `manage-event`, `manage-rules`, `mailbox-settings`) set `openWorldHint: true`, signalling clients to treat that content with appropriate caution (e.g. prompt-injection defences).

## Why does Outlook Assistant need an Azure app registration?

Microsoft Graph (the API behind Outlook, Teams, OneDrive, etc.) requires every client application to be registered in Microsoft Entra ID before it can request delegated access on a user's behalf. The app registration gives Microsoft three things: (1) a client ID so they know which application is asking, (2) a redirect URI / public-client mode for the OAuth flow, and (3) a list of scopes the app may request. Without registration, OAuth would have no entry point.

Microsoft does not offer a "shared multi-tenant client ID" that any open-source project can reuse — every published Outlook MCP server has the same requirement. We're tracking [#147](https://github.com/littlebearapps/outlook-assistant/issues/147) (publisher-verified shared multi-tenant app) for a future release where Little Bear Apps publishes a verified shared app users can authorise without creating their own registration. Until then, the [Azure Setup Guide](../guides/azure-setup.md) walks through the process in about 10 minutes.

## What's the difference between device code and browser authentication?

**Device code flow (default since v3.5.1, recommended)** doesn't need an auth server, port forwarding, or local browser — you call `auth action=authenticate`, visit a URL on any device with the displayed code, sign in, then call `auth action=device-code-complete`. It works headless, over SSH, and through remote bridges like Telegram. Device code state is persisted to `~/.outlook-assistant-pending-auth.json` so the flow survives MCP server restarts (a real issue for hosts that restart between tool calls; fixed in v3.7.2).

**Browser redirect flow (optional)** runs a local auth server on port 3333 and uses the standard OAuth redirect URI (`http://localhost:3333/auth/callback`). Convenient on a graphical workstation, but it needs an open port and a local browser — neither is available in many MCP host environments. Start it with `npm run auth-server` from a source checkout (or `node "$(npm root -g)/@littlebearapps/outlook-assistant/outlook-auth-server.js"` from a global install), then call `auth action=authenticate method=browser`.

They also need different credentials. Device code is a public-client flow, so it needs only your Application (client) ID, which you can set with `OUTLOOK_CLIENT_ID` or pass at sign-in as `auth action=authenticate clientId=<id>`. The browser flow is a confidential-client flow: its auth server also needs `OUTLOOK_CLIENT_SECRET`, and reads both values from its own environment.

Most users should pick device code unless they have a specific reason to use the redirect flow. Both write to the same token file and the resulting MCP server behaviour is identical. One difference matters if you turn on `OUTLOOK_SHARED_MAILBOX`: when an account can't be granted the shared-mailbox scopes (a personal account, for example), the device code flow retries once with the standard scopes, while the browser flow has no fallback. Use device code if you enable that setting.

## How do I update Outlook Assistant?

Outlook Assistant is published to npm as **`@littlebearapps/outlook-assistant`**. The simplest path is to let your MCP client pick up the latest version automatically — most clients call `npx @littlebearapps/outlook-assistant`, which resolves to the latest published version subject to npm's cache — if you need a guaranteed registry check, add `--prefer-online`. To pin a version, replace `@littlebearapps/outlook-assistant` with `@littlebearapps/outlook-assistant@3.14.0` (or whichever version) in your MCP client config.

To check which version you currently have, run `outlook-assistant --version` (v3.11.0 and later). Earlier versions have no `--version` flag and will start the MCP server instead, so if the command appears to hang you are on an older build. You can also ask your AI assistant to call the `auth` tool with `action=about`, which reports the running server's version.

If you installed globally, `npm update -g @littlebearapps/outlook-assistant` (or `npm install -g @littlebearapps/outlook-assistant@latest`). If you cloned from source, `git pull && npm install`. The plugin pins an exact server version, so update the plugin itself: in Claude Code, `claude plugin marketplace update littlebearapps` then `claude plugin update outlook-assistant@littlebearapps`; in GitHub Copilot CLI, `copilot plugin update outlook-assistant@littlebearapps`. After updating, restart your MCP client so the running server picks up the new code — Node module caching means the previously-loaded source stays in memory until the server process is recycled.

For a list of what's in each version, see [`CHANGELOG.md`](../../CHANGELOG.md). Active and upcoming work is in [`ROADMAP.md`](../../ROADMAP.md).

## How do I uninstall Outlook Assistant?

Three steps, in any order:

1. **Remove the entry from your MCP client config.** Delete the `"outlook"` block from `claude_desktop_config.json`, `.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, or wherever it lives, and restart the client. If you installed the plugin, uninstall it instead: `claude plugin uninstall outlook-assistant@littlebearapps` in Claude Code, or `copilot plugin uninstall` with the name `copilot plugin list` shows in GitHub Copilot CLI.
2. **Delete local tokens and pending auth state**:
   ```bash
   rm -f ~/.outlook-assistant-tokens.json ~/.outlook-assistant-pending-auth.json
   ```
3. **Revoke the Azure app's access to your account.** For personal Microsoft accounts, visit <https://account.live.com/consent/manage>; for work/school accounts, your tenant admin's "Enterprise applications" console. Removing the app revokes any outstanding refresh tokens immediately. If the Azure app registration is yours and no longer needed, you can delete it from <https://portal.azure.com/> > App registrations.

If you installed globally, finish with `npm uninstall -g @littlebearapps/outlook-assistant`. From source, just delete the cloned directory.

## Will Outlook Assistant send my email content to Little Bear Apps or any other server?

**No.** Outlook Assistant runs entirely on your machine and talks directly to Microsoft Graph at `https://graph.microsoft.com`. Your email content, calendar, contacts, and tokens never transit any Little Bear Apps infrastructure — there is no LBA server in the loop. The only network traffic the MCP server initiates is the OAuth handshake with `login.microsoftonline.com` (Microsoft's identity service) and the Graph API calls themselves.

The server's own logs stay on your machine too: it writes them to stderr, which your MCP client usually saves to a local log file. By default each tool call logs one line (the tool, action, outcome and how long it took) and never the call's arguments, so no search terms, addresses, subjects or message content. Setting `OUTLOOK_DEBUG=true` adds detail for troubleshooting, such as search terms, subjects and Graph error bodies, with email addresses and long IDs redacted. Tokens, device codes and secrets are never logged either way. See [Server Logs and Debug Logging](../troubleshooting.md#server-logs-and-debug-logging).

What your MCP client (Claude Desktop, Claude Code, Cursor, Windsurf, etc.) does with the data the tools return is governed by *that* client's privacy policy. Most cloud-hosted AI assistants will send tool results upstream to the AI provider as part of the conversation context. If that's a concern, see the AI client's documentation on retention and training opt-outs, or use a self-hosted MCP host.

## Where can I get help, report a bug, or request a feature?

- **Bugs and feature requests** — open an issue at <https://github.com/littlebearapps/outlook-assistant/issues>. Include the version (`auth action=about`), the tool call that failed, and the exact error text.
- **Security concerns** — see the [Security Policy](../../SECURITY.md). Don't open public issues for vulnerabilities.
- **General usage questions** — the [How-To Guides](../how-to/index.md) cover 30 practical scenarios across email, calendar, contacts, settings, and AI agents.
- **What's coming next** — [`ROADMAP.md`](../../ROADMAP.md) is the active milestone snapshot; the [GitHub milestones page](https://github.com/littlebearapps/outlook-assistant/milestones) is authoritative.
