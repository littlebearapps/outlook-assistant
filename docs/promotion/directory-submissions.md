# Outlook MCP — Directory Submission Tracker

Generated: 2026-03-05

## Completed Submissions (Automated)

### Awesome Lists (PRs)

| # | Directory | PR URL | Status |
|---|-----------|--------|--------|
| 1 | punkpeye/awesome-mcp-servers (82k stars) | https://github.com/punkpeye/awesome-mcp-servers/pull/2742 | Pending review |
| 2 | appcypher/awesome-mcp-servers (5.2k stars) | https://github.com/appcypher/awesome-mcp-servers/pull/492 | Pending review |
| 3 | TensorBlock/awesome-mcp-servers (557 stars) | https://github.com/TensorBlock/awesome-mcp-servers/pull/136 | Pending review |
| 4 | YuzeHao2023/Awesome-MCP-Servers (1k stars) | https://github.com/YuzeHao2023/Awesome-MCP-Servers/pull/46 | Pending review |

### Directory Issues

| # | Directory | Issue URL | Status |
|---|-----------|-----------|--------|
| 5 | Cline MCP Marketplace | https://github.com/cline/mcp-marketplace/issues/792 | Pending review |
| 6 | mcp.so (via chatmcp/mcpso) | https://github.com/chatmcp/mcpso/issues/679 | Pending review |

### Not Submitted (PRs disabled)

| # | Directory | Reason |
|---|-----------|--------|
| — | wong2/awesome-mcp-servers (3.7k stars) | PRs from forks not allowed |

---

## Manual Submissions Required

### PulseMCP

**URL:** https://www.pulsemcp.com/submit

**Suggested content:**
- **Name:** Outlook MCP
- **GitHub URL:** https://github.com/littlebearapps/outlook-mcp
- **Description:** MCP server for Microsoft Outlook via Graph API. 20 consolidated tools across 9 modules for email, calendar, contacts, folders, rules, categories, settings, and advanced features. Key differentiators: progressive search that adapts to personal vs work accounts, built-in email forensics (DKIM/SPF/DMARC analysis), delta sync for inbox monitoring, batch operations, and safety controls (dry-run preview, rate limiting, recipient allowlists). Works with personal Outlook.com and work/school Microsoft 365 accounts. MIT licensed.

### mcp.so (web form backup)

**URL:** https://mcp.so/submit

If the GitHub issue (#679) doesn't get picked up, submit manually via the web form with the same details as above.

### Smithery.ai

**URL:** https://smithery.ai/new (requires sign-in)

Two options:
1. Sign in and link the GitHub repo via the web UI
2. Create a `smithery.yaml` in the repo root:

```yaml
runtime: "container"
startCommand:
  type: "stdio"
  configSchema:
    type: "object"
    properties:
      OUTLOOK_CLIENT_ID:
        type: "string"
        description: "Azure AD application client ID"
      OUTLOOK_CLIENT_SECRET:
        type: "string"
        description: "Azure AD application client secret"
    required:
      - OUTLOOK_CLIENT_ID
      - OUTLOOK_CLIENT_SECRET
  commandFunction: |
    (config) => ({
      command: "npx",
      args: ["@littlebearapps/outlook-mcp"],
      env: {
        OUTLOOK_CLIENT_ID: config.OUTLOOK_CLIENT_ID,
        OUTLOOK_CLIENT_SECRET: config.OUTLOOK_CLIENT_SECRET
      }
    })
```

### Glama.ai

**URL:** https://glama.ai/mcp/servers (click "Add Server")

Should auto-index once the punkpeye PR is merged, since mcpservers.org is the web frontend for that repo.

### mcpservers.org

**URL:** https://mcpservers.org/submit

This is the web frontend for punkpeye/awesome-mcp-servers — PR #2742 covers this. No separate submission needed.

---

## Community Posts (Draft Content)

### Reddit r/mcp (78k members)

**Title:** I built an MCP server for Microsoft Outlook — 20 tools for email, calendar, contacts, and more

**Body:**

Hey r/mcp! I've been building an MCP server that connects Claude (and other AI assistants) to Microsoft Outlook via the Graph API.

**What it does:**
- Search, read, and send emails with full conversation threading
- Manage calendar events — schedule, decline, cancel
- CRUD operations on contacts + organisational directory search
- Create inbox rules, manage categories, configure auto-replies
- Export emails to Markdown, EML, MBOX, JSON, or HTML
- Email header forensics — check DKIM, SPF, DMARC authentication
- Access shared mailboxes and find meeting rooms (Microsoft 365)

**What makes it different from other Outlook MCPs:**
- **20 consolidated tools** (reduced from 55) — designed for token efficiency so Claude doesn't waste context on tool descriptions
- **Safety controls**: dry-run preview before sending, session rate limiting, recipient allowlists
- **MCP annotations** on every tool — `readOnlyHint`, `destructiveHint`, `idempotentHint` so Claude knows which tools are safe to auto-approve
- **Progressive search**: automatically adapts to personal vs work accounts — if Microsoft's `$search` API is unavailable, it falls back through OData filters transparently
- **Delta sync**: built-in incremental inbox monitoring — only returns what changed since your last check, with tokens for continuous polling
- **Email forensics**: analyse DKIM, SPF, DMARC authentication and delivery chains in a single tool call
- Works with **both** personal Outlook.com and work/school Microsoft 365 accounts

**Install:**
```
npm install -g @littlebearapps/outlook-mcp
```

GitHub: https://github.com/littlebearapps/outlook-mcp
npm: https://www.npmjs.com/package/@littlebearapps/outlook-mcp

Happy to answer questions or take feature requests!

**Flair:** Server

---

### Reddit r/ClaudeAI (437k members)

**Title:** Built an MCP server that gives Claude full access to Microsoft Outlook

**Body:**

I built [Outlook MCP](https://github.com/littlebearapps/outlook-mcp), an MCP server that lets Claude read, search, send, and manage your Outlook email, calendar, and contacts — all from the conversation.

A few things I'm proud of with the design:
- **Token efficiency**: 20 consolidated tools (down from 55) so Claude's context window isn't eaten up by tool descriptions
- **Safety-first**: email sends have dry-run preview, session rate limiting, and recipient allowlists so Claude can't accidentally spam your boss
- **MCP annotations**: every tool has `readOnlyHint`/`destructiveHint` flags so Claude Code can auto-approve read operations
- **Email forensics**: one tool call to check DKIM, SPF, DMARC, delivery chains, and spam scores — useful for investigating suspicious emails
- **Delta sync**: incremental inbox monitoring returns only changes since your last check

Works with personal Outlook.com and Microsoft 365 accounts. MIT licensed, published on npm.

Install: `npm install -g @littlebearapps/outlook-mcp`

**Flair:** Built with Claude

---

## Later: Formal Registries

### Official MCP Registry (registry.modelcontextprotocol.io)

Use `mcp-publisher` CLI tool to publish a `server.json` manifest. Most impactful long-term since all aggregators scrape from here.

### GitHub MCP Registry (github.com/mcp)

Backed by GitHub, feeds into VS Code/Copilot discovery. Submit via their process.

### Docker MCP Registry (github.com/docker/mcp-registry)

Submit via PR following their CONTRIBUTING guide.

---

## Verification Checklist (check back in 1-2 weeks)

- [ ] Search each directory for "littlebearapps" or "outlook-mcp"
- [ ] Monitor GitHub star/fork count
- [ ] Check PulseMCP's "Est Visitors" metric once listed
- [ ] Verify Glama.ai auto-indexed after punkpeye PR merge
