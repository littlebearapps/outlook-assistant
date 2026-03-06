# Outlook Assistant — Directory Submission Tracker

Generated: 2026-03-05
Last updated: 2026-02-27 (Official MCP Registry published, Glama submitted)

## Completed Submissions (Automated)

### Awesome Lists (PRs)

| # | Directory | PR URL | Status |
|---|-----------|--------|--------|
| 1 | punkpeye/awesome-mcp-servers (82k stars) | https://github.com/punkpeye/awesome-mcp-servers/pull/2742 | **Action needed** — requires Glama.ai link |
| 2 | appcypher/awesome-mcp-servers (5.2k stars) | https://github.com/appcypher/awesome-mcp-servers/pull/492 | Pending review (no response) |
| 3 | TensorBlock/awesome-mcp-servers (557 stars) | https://github.com/TensorBlock/awesome-mcp-servers/pull/136 | **Merged** (2026-03-05 by wilsonccccc) |
| 4 | YuzeHao2023/Awesome-MCP-Servers (1k stars) | https://github.com/YuzeHao2023/Awesome-MCP-Servers/pull/46 | Pending review (no response) |

### Directory Issues

| # | Directory | Issue URL | Status |
|---|-----------|-----------|--------|
| 5 | Cline MCP Marketplace | https://github.com/cline/mcp-marketplace/issues/792 | Pending review (no response) |
| 6 | mcp.so (via chatmcp/mcpso) | https://github.com/chatmcp/mcpso/issues/679 | Submitted (issue + web form 2026-02-27) |

### Not Submitted (PRs disabled)

| # | Directory | Reason |
|---|-----------|--------|
| — | wong2/awesome-mcp-servers (3.7k stars) | PRs from forks not allowed |

---

## Manual Submissions Required

### Glama.ai (CRITICAL PATH) — Submitted 2026-02-27

**URL:** https://glama.ai/mcp/servers (click "Add Server")

**Status:** Submitted as "Outlook-MCP" Server type, pending Glama review/indexing. Once live, expected URL: `https://glama.ai/mcp/servers/littlebearapps/outlook-assistant`

**Why critical:** The punkpeye/awesome-mcp-servers PR (#2742, 82k stars) **requires a Glama link before merge**. The maintainer replied requesting it. This also gates mcpservers.org auto-indexing.

**Steps:**
1. Go to https://glama.ai/mcp/servers and click "Add Server"
2. Link the GitHub repo: `https://github.com/littlebearapps/outlook-assistant`
3. Once listed, expected URL: `https://glama.ai/mcp/servers/@littlebearapps/outlook-assistant`
4. Update punkpeye PR #2742 to add the Glama link (see Step 2 below)

**After Glama listing is live**, update the PR's README line on fork `nathanschram/awesome-mcp-servers` branch `add-outlook-assistant`. Change from:

```markdown
- [littlebearapps/outlook-assistant](https://github.com/littlebearapps/outlook-assistant) 📇 ☁️ - MCP server for Microsoft Outlook with 20 consolidated tools...
```

To:

```markdown
- [littlebearapps/outlook-assistant](https://github.com/littlebearapps/outlook-assistant) [glama](https://glama.ai/mcp/servers/@littlebearapps/outlook-assistant) 📇 ☁️ - MCP server for Microsoft Outlook with 20 consolidated tools...
```

### PulseMCP — Pending (auto-ingest)

**URL:** https://www.pulsemcp.com/submit

**Status:** No manual submission needed. PulseMCP auto-ingests from the Official MCP Registry weekly. Our registry listing went live 2026-02-27, so expect PulseMCP indexing within ~1 week.

### mcp.so (web form) — Submitted 2026-02-27

**URL:** https://mcp.so/submit

Submitted via web form (GitHub issue #679 also open as backup). Pending review/indexing.

### Smithery.ai (DEFERRED)

**URL:** https://smithery.ai/new (requires sign-in)

**Status:** Deferred — Smithery now requires a hosted HTTP endpoint for publishing. Our server is stdio-based. `smithery.yaml` is in the repo for future compatibility.

Previously two options:
1. Sign in and link the GitHub repo via the web UI
2. Create a `smithery.yaml` in the repo root (done):

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
      args: ["@littlebearapps/outlook-assistant"],
      env: {
        OUTLOOK_CLIENT_ID: config.OUTLOOK_CLIENT_ID,
        OUTLOOK_CLIENT_SECRET: config.OUTLOOK_CLIENT_SECRET
      }
    })
```

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

**What makes it different from other Outlook Assistants:**
- **20 consolidated tools** (reduced from 55) — designed for token efficiency so Claude doesn't waste context on tool descriptions
- **Safety controls**: dry-run preview before sending, session rate limiting, recipient allowlists
- **MCP annotations** on every tool — `readOnlyHint`, `destructiveHint`, `idempotentHint` so Claude knows which tools are safe to auto-approve
- **Progressive search**: automatically adapts to personal vs work accounts — if Microsoft's `$search` API is unavailable, it falls back through OData filters transparently
- **Delta sync**: built-in incremental inbox monitoring — only returns what changed since your last check, with tokens for continuous polling
- **Email forensics**: analyse DKIM, SPF, DMARC authentication and delivery chains in a single tool call
- Works with **both** personal Outlook.com and work/school Microsoft 365 accounts

**Install:**
```
npm install -g @littlebearapps/outlook-assistant
```

GitHub: https://github.com/littlebearapps/outlook-assistant
npm: https://www.npmjs.com/package/@littlebearapps/outlook-assistant

Happy to answer questions or take feature requests!

**Flair:** Server

---

### Reddit r/ClaudeAI (437k members)

**Title:** Built an MCP server that gives Claude full access to Microsoft Outlook

**Body:**

I built [Outlook Assistant](https://github.com/littlebearapps/outlook-assistant), an MCP server that lets Claude read, search, send, and manage your Outlook email, calendar, and contacts — all from the conversation.

A few things I'm proud of with the design:
- **Token efficiency**: 20 consolidated tools (down from 55) so Claude's context window isn't eaten up by tool descriptions
- **Safety-first**: email sends have dry-run preview, session rate limiting, and recipient allowlists so Claude can't accidentally spam your boss
- **MCP annotations**: every tool has `readOnlyHint`/`destructiveHint` flags so Claude Code can auto-approve read operations
- **Email forensics**: one tool call to check DKIM, SPF, DMARC, delivery chains, and spam scores — useful for investigating suspicious emails
- **Delta sync**: incremental inbox monitoring returns only changes since your last check

Works with personal Outlook.com and Microsoft 365 accounts. MIT licensed, published on npm.

Install: `npm install -g @littlebearapps/outlook-assistant`

**Flair:** Built with Claude

---

## Completed: Formal Registries

### Official MCP Registry (registry.modelcontextprotocol.io) — PUBLISHED

**Status:** Published 2026-02-27 as `io.github.littlebearapps/outlook-assistant` v3.3.0. `server.json` in repo root, `mcpName` in `package.json`.

**API URL:** `https://registry.modelcontextprotocol.io/v0.1/servers/io.github.littlebearapps%2Foutlook-assistant/versions`

No web UI — the registry is API-only. Consumed by Claude Desktop, VS Code, PulseMCP, LobeHub, and other aggregators.

## Later: Additional Registries

### GitHub MCP Registry (github.com/mcp)

Backed by GitHub, feeds into VS Code/Copilot discovery. Submit via their process.

### Docker MCP Registry (github.com/docker/mcp-registry)

Submit via PR following their CONTRIBUTING guide.

---

## Verification Checklist

Last checked: 2026-02-27

- [x] TensorBlock/awesome-mcp-servers — **Merged** (2026-03-05)
- [x] Submit to Glama.ai (submitted 2026-02-27, pending review)
- [x] Official MCP Registry — **Published** (2026-02-27, v3.3.0)
- [ ] Update punkpeye PR #2742 with Glama link once listed
- [ ] Search each directory for "littlebearapps" or "outlook-assistant"
- [ ] Monitor GitHub star/fork count
- [ ] Check PulseMCP's "Est Visitors" metric once listed (auto-ingests from MCP Registry)
- [ ] Verify mcpservers.org indexes after punkpeye PR merge
