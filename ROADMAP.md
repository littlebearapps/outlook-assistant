# Roadmap

Active milestones for the Outlook Assistant MCP server. Items may shift or be cut as priorities evolve. The authoritative source is the [GitHub milestones page](https://github.com/littlebearapps/outlook-assistant/milestones); this document is a periodic snapshot.

For shipped work, see [`CHANGELOG.md`](CHANGELOG.md).

## v3.7.5 — Fixes & Polish

Carry-over polish, docs, and small enhancements deferred from earlier patch slots. The next patch after v3.7.4.

- **#93** docs: audit and improve all tool descriptions
- **#92** fix: set `openWorldHint` on tools reading external content (security annotation gap)
- **#72** Add integration test for token refresh flow (good first issue)
- **#69** Improve error message when client secret is wrong (good first issue)
- **#68** Add `--version` CLI flag (good first issue)

## v3.10.0 — New Graph APIs & Platform Maturity

Larger surface-area additions and platform hardening. Roughly Q3 2026.

- **#147** Publisher-verified shared multi-tenant app (one-click setup for read-only scopes)
- **#133** MCP OAuth 2.1 / PKCE auth flow
- **#132** Copilot Meeting Insights (AI meeting notes and action items)
- **#131** Prepare for `Mail-Advanced.ReadWrite` breaking change (Microsoft Graph deprecation, Dec 2026)
- **#130** Places API expansion (workspace booking, check-in)
- **#129** Reference attachments (OneDrive/SharePoint file links — file-by-link instead of inline upload)
- **#128** Message Trace API for email delivery tracking

## Recently shipped

- **v3.9.0** (July 2026) — Task Integration & Auth carry-over completed: Microsoft To Do `manage-tasks` (#89), client credentials app-only auth (#123), recurring calendar events (#125), `find-meeting-times` (#126), timezone-labelled event output (#118), search improvements (#117, #169), structured contact email fields (#127), org hierarchy lookup (#91), and four built-in MCP prompts (#90).
- **v3.8.0** (May 2026) — `manage-event update` action closing the modify-event competitive gap (#124, community PR #173 by @taranasus); `OUTLOOK_AUTH_AUDIENCE` env var fixing `AADSTS9002331` for personal-only Azure apps (community PR #174); `OUTLOOK_DEFAULT_TIMEZONE` env var overriding the hardcoded `Australia/Melbourne` default (community PR #175); README demo media now uses absolute URLs so it renders on npm (#171).
- **v3.7.4** (May 2026) — F-24 chokepoint catches JSON-stringified arrays from MCP transport (#168); `search-emails kqlQuery` no longer silently drops on Step 0 fall-through (V37-F-1 part of #169); F-17 `maxResults` alias completion in list mode.
- **v3.7.3** (May 2026) — E2E sweep fix-up. MCP boundary param coercion + validation, strict unknown-param rejection, param-name aliases across tools, file-output `outputDir` honoured, ID surfacing on creates, identity surface in `auth about`, safety-belt warnings.
- **v3.7.2** (Apr 2026) — Restart-safe device code auth: state persists to `~/.outlook-assistant-pending-auth.json` (mode 0o600); token refresh handles public clients correctly. (#143)
- **v3.7.1** (Mar 2026) — `searchMetadata` in `_meta` block lets agents detect when filters drop; client-side fallbacks for `to` and free-text `query` on personal accounts. (#138, #140)

See [`CHANGELOG.md`](CHANGELOG.md) for full release notes.
