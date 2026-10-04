<p align="center">
  <img src="https://raw.githubusercontent.com/littlebearapps/outlook-assistant/main/docs/assets/outlook-assistant-logo-full.png" height="200" alt="Outlook Assistant" />
</p>

<h1 align="center">Outlook Assistant</h1>

<p align="center">
  <strong>MCP server for Outlook email, calendar, and contacts — let your AI assistant manage your inbox directly from the conversation.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@littlebearapps/outlook-assistant"><img src="https://img.shields.io/npm/v/@littlebearapps/outlook-assistant" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@littlebearapps/outlook-assistant"><img src="https://img.shields.io/npm/dm/@littlebearapps/outlook-assistant" alt="npm downloads" /></a>
  <a href="https://github.com/littlebearapps/outlook-assistant/actions/workflows/ci.yml"><img src="https://github.com/littlebearapps/outlook-assistant/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/littlebearapps/outlook-assistant/actions/workflows/codeql.yml"><img src="https://github.com/littlebearapps/outlook-assistant/actions/workflows/codeql.yml/badge.svg" alt="CodeQL" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://glama.ai/mcp/servers/littlebearapps/outlook-assistant"><img src="https://glama.ai/mcp/servers/littlebearapps/outlook-assistant/badges/score.svg" alt="Glama score" /></a>
</p>

Outlook Assistant connects AI assistants to your Microsoft Outlook account through the [Model Context Protocol](https://modelcontextprotocol.io/). Ask your AI assistant to search your inbox, send emails, schedule meetings, manage contacts, and configure mailbox settings — without leaving the conversation. Works with Claude, GitHub Copilot, Cursor, Windsurf, and any MCP-compatible client.

**Works with personal Outlook.com and work/school Microsoft 365 accounts.**

<div align="center">
  <br />
  <a href="https://github.com/littlebearapps/outlook-assistant/blob/main/docs/demo/outlook-assistant-demo.mp4">
    <img src="https://raw.githubusercontent.com/littlebearapps/outlook-assistant/main/docs/demo/outlook-assistant-demo.gif" alt="Outlook Assistant Demo — searching emails, reading, and drafting a reply" width="720" style="border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.12);" />
  </a>
  <br />
  <sub>Search inbox → read &amp; summarise → draft a reply — all from the conversation</sub>
  <br /><br />
</div>

### What you can do

- 📨 **Search and read emails** — find messages by sender, subject, date, or keywords; read full threads with conversation grouping; batch flag, move, export, or categorise multiple emails at once
- 🛡️ **Send emails with safety controls** — dry-run preview, pre-send mail tips (out-of-office, mailbox full, delivery restrictions), session rate limiting, and recipient allowlist to prevent mistakes
- ✏️ **Draft emails for review** — create, update, and send drafts; reply and forward as drafts; preview before saving with dry-run mode
- 📅 **Manage your calendar** — view upcoming events, look back at past ones or find them by date range and subject, schedule meetings with attendees, update, decline or cancel events
- 📦 **Export emails** — save individual messages to Markdown, EML, JSON, or CSV; export full conversation threads to MBOX or HTML; bulk-export search results in one call
- 🔍 **Investigate email headers** — full raw header access (DKIM, SPF, DMARC, delivery chain, X-Mailer, X-Originating-IP) for phishing investigation and compliance review
- 🗂️ **Organise your inbox** — create nested folders (addressable by path), set up inbox rules, colour-code with categories, manage Focused Inbox — all work together for complete inbox automation
- 🔄 **Track inbox changes** — delta sync detects new, modified, and deleted emails since your last check, with tokens for incremental polling
- 👥 **Manage contacts** — search your contact book and organisational directory, create and update contact records
- ⚙️ **Configure settings** — set out-of-office auto-replies, working hours, and time zone
- 📬 **Access shared mailboxes** — read and organise team inboxes and service accounts, including custom subfolders and nested folder paths; enumerate, read, and search the folder tree (best-effort — listings flag any branches skipped due to depth limits or per-folder errors), move/flag/categorise messages, and manage folders (work/school Microsoft 365 accounts; opt-in via `OUTLOOK_SHARED_MAILBOX`). Sending, drafts, replies, and forwards from a shared mailbox are not supported — those operations always act on the signed-in user's own mailbox
- 🏢 **Find meeting rooms** — search by building, floor, capacity, AV equipment, and wheelchair accessibility (Microsoft 365)

### Why Outlook Assistant?

| Without Outlook Assistant | With Outlook Assistant |
|---------------------|------------------|
| Switch between your AI tool and Outlook to manage email | Read, search, send, and export emails directly from your AI assistant |
| Manually search and export email threads | Full email tools including search, threading, and bulk export |
| Context-switch for calendar and contacts | Manage calendar events, contacts, and settings in one place |
| Copy-paste email content into conversations | Your AI assistant reads your emails natively with full context |
| No programmatic access to mailbox rules or categories | Create inbox rules, manage categories, configure auto-replies |
| Manually check each email for phishing red flags | Forensic header analysis — DKIM, SPF, DMARC, spam scores, and delivery chain in one call |
| Poll your inbox to check for new mail | Delta sync returns only changes since your last check, with tokens for continuous polling |

## Features

| Module | Tools | What You Can Do |
|--------|------:|-----------------|
| **Email** | 8 | `search-emails` (list/search/delta/conversations), `read-email` (content + forensic headers), `send-email` (with dry-run + mail tips), `draft` (create/update/send/delete/reply/reply-all/forward), `update-email` (read status, flags), `attachments`, `export`, `get-mail-tips` |
| **Calendar** | 3 | `list-events` (upcoming by default; `startAfter`/`startBefore`/`subject` filters), `create-event`, `manage-event` (update/decline/cancel/delete) |
| **Contacts** | 2 | `manage-contact` (list/search/get/create/update/delete), `search-people` |
| **Categories** | 3 | `manage-category` (CRUD), `apply-category`, `manage-focused-inbox` |
| **Settings** | 1 | `mailbox-settings` (get/set auto-replies/set working hours) |
| **Folder** | 1 | `folders` (list/create/move/stats/delete) — nested folders addressable by path (`Parent/Child`) or ID |
| **Rules** | 1 | `manage-rules` (list/create/update/reorder/delete) |
| **Advanced** | 2 | `access-shared-mailbox` (messages or folder tree), `find-meeting-rooms` |
| **Auth** | 1 | `auth` (status/authenticate/device-code-complete/about) |

**22 tools total** — consolidated from 55 for optimal AI performance. See the [Tools Reference](docs/quickrefs/tools-reference.md) for complete parameter details.

### Export Formats

Format support varies by `target`:

| Format | Extension | `target=message` (single) | `target=messages` (batch) | `target=conversation` (thread) |
|--------|-----------|--------|--------|--------|
| `mime` / `eml` | `.eml` | ✅ | – | ✅ |
| `mbox` | `.mbox` | – | – | ✅ |
| `markdown` | `.md` | ✅ | ✅ | ✅ |
| `json` | `.json` | ✅ | ✅ | ✅ |
| `html` | `.html` | – | – | ✅ |
| `csv` | `.csv` | ✅ | ✅ | ✅ |

Export individual emails, search results, or entire conversation threads — use `target=messages` with a search query (or the `query` shortcut) to batch-export without manually collecting IDs.

## Account Compatibility

Outlook Assistant works with both personal and work/school Microsoft accounts, but some features behave differently:

| Feature | Personal (Outlook.com) | Work/School (Microsoft 365) |
|---------|----------------------|---------------------------|
| Email read, send, search | Full support | Full support |
| Calendar events | Full support | Full support |
| Contacts CRUD | Full support | Full support |
| Inbox rules | Full support | Full support |
| Folders | Full support | Full support |
| Free-text `query` search | Limited — progressive fallback; `subject`, `from`, `to` filters are more direct | Full `$search` support |
| Categories | Full support | Full support |
| Mailbox settings | Full support | Full support |
| Focused Inbox | API works (overrides stored) but mail routing not affected | Full support |
| Shared mailboxes | Not available | Opt-in (`OUTLOOK_SHARED_MAILBOX`). Read + organise only. Read: `Mail.Read.Shared`; organise (move/categorise/flag/create folders): `Mail.ReadWrite.Shared`. No sending/drafts/replies/forwards |
| Meeting room search | Not available | Requires `Place.Read.All` + admin consent |

> **Note**: On personal accounts, Microsoft's `$search` API has limited support for free-text queries. Outlook Assistant handles this automatically with progressive search — if your query returns no results, it falls back through OData filters, boolean filters, and recent message listing to find your emails. For the most direct results on personal accounts, use the structured filter parameters (`from`, `subject`, `to`, `receivedAfter`).

### What Makes This Different

- **Progressive search** — on accounts where Microsoft's `$search` API is limited, Outlook Assistant automatically falls back through up to 4 search strategies to find your emails, and reports which one answered in `_meta.searchMetadata` along with any filter it could not honour (`droppedFilters`). Most Graph API wrappers fail silently; this one adapts and tells you.
- **Email forensics** — raw header access for DKIM, SPF, DMARC, delivery chain, X-Mailer, X-Originating-IP, and spam scores. Returns the full data so you can investigate phishing, audit compliance, or trace delivery issues. (Auto-verdict is on the roadmap; today the data is surfaced and analysed in-conversation.)
- **Delta sync** — incremental inbox monitoring returns only what changed since your last check, with tokens for continuous polling. Designed for agent workflows that need to watch a mailbox.
- **Batch operations** — flag, move, export, or categorise multiple emails in a single call. Search-driven export lets you batch-export results without collecting IDs manually.
- **Pre-send intelligence** — check recipients for out-of-office, full mailbox, delivery restrictions, and moderation status before sending — no other Outlook MCP server offers this.
- **Compound automation** — rules, categories, folders, and Focused Inbox work together. Set up complete inbox management through your AI assistant in one conversation.

## Safety & Token Efficiency

Outlook Assistant is designed with safety-first principles for AI-driven email access:

**Destructive action safeguards** — Every tool carries [MCP annotations](https://modelcontextprotocol.io/docs/concepts/tools#annotations) (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), all four set explicitly on every tool, so AI clients can auto-approve safe reads and prompt for confirmation on destructive operations like sending email, inviting attendees or deleting events.

**Send-email protections** — The `send-email` tool includes:
- **Pre-send mail tips** (`checkRecipients: true`) — check recipients for out-of-office, mailbox full, delivery restrictions before sending
- **Dry-run mode** (`dryRun: true`) — preview composed emails without sending
- **Session rate limiting** — configurable via `OUTLOOK_MAX_EMAILS_PER_SESSION` (default: unlimited)
- **Recipient allowlist** — restrict sending to approved addresses/domains via `OUTLOOK_ALLOWED_RECIPIENTS`

> **Recommended setup**: enable both safety belts in your `.mcp.json` from day one. They're off by default; `auth action=about` reports their state and prints a setup hint when unset. See [`.mcp.json.example`](.mcp.json.example) for a copy-paste template.
>
> ```json
> "env": {
>   "OUTLOOK_CLIENT_ID": "…",
>   "OUTLOOK_MAX_EMAILS_PER_SESSION": "10",
>   "OUTLOOK_ALLOWED_RECIPIENTS": "your-domain.com,trusted@example.com"
> }
> ```

**Input and file hardening** — IDs containing `.` or `..` path segments are refused before any request is made, continuation links (`deltaToken`) must point at `graph.microsoft.com`, and attachment downloads and exports write sanitised filenames inside the output directory without overwriting existing files or following symlinks.

**Draft protections** — The `draft` tool shares `send-email` safety controls: dry-run preview, recipient allowlist, mail-tips validation, and rate limiting. The `send` action shares the `send-email` rate limit counter, preventing circumvention via the draft-then-send pathway. `update`, `send` and `delete` refuse any ID that is not an unsent draft, so a received or sent message is never edited, deleted or re-sent.

**Token-optimised architecture** — Tools are consolidated using the STRAP (Single Tool, Resource, Action Pattern) approach. 22 tools instead of 55 reduces per-turn overhead by ~11,000 tokens (~64%), keeping more of the AI's context window available for your actual conversation. Fewer tools also means the AI selects the right tool more accurately — research shows tool selection degrades beyond ~40 tools.

> **Important**: These safeguards are defence-in-depth measures that reduce risk, but they are not a guarantee against unintended actions. AI-driven access to your email is inherently sensitive — always review tool calls before approving, particularly for sends and deletes. No automated guardrail is foolproof, and you remain responsible for actions taken through your mailbox.

## Quick Start

### 1. Install

```bash
npm install -g @littlebearapps/outlook-assistant
```

Or run directly without installing:

```bash
npx @littlebearapps/outlook-assistant
```

To check which version you have, or to see the available options:

```bash
outlook-assistant --version     # prints e.g. 3.13.0
outlook-assistant --help        # usage, options and key environment variables
```

With no arguments the server speaks the Model Context Protocol over stdio. It's
normally launched by your MCP client rather than run by hand — started from a
terminal it will simply wait on stdin.

### 2. Register an Azure App

You need a Microsoft Azure app registration to authenticate. See the **[Azure Setup Guide](docs/guides/azure-setup.md)** for a detailed walkthrough (including first-time Azure account creation), or if you've done this before:

1. Create a new app registration at [portal.azure.com](https://portal.azure.com/)
2. Add Microsoft Graph delegated permissions (Mail, Calendar, Contacts)
3. _(Browser flow only)_ Create a client secret and copy the **Value** (not the Secret ID). The default device-code sign-in doesn't need one
4. Under Authentication > **Add a platform** > **Mobile and desktop applications** — check `nativeclient` URI
5. Enable **"Allow public client flows"** in Authentication > Advanced settings
6. _(Optional)_ Set redirect URI to `http://localhost:3333/auth/callback` — only needed for browser auth flow

### 3. Configure Your MCP Client

**Plugin install (Claude Code).** The plugin bundles the server pinned to an exact version and asks for your settings when you enable it:

```bash
claude plugin marketplace add littlebearapps/outlook-assistant
claude plugin install outlook-assistant@littlebearapps
```

The same plugin folder ([`plugins/outlook-assistant`](plugins/outlook-assistant/)) also follows the [Agent Plugins](https://agent-plugins.org/) format used by GitHub Copilot and Cursor.

**Manual config.** Add to your MCP client config. Only `OUTLOOK_CLIENT_ID` is needed for the default device-code sign-in; add `OUTLOOK_CLIENT_SECRET` only if you use the [browser flow](#browser-redirect-flow-alternative). You can also leave the client ID out and give it to your assistant when you first connect (`auth action=authenticate clientId=…`), which saves it to `~/.outlook-assistant-config.json`. An `OUTLOOK_CLIENT_ID` in the environment always takes precedence.

<details>
<summary><strong>Claude Desktop</strong> (<code>claude_desktop_config.json</code>)</summary>

```json
{
  "mcpServers": {
    "outlook": {
      "command": "npx",
      "args": ["@littlebearapps/outlook-assistant"],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-application-client-id"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Claude Code</strong> (CLI)</summary>

```bash
claude mcp add outlook \
  -e OUTLOOK_CLIENT_ID=your-application-client-id \
  -- npx -y @littlebearapps/outlook-assistant
```

The MCP server reads its settings from the environment your client passes it; it doesn't load a `.env` file.
</details>

<details>
<summary><strong>VS Code / GitHub Copilot</strong> (<code>.vscode/mcp.json</code>)</summary>

VS Code prompts for the client ID the first time the server starts and stores it securely:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "outlook-client-id",
      "description": "Azure application (client) ID"
    }
  ],
  "servers": {
    "outlook": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@littlebearapps/outlook-assistant"],
      "env": {
        "OUTLOOK_CLIENT_ID": "${input:outlook-client-id}"
      }
    }
  }
}
```

Use it from Copilot Chat in **Agent** mode. To use it in every workspace, add the same entry to your user `mcp.json` (Command Palette → **MCP: Open User Configuration**).
</details>

<details>
<summary><strong>Cursor</strong> (<code>.cursor/mcp.json</code>)</summary>

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=Outlook%20Assistant&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBsaXR0bGViZWFyYXBwcy9vdXRsb29rLWFzc2lzdGFudCJdLCJlbnYiOnsiT1VUTE9PS19DTElFTlRfSUQiOiIifX0=)

Or add manually to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "outlook": {
      "command": "npx",
      "args": ["@littlebearapps/outlook-assistant"],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-application-client-id"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Windsurf</strong> (<code>~/.codeium/windsurf/mcp_config.json</code>)</summary>

```json
{
  "mcpServers": {
    "outlook": {
      "command": "npx",
      "args": ["@littlebearapps/outlook-assistant"],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-application-client-id"
      }
    }
  }
}
```
</details>

### 4. Authenticate

1. Ask your AI assistant to connect to Outlook — it calls the `auth` tool with `action=authenticate` and returns a short code and the URL `microsoft.com/devicelogin`
2. Open the URL on any device (a private/incognito window avoids cached sessions), enter the code, sign in and grant permissions
3. Tell your assistant you're done — it calls `auth` with `action=device-code-complete`
4. Tokens are saved locally and refresh automatically

No auth server is needed for this default device-code flow. If you'd rather use the browser redirect flow, see [Authentication Flow](#authentication-flow) below.

## Installation

### Prerequisites

- **Node.js** 18.18.0 or higher (contributors: the dev tooling needs 22.22.1 or higher)
- **npm** (included with Node.js)
- **Azure account** for app registration ([free tier works](https://azure.microsoft.com/free/))

### From npm (recommended)

```bash
npm install -g @littlebearapps/outlook-assistant
```

### From source

```bash
git clone https://github.com/littlebearapps/outlook-assistant.git
cd outlook-assistant
npm install
```

### CLI options

| Option | What it does |
|--------|-------------|
| `-v`, `--version` | Print the version to stdout and exit 0 |
| `-h`, `--help` | Print usage, options and key environment variables, and exit 0 |
| _(none)_ | Start the MCP server on stdio — the normal mode, invoked by your MCP client |

An unrecognised argument is reported on stderr and exits 1, rather than starting
a server that would ignore it.

## Azure App Registration

> **First time with Azure?** The [Azure Setup Guide](docs/guides/azure-setup.md) covers everything from creating an account to your first authentication, including billing setup and common pitfalls.

### Create the App

1. Open [Azure Portal](https://portal.azure.com/)
2. Sign in with a Microsoft Work or Personal account
3. Search for **App registrations** and click **New registration**
4. Enter a name (e.g. "Outlook Assistant Server")
5. Select **Accounts in any organizational directory and personal Microsoft accounts**
6. Set redirect URI: platform **Web**, URI `http://localhost:3333/auth/callback`
7. Click **Register**
8. Copy the **Application (client) ID**

### Add Permissions

1. Go to **API permissions** > **Add a permission** > **Microsoft Graph** > **Delegated permissions**
2. Add these **required** permissions:
   - `offline_access` — refresh tokens between sessions
   - `User.Read` — basic profile
   - `Mail.Read`, `Mail.ReadWrite`, `Mail.Send` — email operations
   - `Calendars.Read`, `Calendars.ReadWrite` — calendar operations
   - `Contacts.Read`, `Contacts.ReadWrite` — contact management
   - `MailboxSettings.ReadWrite` — settings, auto-replies, categories
   - `People.Read` — people search
3. Optionally add **org-only** permissions (work/school accounts only):
   - `Mail.Read.Shared` — shared mailbox read access (requested only when `OUTLOOK_SHARED_MAILBOX=read` or `=true`)
   - `Mail.ReadWrite.Shared` — shared mailbox writes (move/categorise/flag/mark-read; requested only when `OUTLOOK_SHARED_MAILBOX=true`)
   - `Place.Read.All` — meeting room search (requires admin consent)
4. Click **Add permissions**

### Create a Client Secret

Only needed for the [browser redirect flow](#browser-redirect-flow-alternative). Skip this if you sign in with the default device code.

1. Go to **Certificates & secrets** > **New client secret**
2. Enter a description and select expiration
3. Click **Add**
4. **Copy the secret Value immediately** — you won't be able to see it again. Use the **Value**, not the Secret ID.

## Configuration

### Environment Variables

Set these in your MCP client's `"env"` block (see [Quick Start](#3-configure-your-mcp-client)). The MCP server doesn't load `.env` files; the browser-flow auth server (`npm run auth-server`) does, so when running from source you can also keep a `.env` for it:

```bash
cp .env.example .env
```

Edit with your Azure credentials:

```bash
OUTLOOK_CLIENT_ID=your-application-client-id
OUTLOOK_CLIENT_SECRET=your-client-secret-VALUE
USE_TEST_MODE=false
```

> **Note:** The server also accepts `MS_CLIENT_ID` and `MS_CLIENT_SECRET` for backwards compatibility.

**Optional overrides** (v3.8.0+) — see [`.env.example`](.env.example) for the full list with commented worked examples:

| Variable | Purpose | Default |
|----------|---------|---------|
| `OUTLOOK_AUTH_AUDIENCE` | OAuth audience: `common`, `consumers` (personal-only Azure apps), `organizations`, or single-tenant GUID. Fixes `AADSTS9002331` for personal-only app registrations. | `common` |
| `OUTLOOK_DEFAULT_TIMEZONE` | IANA timezone applied to calendar events when callers don't pass one (e.g. `Europe/London`, `America/New_York`). | `Australia/Melbourne` |
| `OUTLOOK_MAX_EMAILS_PER_SESSION` | Default per-session cap for each rate-limited tool, counted separately until the server restarts: `send-email` (including `draft action=send`), `draft` create/update, and `manage-rules`. Override one tool with `OUTLOOK_MAX_<TOOL>_PER_SESSION`, e.g. `OUTLOOK_MAX_SEND_EMAIL_PER_SESSION`. | unlimited |
| `OUTLOOK_ALLOWED_RECIPIENTS` | Comma-separated allowlist of domains/addresses for sends, drafts, and rule forwards. | unrestricted |
| `OUTLOOK_SHARED_MAILBOX` | Opt-in shared-mailbox support (work/school only). `read` requests `Mail.Read.Shared`; `true` (or `readwrite`/`1`) also requests `Mail.ReadWrite.Shared`. Unset leaves sign-in unchanged. After enabling, restart and run `auth action=authenticate force=true`. | unset (off) |
| `OUTLOOK_SEARCH_SCAN_LIMIT` | How many recent messages the client-side search fallback scans. Personal accounts match `to` locally within this window, so the default caps how far back a `to` search reaches. Max 5000. | `500` |
| `OUTLOOK_REQUEST_TIMEOUT_MS` | Inactivity timeout for each Graph request attempt, in milliseconds: an attempt that receives no data for this long is abandoned with a timeout error. It isn't an overall deadline, so a slow response that keeps arriving isn't cut off. Throttled (`429`) and busy (`503`/`504`) responses are retried automatically, honouring `Retry-After`. | `60000` |

### MCP Client Configuration

See [Quick Start — Configure Your MCP Client](#3-configure-your-mcp-client) above for Claude Desktop, Claude Code, VS Code / GitHub Copilot, Cursor, and Windsurf configs.

If installed from source, use `node` instead of `npx`:

```json
{
  "mcpServers": {
    "outlook": {
      "command": "node",
      "args": ["/path/to/outlook-assistant/index.js"],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-application-client-id"
      }
    }
  }
}
```

## Authentication Flow

### Device Code Flow (Default — Recommended)

No auth server needed. Works everywhere, including remote/headless environments.

1. Ask your AI assistant to authenticate (calls `auth` tool with `action=authenticate`)
2. Visit the URL shown (`microsoft.com/devicelogin`) on **any** browser, **any** device
3. Enter the code, sign in with your Microsoft account, and grant permissions
4. Tell your AI assistant to complete authentication (calls `auth` with `action=device-code-complete`)
5. Tokens are saved to `~/.outlook-assistant-tokens.json` and **refresh automatically**

> **Prerequisite**: Enable "Allow public client flows" in Azure Portal > your app > Authentication > Advanced settings.
>
> **Server restarts** (v3.7.2+): Device code state is persisted to `~/.outlook-assistant-pending-auth.json`, so `device-code-complete` works even if the MCP server restarts between steps 1 and 4 (e.g., Untether/Telegram bridge, Claude Desktop session changes).

### Browser Redirect Flow (Alternative)

For localhost development or if you prefer the traditional OAuth flow, start the auth server. From a source checkout:

```bash
npm run auth-server
```

From a global npm install:

```bash
node "$(npm root -g)/@littlebearapps/outlook-assistant/outlook-auth-server.js"
```

This starts a local server on port 3333 to handle the OAuth callback. (The `outlook-assistant` command itself only accepts `--version` and `--help`; any other argument exits with an error.)

1. In your AI assistant, use the `auth` tool with `action=authenticate, method=browser`
2. Open the provided URL in your browser
3. Sign in and grant permissions — tokens are saved automatically

> **Note**: The auth server reads `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` from environment variables or a `.env` file in the directory you start it from. Your MCP client's `"env"` config only applies to the MCP server process, not a separately-started auth server.
>
> **Shared mailboxes**: the browser flow requests the configured scopes with no fallback. If you enable `OUTLOOK_SHARED_MAILBOX`, sign in with the device-code flow.

## Directory Structure

```
outlook-assistant/
├── index.js                 # Entry point: CLI flags, stdio transport
├── server.js                # MCP server factory (capabilities, request handler)
├── tools.js                 # Tool registry (22 tools)
├── request-handler.js       # Routes MCP requests; JSON-RPC errors for unknown methods/tools
├── config.js                # Configuration settings
├── outlook-auth-server.js   # OAuth server (port 3333)
├── auth/                    # Authentication module (1 tool)
├── email/                   # Email module (8 tools)
│   ├── mail-tips.js         # Pre-send recipient validation
│   ├── headers.js           # Email header retrieval
│   ├── mime.js              # Raw MIME/EML content
│   ├── conversations.js     # Thread listing/export
│   ├── attachments.js       # Attachment operations
│   └── ...
├── calendar/                # Calendar module (3 tools)
│   ├── attendees.js         # Attendee builder (email or {email, type})
│   └── list.js              # list-events filters
├── contacts/                # Contacts module (2 tools)
├── categories/              # Categories module (3 tools)
├── settings/                # Settings module (1 tool)
├── folder/                  # Folder module (1 tool; resolve.js resolves paths/IDs)
├── rules/                   # Rules module (1 tool)
├── advanced/                # Advanced module (2 tools)
└── utils/
    ├── graph-api.js         # Microsoft Graph API client (includes $batch, path guards)
    ├── mailbox.js           # me vs users/{sharedMailbox} prefix, shared-mailbox opt-in
    ├── risk-classes.js      # Risk class per tool/action; derives annotations and titles
    ├── tool-error.js        # isError tool results with a next step
    ├── safety.js            # Rate limiting, recipient allowlist, dry-run
    ├── safe-write.js        # Exclusive, outputDir-confined file writes
    ├── datetime.js          # ISO 8601 parsing and timezone conversion
    ├── odata-helpers.js     # OData query building
    ├── field-presets.js     # Token-efficient field selections
    ├── response-formatter.js # Verbosity levels
    └── mock-data.js         # Test mode data
```

## Troubleshooting

### "Cannot find module '@modelcontextprotocol/sdk/server/index.js'"

```bash
npm install
```

### "EADDRINUSE: address already in use :::3333"

```bash
npx kill-port 3333
npm run auth-server
```

### "Invalid client secret" (AADSTS7000215)

You're using the Secret **ID** instead of the Secret **Value**. Go to Azure Portal > Certificates & secrets and copy the **Value** column into `OUTLOOK_CLIENT_SECRET`.

The Value is shown only once, when the secret is created — if you've navigated away it can't be read again, so create a new secret. An **expired** secret produces this same error, so check the Expires column too.

Since v3.11.0 the server detects this error and appends the explanation to Microsoft's original message, so you see both the raw error code and what to do about it.

### Authentication URL doesn't work

If using browser flow: start the auth server first with `npm run auth-server`. If using device code flow: visit `microsoft.com/devicelogin` instead.

### Device code "invalid_client"

Enable "Allow public client flows" in Azure Portal > App registrations > Authentication > Advanced settings.

### Token refresh fails after ~60 minutes (device code auth)

Fixed in v3.7.2. Earlier versions sent `client_secret` in token refresh requests for device-code auth, which Microsoft rejects for public client flows. Update to v3.7.2+ or re-authenticate.

### "Authentication required."

You're signed out, or the saved token expired and couldn't be refreshed. The error says what to do next: sign in with the `auth` tool with `action=authenticate` (add `force=true` to replace an existing session), then retry the call. `auth action=status` shows the current state.

## Development

### Running Tests

```bash
npm test                     # Jest unit tests
npm run inspect              # MCP Inspector (interactive)
```

### Test Mode

Run with mock data (no real API calls):

```bash
USE_TEST_MODE=true npm start
```

### Extending the Server

1. Create a new module directory (e.g. `tasks/`)
2. Implement tool handlers in separate files
3. Export tool definitions from the module's `index.js`
4. Add the module's tools to the `TOOLS` array in `tools.js`
5. Classify every tool and action in `utils/risk-classes.js` (a test fails on anything unclassified); the annotations and title come from there
6. Add tests in `test/`
7. Update `docs/quickrefs/tools-reference.md`

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/how-to/getting-started/connect-outlook-to-claude.md) | Install, configure, and authenticate — start here |
| [Azure Setup Guide](docs/guides/azure-setup.md) | Azure account creation, app registration, permissions, and secrets |
| [How-To Guides](docs/how-to/index.md) | 29 practical guides for email, calendar, contacts, and settings |
| [Roadmap](ROADMAP.md) | Active milestones (v3.14.0, v3.15.0, v4.0.0, v3.8.x, v3.16.0+) and recent releases |
| [Troubleshooting](docs/troubleshooting.md) | Known errors and fixes, including auth, search, export and shared mailboxes |
| [FAQ](docs/faq/faq.md) | Install, accounts, permissions, tokens, updates, uninstall |
| [Tools Reference](docs/quickrefs/tools-reference.md) | All 22 tools with parameters |
| [AI Agent Guide](docs/how-to/ai-agents/using-outlook-assistant-in-agents.md) | Tool selection and workflow patterns for AI agents |

Full documentation: [docs/](docs/README.md)

## Known Limitations

- **Personal account search**: Free-text `query` and the raw `searchExpression` (formerly `kqlQuery`) rely on Microsoft's `$search` API, which has limited support on personal Outlook.com accounts. `query` mitigates this with progressive fallback (OData filters, boolean filters, then a client-side scan). Field-scoped `$search` (e.g. `subject:"…"`) is rejected outright there; since v3.10.0 `from:`/`to:`/`subject:` expressions are translated into the closest equivalent OData filters and retried, but boolean operators, grouping, wildcards and other field prefixes are not — those still terminate with an explicit no-results rather than a silent broader search. Structured filters (`from`, `subject`, `to`, `receivedAfter`) remain the most direct route. Cross-folder search (`searchAllFolders: true`) returns a superset of inbox-only results. Note that `query` and `searchExpression` are not interchangeable there: `searchExpression` goes to `$search`, which matches the whole message including the body and ranks by relevance rather than date, while `query` falls back to a subject substring match that never reads bodies.
- **`to` search depth on personal accounts**: the server-side recipient filter is rejected, so `to` is matched locally over the 500 most recent messages (`OUTLOOK_SEARCH_SCAN_LIMIT`, max 5000). On a large archive that excludes older mail — pair `to` with `receivedAfter`/`receivedBefore`. Since v3.11.1 the response says so whenever the scan was truncated, whether or not it matched.
- **Focused Inbox**: Only available on work/school Microsoft 365 accounts.
- **Shared mailboxes**: Require a work/school account and are **opt-in**: set `OUTLOOK_SHARED_MAILBOX=read` (read) or `=true` (read and organise), restart the server, then re-authenticate with `auth action=authenticate force=true`. Until then, `sharedMailbox` calls are refused with setup guidance (`access-shared-mailbox` keeps its previous well-known-folder behaviour). `auth action=about` shows whether the shared scopes were actually granted. Support covers reading and organising only. Reading needs `Mail.Read.Shared`; organising (move/categorise/flag/mark-read/create folders via `sharedMailbox`) needs `Mail.ReadWrite.Shared` — add it in Azure and re-authenticate (until then, shared-scoped writes fail with 403; they never fall back to your own mailbox). Custom subfolders are supported — pass `folder` as a display name or nested path (e.g. `Inbox/Vendors/Acme`), a raw `folderId`, or use `listFolders: true` (or `folders action=list, sharedMailbox: …`) to discover them. **Sending, drafts, replies, and forwards from a shared mailbox are not supported** — `send-email` and `draft` (including reply/reply-all/forward) always act on the signed-in user's own mailbox, and `Mail.Send.Shared` is not requested.
- **Meeting room search**: Requires `Place.Read.All` permission with admin consent (work/school accounts only).
- **Export default path**: Exports and attachment downloads save to the system temp directory by default. Use `outputDir` (or `savePath`) to choose a different location.
- **`list-events` date filters**: `startAfter`/`startBefore` must include `Z` or a ±hh:mm offset; zone-less and date-only values are rejected rather than guessed.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For security concerns, please see our [Security Policy](SECURITY.md). Do not open public issues for vulnerabilities.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## About

Built and maintained by [Little Bear Apps](https://littlebearapps.com). Outlook Assistant is open source under the [MIT License](LICENSE).
