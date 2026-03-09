# Outlook Assistant — Directory Submission Tracker

Generated: 2026-03-05
Last updated: 2026-03-09 (promotion plan: new channels, GitHub optimisations, draft posts)

---

## Completed Submissions (Automated)

### Awesome Lists (PRs)

| # | Directory | PR URL | Status |
|---|-----------|--------|--------|
| 1 | punkpeye/awesome-mcp-servers (82k stars) | https://github.com/punkpeye/awesome-mcp-servers/pull/2742 | **Updated** — Glama link + new description pushed (2026-02-27), awaiting merge |
| 2 | appcypher/awesome-mcp-servers (5.2k stars) | https://github.com/appcypher/awesome-mcp-servers/pull/492 | Pending review (no response) |
| 3 | TensorBlock/awesome-mcp-servers (557 stars) | https://github.com/TensorBlock/awesome-mcp-servers/pull/136 | **Merged** (2026-03-05) — used old name `outlook-mcp`. Rename PR: [#149](https://github.com/TensorBlock/awesome-mcp-servers/pull/149) |
| 4 | YuzeHao2023/Awesome-MCP-Servers (1k stars) | https://github.com/YuzeHao2023/Awesome-MCP-Servers/pull/46 | Pending review (no response) |

### Directory Issues

| # | Directory | Issue URL | Status |
|---|-----------|-----------|--------|
| 5 | Cline MCP Marketplace | https://github.com/cline/mcp-marketplace/issues/792 | Pending review — title/body updated to `outlook-assistant` (2026-03-08) |
| 6 | mcp.so (via chatmcp/mcpso) | https://github.com/chatmcp/mcpso/issues/679 | Pending review — title/body updated to `outlook-assistant` (2026-03-08) |

### Not Submitted (PRs disabled)

| # | Directory | Reason |
|---|-----------|--------|
| — | wong2/awesome-mcp-servers (3.7k stars) | PRs from forks not allowed |

---

## Pending Submissions — Awesome Lists (PRs)

### Tier 1

| # | Directory | URL | Status |
|---|-----------|-----|--------|
| 7 | ever-works/awesome-mcp-servers | https://github.com/ever-works/awesome-mcp-servers | Not submitted |
| 8 | collabnix/awesome-mcp-servers | https://github.com/collabnix/awesome-mcp-servers | Not submitted |
| 9 | jim-schwoebel/awesome_ai_agents ("Email AI Agents" category) | https://github.com/jim-schwoebel/awesome_ai_agents | Not submitted |
| 10 | jqueryscript/awesome-claude-code | https://github.com/jqueryscript/awesome-claude-code | Not submitted |

### Tier 3

| # | Directory | URL | Status |
|---|-----------|-----|--------|
| 11 | rohitg00/awesome-devops-mcp-servers | https://github.com/rohitg00/awesome-devops-mcp-servers | Not submitted |
| 12 | ComposioHQ/awesome-claude-plugins | https://github.com/ComposioHQ/awesome-claude-plugins | Not submitted |
| 13 | ccplugins/awesome-claude-code-plugins | https://github.com/ccplugins/awesome-claude-code-plugins | Not submitted |
| 14 | heilcheng/awesome-agent-skills | https://github.com/heilcheng/awesome-agent-skills | Not submitted |
| 15 | MCPStar/awesome-dxt-mcp | https://github.com/MCPStar/awesome-dxt-mcp | Not submitted |

---

## Pending Submissions — Directories

### Tier 1

| # | Directory | URL | Effort | Status |
|---|-----------|-----|--------|--------|
| 16 | LobeHub MCP Marketplace | https://lobehub.com/mcp (Submit MCP button) | 15 min | Not submitted |
| 17 | Cursor Directory | https://cursor.directory/mcp (250k+ monthly Cursor users) | 15 min | Not submitted — check submission process |

### Tier 2

| # | Directory | URL | Effort | Status |
|---|-----------|-----|--------|--------|
| 18 | allMCPServers.com | https://allmcpservers.com | 15 min | Not submitted |
| 19 | MCPServe.com | https://mcpserve.com | 15 min | Not submitted |
| 20 | MCPfy.ai | https://mcpfy.ai | 15 min | Not submitted |
| 21 | mcpservers.com | https://mcpservers.com | 15 min | Not submitted |
| 22 | mcp-awesome.com | https://mcp-awesome.com | 15 min | Not submitted |
| 23 | Windsurf Directory | Check if exists | 15 min | Not submitted |
| 24 | Product Hunt | https://producthunt.com | 1 hr | Not submitted — MCP tools have gotten traction here |

---

## Manual Submissions Required

### Glama.ai — COMPLETE

**URL:** https://glama.ai/mcp/servers/littlebearapps/outlook-assistant

**Status:** Fully live. All checks passing. Dockerfile build passing (Node 22). Release v3.3.1 live. Badge in README. Server inspectable with all 20 tools discoverable.

**Completed:**
- Dockerfile build passing (husky fix: `"prepare": "husky || true"`) (2026-03-09)
- Release v3.3.1 created on Glama (2026-03-09)
- GitHub release v3.3.1 published (2026-03-09)
- Badge added to README and pushed to main (2026-03-09)
- Glama link added to punkpeye PR #2742 (2026-02-27)
- Description updated to user-focused copy on PR #2742 (2026-02-27)

**Remaining:** "Related Servers" section populates over time (community-driven).

### PulseMCP — Pending auto-ingest

**URL:** https://www.pulsemcp.com/submit

**Status:** PulseMCP ingests from the official MCP Registry daily and processes weekly. The old entry (`outlook-mcp`) was never picked up — likely because it was published under the old name. New entry `io.github.littlebearapps/outlook-assistant` v3.3.1 published to registry on 2026-02-27. Should appear on PulseMCP within a week. If not, email hello@pulsemcp.com.

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

## Completed: Formal Registries

### Official MCP Registry (registry.modelcontextprotocol.io) — PUBLISHED

**Status:** Published `io.github.littlebearapps/outlook-assistant` v3.3.1 (2026-02-27). Old entry `io.github.littlebearapps/outlook-mcp` v3.2.1 (2026-03-06) also exists but points to deprecated package/URL. `server.json` in repo root, `mcpName` in `package.json`.

**API URL:** `https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.littlebearapps/outlook-assistant`

No web UI — the registry is API-only. Consumed by Claude Desktop, VS Code, PulseMCP, LobeHub, and other aggregators. PulseMCP ingests daily and processes weekly.

## Pending: Additional Registries

### modelcontextprotocol/servers — Community server listing

**URL:** https://github.com/modelcontextprotocol/servers

Submit as a community server to the official MCP servers list. High impact — official listing.

**Status:** Not submitted

### microsoft/mcp — Microsoft MCP catalog

Submit to the Microsoft-endorsed MCP catalog. High impact — Microsoft endorsement.

**Status:** Not submitted

### GitHub MCP Registry (github.com/mcp)

Backed by GitHub, feeds into VS Code/Copilot discovery. Submit via their process.

**Status:** Not submitted

### Docker MCP Registry (github.com/docker/mcp-registry)

Submit via PR following their CONTRIBUTING guide.

**Status:** Not submitted

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

### Reddit r/selfhosted

**Title:** Self-hosted AI email management — MCP server connects your AI assistant to Outlook

**Body:**

Built an MCP server that gives AI assistants (Claude, Cursor, Windsurf) full access to your Outlook mailbox through the Microsoft Graph API. Runs locally — your tokens stay on your machine.

- 20 tools covering email, calendar, contacts, rules, categories, and settings
- Export emails to Markdown/EML/MBOX/JSON for archival
- Email forensics — DKIM, SPF, DMARC authentication analysis
- Delta sync for incremental inbox monitoring
- Safety controls: dry-run before sends, rate limiting, recipient allowlists

Self-hosted, open source (MIT), no cloud service dependency. You register your own Azure app and keep your own credentials.

GitHub: https://github.com/littlebearapps/outlook-assistant

---

### Reddit r/LocalLLaMA (500k+)

**Title:** MCP server for Outlook that works with any MCP-compatible LLM

**Body:**

Sharing [Outlook Assistant](https://github.com/littlebearapps/outlook-assistant) — an MCP server with 20 tools for Microsoft Outlook (email, calendar, contacts, rules, export, forensics).

While I built it primarily for Claude, it works with any MCP-compatible client. If your local LLM setup supports MCP tool calling, you can use it to manage Outlook from your AI assistant.

Works with both personal Outlook.com and Microsoft 365 accounts. MIT licensed, runs locally.

---

### Reddit r/MicrosoftOutlook + r/Office365 + r/sysadmin

**Title:** Open-source tool: connect AI assistants to Outlook via Microsoft Graph API

**Body:**

Built [Outlook Assistant](https://github.com/littlebearapps/outlook-assistant), an open-source MCP server that connects AI assistants to Outlook.

Useful for:
- **Sysadmins**: Investigate email headers (DKIM, SPF, DMARC, delivery chains) through AI conversation
- **Power users**: Set up inbox rules, manage categories, configure auto-replies conversationally
- **Teams**: Access shared mailboxes, find meeting rooms by building/floor/capacity
- **Compliance**: Export emails to EML/MBOX/JSON for archival or analysis

Uses delegated Microsoft Graph API permissions — runs locally with your own Azure app registration. Works with personal Outlook.com and Microsoft 365.

GitHub: https://github.com/littlebearapps/outlook-assistant

---

### Discord — MCP Server (#showcase, 11.5k members)

**Post:**

**Outlook Assistant** — MCP server with 20 tools for Microsoft Outlook

Just shipped v3.3.1 with full email, calendar, contacts, and inbox management via Microsoft Graph API.

Highlights:
- 20 consolidated tools (down from 55) for better token efficiency
- Safety controls: dry-run email preview, rate limiting, recipient allowlists
- MCP annotations on every tool for auto-approval of safe reads
- Progressive search — adapts to personal vs work account API limitations
- Email forensics: DKIM, SPF, DMARC, delivery chains in one call
- Delta sync for incremental inbox monitoring
- Works with Outlook.com + Microsoft 365

`npm install -g @littlebearapps/outlook-assistant`

GitHub: https://github.com/littlebearapps/outlook-assistant

---

### Discord — Anthropic/Claude (#projects/showcase, 66k members)

**Post:**

**Outlook Assistant** — gave Claude full access to my Outlook inbox

Built an MCP server with 20 tools for email, calendar, contacts, and settings via Microsoft Graph API. Claude can now search my inbox, read threads, draft replies, schedule meetings, and manage my mailbox — all from the conversation.

Design decisions I'm proud of:
- Consolidated 55 tools down to 20 for token efficiency (~64% overhead reduction)
- Every tool has MCP annotations so Claude Code auto-approves reads
- Send-email has dry-run preview, rate limiting, and recipient allowlists
- Progressive search handles personal vs work account differences transparently
- Built-in email forensics for phishing investigation

Works with Claude Desktop, Claude Code, Cursor, and Windsurf.

`npm install -g @littlebearapps/outlook-assistant`
GitHub: https://github.com/littlebearapps/outlook-assistant

---

### Hacker News (Show HN)

**Title:** Show HN: Outlook Assistant — 20-tool MCP server for Outlook email, calendar, contacts

**Post timing:** ~9am ET, Tuesday-Thursday for best visibility

**Body/URL:** https://github.com/littlebearapps/outlook-assistant

**Comment to post immediately after:**

Hi HN — I built an MCP server that connects AI assistants (Claude, Cursor, Windsurf) to Microsoft Outlook via the Graph API.

The interesting design challenge was balancing power with safety:

- **Tool consolidation**: AI tool selection degrades past ~40 tools, so I consolidated 55 tools down to 20 using the STRAP pattern (Single Tool, Resource, Action Pattern). This cut per-turn token overhead by ~64%.

- **Progressive search**: Microsoft's $search API behaves differently on personal vs work accounts. Instead of failing, the server cascades through up to 4 search strategies (KQL → OData → boolean filters → recent listing) to find results regardless of account type.

- **Safety controls**: Email access from AI is inherently risky. The send-email tool has dry-run preview, session rate limiting, and recipient allowlists. Every tool carries MCP annotations so clients know which operations are safe to auto-approve.

- **Email forensics**: Full header analysis (DKIM, SPF, DMARC, delivery chain, spam scores) as a first-class feature. Useful for phishing investigation and compliance.

Uses delegated (not application) Graph API permissions — runs locally with your own Azure app registration. MIT licensed, published on npm.

Happy to discuss the MCP protocol design decisions or Graph API quirks.

---

### Dev.to / Hashnode Article

**Title:** How I Built an MCP Server for Microsoft Outlook (and What I Learned About AI-Safe Email Access)

**Tags:** mcp, ai, outlook, microsoft, javascript

**Outline:**

1. **Introduction** — What MCP is, why Outlook needs an MCP server
2. **The tool consolidation problem** — Why 55 tools don't work (AI selection degrades past 40), the STRAP pattern, 64% token savings
3. **Progressive search** — How Microsoft's search API differs between account types, the cascade strategy
4. **Safety-first design** — MCP annotations, dry-run mode, rate limiting, recipient allowlists, the "defence in depth" philosophy
5. **Email forensics** — Building DKIM/SPF/DMARC analysis into an MCP tool, real-world phishing investigation workflow
6. **Delta sync for agent workflows** — Incremental inbox monitoring, watch tokens, how agents can poll for new mail
7. **Lessons learned** — Graph API quirks, OAuth pitfalls (Secret ID vs Value), personal vs work account differences
8. **Getting started** — Quick install, Azure setup, first query

**Call to action:** Star on GitHub, install from npm, file feature requests

---

### Twitter/X Launch Thread

**Thread:**

1/ Just shipped Outlook Assistant v3.3.1 — an MCP server with 20 tools for Microsoft Outlook

Your AI assistant can now search, read, send emails, manage calendar, contacts, inbox rules, and more — all from the conversation.

GitHub: https://github.com/littlebearapps/outlook-assistant

2/ Design highlight: consolidated 55 tools down to 20

AI tool selection degrades past ~40 tools. The STRAP pattern (Single Tool, Resource, Action Pattern) cut token overhead by 64%.

3/ Safety matters when AI touches your inbox:
- Dry-run email preview before sending
- Session rate limiting
- Recipient allowlists
- MCP annotations for auto-approval of safe reads

4/ Progressive search handles a quirk most Outlook integrations ignore:

Microsoft's $search API works differently on personal vs work accounts. Instead of failing silently, the server cascades through 4 search strategies automatically.

5/ Built-in email forensics:
One tool call → DKIM, SPF, DMARC, delivery chains, spam scores

Great for phishing investigation and compliance review.

6/ Works with:
- Claude Desktop + Claude Code
- Cursor
- Windsurf
- Any MCP-compatible client

Install: `npm install -g @littlebearapps/outlook-assistant`

@AnthropicAI #MCP #ModelContextProtocol

---

### LinkedIn Post

**Post:**

I've been building open-source developer tools for AI-assisted email management, and just shipped a major milestone: Outlook Assistant v3.3.1.

It's an MCP (Model Context Protocol) server that gives AI assistants — Claude, Cursor, Windsurf — full access to Microsoft Outlook. Search inbox, read threads, send emails, schedule meetings, manage contacts, create rules, export for compliance — 20 tools total.

The interesting engineering challenge was designing for safety when AI touches your inbox. Every tool carries machine-readable annotations so the AI client knows which operations are safe to auto-approve. Email sends have dry-run preview, rate limiting, and recipient allowlists.

Works with both personal Outlook.com and Microsoft 365 accounts. MIT licensed, published on npm.

If you work with Microsoft 365 and use AI coding assistants, I'd love your feedback:
https://github.com/littlebearapps/outlook-assistant

#MCP #AI #Microsoft365 #OpenSource #DeveloperTools

---

## GitHub Optimisations

### Completed (2026-03-09)

- [x] **GitHub Discussions** enabled
- [x] **Topic swap**: Dropped `mcp-servers` + `oauth` → added `automation` + `productivity` (20/20)
- [x] **`.github/FUNDING.yml`** created — adds Sponsor button
- [x] **Badges** added to README: GitHub stars, last commit, CodeQL, open issues
- [x] **SEO H1 heading** added to README (text `<h1>` not just SVG logo)
- [x] **IDE config examples** added to README: Claude Desktop, Claude Code, Cursor, Windsurf
- [x] **"Good first issue" labels** — 5 issues created (#68-#72) with `good first issue` + `help wanted` labels

### Pending

- [ ] **Custom social preview image** (1280x640px) — upload via GitHub repo Settings → Social preview
- [ ] **Pin outlook-assistant** on org profile — go to github.com/littlebearapps and pin the repo
- [ ] **Create org profile README** (`littlebearapps/.github/profile/README.md`) — creates the org landing page
- [ ] **Submit to modelcontextprotocol/servers** as community server
- [ ] **Submit to microsoft/mcp** catalog
- [ ] **Propose "MCP Servers" collection** to github/explore
- [ ] **GitHub Pages docs site** (Starlight/Docusaurus) — SEO + professionalism
- [ ] **Follow up on pending PRs** (punkpeye #2742 is highest value — 82k star repo)
- [ ] **Public roadmap** via GitHub Projects v2

### Good First Issues Created

| # | Issue | Labels |
|---|-------|--------|
| #68 | Add `--version` CLI flag | good first issue, help wanted, enhancement |
| #69 | Improve error message when client secret is wrong | good first issue, help wanted, enhancement |
| #70 | Add JSDoc comments to exported functions in `utils/graph-api.js` | good first issue, help wanted, documentation |
| #71 | Support CSV export format | good first issue, help wanted, enhancement |
| #72 | Add integration test for token refresh flow | good first issue, help wanted, enhancement |

These auto-surface on goodfirstissue.dev and GitHub's "Contribute" tab.

---

## Coordinated Launch Strategy

For maximum trending potential, coordinate posts within a 24-48 hour window:

| Timing | Action |
|--------|--------|
| **Day 1 morning** | Reddit r/mcp + r/ClaudeAI (drafts ready above) |
| **Day 1 afternoon** | MCP Discord + Claude Discord + Twitter/X thread |
| **Day 1 evening** | Show HN post |
| **Day 2** | LinkedIn + Dev.to article |
| **Day 3+** | Remaining Reddit subs (r/selfhosted, r/LocalLLaMA, r/sysadmin), forum posts, directory submissions |

The burst of stars from coordinated promotion can trigger GitHub Trending (JavaScript), which creates a self-reinforcing loop.

---

## Verification Checklist

Last checked: 2026-03-09

### Completed
- [x] TensorBlock/awesome-mcp-servers — **Merged** (2026-03-05), rename PR [#149](https://github.com/TensorBlock/awesome-mcp-servers/pull/149) submitted
- [x] Submit to Glama.ai — **Live** (2026-03-09). Dockerfile build passing, release v3.3.1 created, badge in README
- [x] Official MCP Registry — **Published** `io.github.littlebearapps/outlook-assistant` v3.3.1 (2026-02-27). Old entry `outlook-mcp` v3.2.1 also exists
- [x] Update cline/mcp-marketplace #792 — title/body renamed to `outlook-assistant` (2026-03-08)
- [x] Update chatmcp/mcpso #679 — title/body renamed to `outlook-assistant` (2026-03-08)
- [x] GitHub repo homepage URL — updated to `littlebearapps.com/builds/outlook-assistant` (2026-03-08)
- [x] Glama server live as `outlook-assistant` with passing build + release
- [x] Update punkpeye PR #2742 with Glama link + new description (2026-02-27)
- [x] Submit to PulseMCP — published to official MCP Registry (2026-02-27); PulseMCP ingests daily, should appear within a week
- [x] GitHub Discussions enabled (2026-03-09)
- [x] Topics swapped: `mcp-servers` + `oauth` → `automation` + `productivity` (2026-03-09)
- [x] FUNDING.yml created (2026-03-09)
- [x] README badges: stars, last commit, CodeQL, open issues (2026-03-09)
- [x] README SEO H1 heading + IDE config examples (2026-03-09)
- [x] Good first issues #68-#72 created (2026-03-09)

### Pending
- [ ] Monitor GitHub star/fork count
- [ ] Verify mcpservers.org indexes after punkpeye PR merge
- [ ] Submit to new awesome lists (#7-#15)
- [ ] Submit to new directories (#16-#24)
- [ ] Post to Discord (MCP + Claude)
- [ ] Post to Reddit (r/mcp, r/ClaudeAI, r/selfhosted, r/LocalLLaMA, r/sysadmin)
- [ ] Post Show HN
- [ ] Publish Dev.to article
- [ ] Post Twitter/X thread
- [ ] Post LinkedIn
- [ ] Submit to modelcontextprotocol/servers
- [ ] Submit to microsoft/mcp
- [ ] Custom social preview image
- [ ] Pin repo on org profile
- [ ] Create org profile README
- [ ] PulseMCP follow-up if not auto-ingested by next week
