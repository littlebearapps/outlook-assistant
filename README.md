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
</p>

Outlook Assistant connects AI assistants to your Microsoft Outlook account through the [Model Context Protocol](https://modelcontextprotocol.io/). Ask your AI assistant to search your inbox, send emails, schedule meetings, manage contacts, and configure mailbox settings — without leaving the conversation. Works with Claude, Cursor, Windsurf, and any MCP-compatible client.

**Works with personal Outlook.com and work/school Microsoft 365 accounts.**

<div align="center">
  <br />
  <a href="docs/demo/outlook-assistant-demo.mp4">
    <img src="docs/demo/outlook-assistant-demo.gif" alt="Outlook Assistant Demo — searching emails, reading, and drafting a reply" width="720" style="border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.12);" />
  </a>
  <br />
  <sub>Search inbox → read &amp; summarise → draft a reply — all from the conversation</sub>
  <br /><br />
</div>

### What you can do

- 📨 **Search and read emails** — find messages by sender, subject, date, or keywords; read full threads with conversation grouping; batch flag, move, export, or categorise multiple emails at once
- 🛡️ **Send emails with safety controls** — dry-run preview, pre-send mail tips (out-of-office, mailbox full, delivery restrictions), session rate limiting, and recipient allowlist to prevent mistakes
- ✏️ **Draft emails for review** — create, update, and send drafts; reply and forward as drafts; preview before saving with dry-run mode
- 📅 **Manage your calendar** — view upcoming events, schedule meetings with attendees, decline or cancel invitations
- 📦 **Export emails** — save to Markdown, EML, MBOX, JSON, or HTML for archiving, analysis, or migration; export search results or entire threads in one call
- 🔍 **Investigate email headers** — check DKIM, SPF, and DMARC authentication; trace delivery chains; analyse spam scores — useful for phishing investigation and compliance
- 🗂️ **Organise your inbox** — create folders, set up inbox rules, colour-code with categories, manage Focused Inbox — all work together for complete inbox automation
- 🔄 **Track inbox changes** — delta sync detects new, modified, and deleted emails since your last check, with tokens for incremental polling
- 👥 **Manage contacts** — search your contact book and organisational directory, create and update contact records
- ⚙️ **Configure settings** — set out-of-office auto-replies, working hours, and time zone
- 📬 **Access shared mailboxes** — read team inboxes and service accounts (Microsoft 365)
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

## Hosted deployment

A hosted deployment is available on [Fronteir AI](https://fronteir.ai/mcp/littlebearapps-outlook-assistant).

## Features

| Module | Tools | What You Can Do |
|--------|------:|-----------------|
| **Email** | 8 | `search-emails` (list/search/delta/conversations), `read-email` (content + forensic headers), `send-email` (with dry-run + mail tips), `draft` (create/update/send/delete/reply/forward), `update-email` (read status, flags), `attachments`, `export`, `get-mail-tips` |
| **Calendar** | 3 | `list-events`, `create-event`, `manage-event` (decline/cancel/delete) |
| **Contacts** | 2 | `manage-contact` (list/search/get/create/update/delete), `search-people` |
| **Categories** | 3 | `manage-category` (CRUD), `apply-category`, `manage-focused-inbox` |
| **Settings** | 1 | `mailbox-settings` (get/set auto-replies/set working hours) |
| **Folder** | 1 | `folders` (list/create/move/stats/delete) |
| **Rules** | 1 | `manage-rules` (list/create/reorder/delete) |
| **Advanced** | 2 | `access-shared-mailbox`, `find-meeting-rooms` |
| **Auth** | 1 | `auth` (status/authenticate/about) |

**22 tools total** — consolidated from 55 for optimal AI performance. See the [Tools Reference](docs/quickrefs/tools-reference.md) for complete parameter details.

### Export Formats

| Format | Extension | When to Use It |
|--------|-----------|----------------|
| `mime` / `eml` | `.eml` | Legal holds, forensic preservation, importing into other mail clients |
| `mbox` | `.mbox` | Archiving entire conversation threads, migrating between systems |
| `markdown` | `.md` | Pasting into documents, feeding into AI workflows |
| `json` | `.json` | Data analysis, pipeline processing, compliance reporting |
| `html` | `.html` | Visual archival with formatting intact |
| `csv` | `.csv` | Spreadsheet import, bulk metadata analysis, compliance audits |

Export individual emails, search results, or entire conversation threads — use `target=messages` with a search query to batch-export without manually collecting IDs.

## Account Compatibility

Outlook Assistant works with both personal and work/school Microsoft accounts, but some features behave differently:

| Feature | Personal (Outlook.com) | Work/School (Microsoft 365) |
|---------|----------------------|---------------------------|
| Email read, send, search | Full support | Full support |
| Calendar events | Full support | Full support |
| Contacts CRUD | Full support | Full support |
| Inbox rules | Full support | Full support |
| Folders | Full support | Full support |
| Free-text `query` search | Limited — use `subject`, `from`, `to` filters instead | Full KQL support |
| Categories | Full support | Full support |
| Mailbox settings | Full support | Full support |
| Focused Inbox | Not available | Full support |
| Shared mailboxes | Not available | Requires `Mail.Read.Shared` |
| Meeting room search | Not available | Requires `Place.Read.All` + admin consent |

> **Note**: On personal accounts, Microsoft's `$search` API has limited support for free-text queries. Outlook Assistant handles this automatically with progressive search — if your query returns no results, it falls back through OData filters, boolean filters, and recent message listing to find your emails. For the most direct results on personal accounts, use the structured filter parameters (`from`, `subject`, `to`, `receivedAfter`).

### What Makes This Different

- **Progressive search** — on accounts where Microsoft's `$search` API is limited, Outlook Assistant automatically falls back through up to 4 search strategies to find your emails. Most Graph API wrappers fail silently; this one adapts.
- **Email forensics** — full header analysis (DKIM, SPF, DMARC, delivery chain, spam scores) built in as a first-class feature — useful for phishing investigation, compliance, and security review.
- **Delta sync** — incremental inbox monitoring returns only what changed since your last check, with tokens for continuous polling. Designed for agent workflows that need to watch a mailbox.
- **Batch operations** — flag, move, export, or categorise multiple emails in a single call. Search-driven export lets you batch-export results without collecting IDs manually.
- **Pre-send intelligence** — check recipients for out-of-office, full mailbox, delivery restrictions, and moderation status before sending — no other Outlook MCP server offers this.
- **Compound automation** — rules, categories, folders, and Focused Inbox work together. Set up complete inbox management through your AI assistant in one conversation.

## Safety & Token Efficiency

Outlook Assistant is designed with safety-first principles for AI-driven email access:

**Destructive action safeguards** — Every tool carries [MCP annotations](https://modelcontextprotocol.io/docs/concepts/tools#annotations) (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so AI clients can auto-approve safe reads and prompt for confirmation on destructive operations like sending email or deleting events.

**Send-email protections** — The `send-email` tool includes:
- **Pre-send mail tips** (`checkRecipients: true`) — check recipients for out-of-office, mailbox full, delivery restrictions before sending
- **Dry-run mode** (`dryRun: true`) — preview composed emails without sending
- **Session rate limiting** — configurable via `OUTLOOK_MAX_EMAILS_PER_SESSION` (default: unlimited)
- **Recipient allowlist** — restrict sending to approved addresses/domains via `OUTLOOK_ALLOWED_RECIPIENTS`

**Draft protections** — The `draft` tool shares `send-email` safety controls: dry-run preview, recipient allowlist, mail-tips validation, and rate limiting. The `send` action shares the `send-email` rate limit counter, preventing circumvention via the draft-then-send pathway.

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

### 2. Register an Azure App

You need a Microsoft Azure app registration to authenticate. See the **[Azure Setup Guide](docs/guides/azure-setup.md)** for a detailed walkthrough (including first-time Azure account creation), or if you've done this before:

1. Create a new app registration at [portal.azure.com](https://portal.azure.com/)
2. Add Microsoft Graph delegated permissions (Mail, Calendar, Contacts)
3. Create a client secret and copy the **Value** (not the Secret ID)
4. Under Authentication > **Add a platform** > **Mobile and desktop applications** — check `nativeclient` URI
5. Enable **"Allow public client flows"** in Authentication > Advanced settings
6. _(Optional)_ Set redirect URI to `http://localhost:3333/auth/callback` — only needed for browser auth flow

### 3. Configure Your MCP Client

Add to your MCP client config:

<details>
<summary><strong>Claude Desktop</strong> (<code>claude_desktop_config.json</code>)</summary>

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
</details>

<details>
<summary><strong>Claude Code</strong> (CLI)</summary>

```bash
claude mcp add outlook -- npx @littlebearapps/outlook-assistant
```

Then set environment variables in your `.env` or shell.
</details>

<details>
<summary><strong>Cursor</strong> (<code>.cursor/mcp.json</code>)</summary>

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=Outlook%20Assistant&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBsaXR0bGViZWFyYXBwcy9vdXRsb29rLWFzc2lzdGFudCJdLCJlbnYiOnsiT1VUTE9PS19DTElFTlRfSUQiOiIiLCJPVVRMT09LX0NMSUVOVF9TRUNSRVQiOiIifX0=)

Or add manually to `.cursor/mcp.json`:

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
        "OUTLOOK_CLIENT_ID": "your-application-client-id",
        "OUTLOOK_CLIENT_SECRET": "your-client-secret-VALUE"
      }
    }
  }
}
```
</details>

### 4. Authenticate

1. Start the auth server: `outlook-assistant-auth` (or `npx @littlebearapps/outlook-assistant-auth`)
2. In your AI assistant, use the `auth` tool with `action=authenticate` to get an OAuth URL
3. Open the URL, sign in with your Microsoft account, and grant permissions
4. Tokens are saved locally and refresh automatically

> **Note**: The auth server needs `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` environment variables. Your MCP client's `"env"` config only applies to the MCP server process — when running the auth server separately, ensure these are set in a `.env` file or exported in your shell.

## Installation

### Prerequisites

- **Node.js** 18.0.0 or higher
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
   - `Mail.Read.Shared` — shared mailbox access
   - `Place.Read.All` — meeting room search (requires admin consent)
4. Click **Add permissions**

### Create a Client Secret

1. Go to **Certificates & secrets** > **New client secret**
2. Enter a description and select expiration
3. Click **Add**
4. **Copy the secret Value immediately** — you won't be able to see it again. Use the **Value**, not the Secret ID.

## Configuration

### Environment Variables

Create a `.env` file from the example:

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

### MCP Client Configuration

See [Quick Start — Configure Your MCP Client](#3-configure-your-mcp-client) above for Claude Desktop, Claude Code, Cursor, and Windsurf configs.

If installed from source, use `node` instead of `npx`:

```json
{
  "mcpServers": {
    "outlook": {
      "command": "node",
      "args": ["/path/to/outlook-assistant/index.js"],
      "env": {
        "OUTLOOK_CLIENT_ID": "your-application-client-id",
        "OUTLOOK_CLIENT_SECRET": "your-client-secret-VALUE"
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

### Browser Redirect Flow (Alternative)

For localhost development or if you prefer the traditional OAuth flow:

```bash
npm run auth-server
```

This starts a local server on port 3333 to handle the OAuth callback.

1. In your AI assistant, use the `auth` tool with `action=authenticate, method=browser`
2. Open the provided URL in your browser
3. Sign in and grant permissions — tokens are saved automatically

> **Note**: The auth server reads `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` from environment variables. Your MCP client's `"env"` config only applies to the MCP server process, not a separately-started auth server.

## Directory Structure

```
outlook-assistant/
├── index.js                 # Main entry point (22 tools)
├── config.js                # Configuration settings
├── outlook-auth-server.js   # OAuth server (port 3333)
├── auth/                    # Authentication module (1 tool)
├── email/                   # Email module (7 tools)
│   ├── mail-tips.js         # Pre-send recipient validation
│   ├── headers.js           # Email header retrieval
│   ├── mime.js              # Raw MIME/EML content
│   ├── conversations.js     # Thread listing/export
│   ├── attachments.js       # Attachment operations
│   └── ...
├── calendar/                # Calendar module (3 tools)
├── contacts/                # Contacts module (2 tools)
├── categories/              # Categories module (3 tools)
├── settings/                # Settings module (1 tool)
├── folder/                  # Folder module (1 tool)
├── rules/                   # Rules module (1 tool)
├── advanced/                # Advanced module (2 tools)
└── utils/
    ├── graph-api.js         # Microsoft Graph API client (includes $batch)
    ├── safety.js            # Rate limiting, recipient allowlist, dry-run
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

You're using the Secret **ID** instead of the Secret **Value**. Go to Azure Portal > Certificates & secrets and copy the **Value** column.

### Authentication URL doesn't work

If using browser flow: start the auth server first with `npm run auth-server`. If using device code flow: visit `microsoft.com/devicelogin` instead.

### Device code "invalid_client"

Enable "Allow public client flows" in Azure Portal > App registrations > Authentication > Advanced settings.

### Empty API responses

Check authentication status with the `auth` tool (action=status). Tokens may have expired — re-authenticate if needed.

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
4. Import and add tools to the `TOOLS` array in main `index.js`
5. Add tests in `test/`
6. Update `docs/quickrefs/tools-reference.md`

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/how-to/getting-started/connect-outlook-to-claude.md) | Install, configure, and authenticate — start here |
| [Azure Setup Guide](docs/guides/azure-setup.md) | Azure account creation, app registration, permissions, and secrets |
| [How-To Guides](docs/how-to/index.md) | 28 practical guides for email, calendar, contacts, and settings |
| [Troubleshooting & FAQ](docs/how-to/getting-started/verify-your-connection.md#common-connection-problems) | Common problems, re-authentication, and frequently asked questions |
| [Tools Reference](docs/quickrefs/tools-reference.md) | All 22 tools with parameters |
| [AI Agent Guide](docs/how-to/ai-agents/using-outlook-assistant-in-agents.md) | Tool selection and workflow patterns for AI agents |

Full documentation: [docs/](docs/README.md)

## Known Limitations

- **Personal account search**: Free-text `query` and `kqlQuery` rely on Microsoft's `$search` API, which has limited support on personal Outlook.com accounts. Outlook Assistant mitigates this with progressive search fallback (trying OData filters automatically), but for the most direct results, use structured filters (`from`, `subject`, `to`, `receivedAfter`).
- **Focused Inbox**: Only available on work/school Microsoft 365 accounts.
- **Shared mailboxes**: Require `Mail.Read.Shared` permission and a work/school account.
- **Meeting room search**: Requires `Place.Read.All` permission with admin consent (work/school accounts only).
- **Export default path**: Exports save to the system temp directory by default. Use `savePath` or `outputDir` to specify a different location.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For security concerns, please see our [Security Policy](SECURITY.md). Do not open public issues for vulnerabilities.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Listed On

<a href="https://glama.ai/mcp/servers/littlebearapps/outlook-assistant"><img width="190" height="100" src="https://glama.ai/mcp/servers/littlebearapps/outlook-assistant/badge" alt="Outlook Assistant on Glama" /></a>

## About

Built and maintained by [Little Bear Apps](https://littlebearapps.com). Outlook Assistant is open source under the [MIT License](LICENSE).
