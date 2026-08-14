# Roadmap

Active milestones for the Outlook Assistant MCP server. Items may shift or be cut as priorities evolve. The authoritative source is the [GitHub milestones page](https://github.com/littlebearapps/outlook-assistant/milestones); this document is a periodic snapshot.

For shipped work, see [`CHANGELOG.md`](CHANGELOG.md).

## v3.7.5 — Fixes & Polish

Carry-over polish, docs, and small enhancements deferred from earlier patch slots. The next patch after v3.7.4.

- **#93** docs: audit and improve all tool descriptions
- **#72** Add integration test for token refresh flow (good first issue)
- **#69** Improve error message when client secret is wrong (good first issue)
- **#68** Add `--version` CLI flag (good first issue)

## v3.8.x — Task Integration & Auth (carry-over)

v3.8.0 shipped the `manage-event update` action (#124) and two community-contributed config overrides — see "Recently shipped" below. The items in this section are the rest of the original v3.8.0 slate, carrying forward into v3.8.1 (or renumbered if scope shifts).

### Highlights

- **#89** `manage-tasks` tool for Microsoft To Do — list, create, update, complete tasks (10th tool module)
- **#123** Client credentials (app-only) authentication — eliminates the 90-day re-auth cliff for headless deployments
- **#125** Recurring calendar events — `create-event` recurrence rules

### Search & people

- **#117** Improve `search-emails` experience for Sent Items and non-inbox folders
- **#127** Contact structured email fields (primary/secondary/tertiary)
- **#91** Extend `search-people` with org hierarchy lookup

### Calendar & meetings

- **#126** `findMeetingTimes` scheduling assistant

### Workflow

- **#90** Add MCP prompts for common email workflows

## v3.10.0+ — New Graph APIs & Platform Maturity

Larger surface-area additions and platform hardening. (v3.9.0 shipped nested
folder addressing and cross-folder search reliability — see "Recently shipped"
— so these larger items carry forward to the next feature slot.)

- **Shared/delegated mailbox completeness** — `sharedMailbox` (alias `email`) scoping across folder enumeration/resolution, reads, writes, and exports, plus automatic `.Shared` scope fallback for personal accounts. Fixes `404 ErrorInvalidMailboxItemId` when opening or writing shared-mailbox items by ID.
- **#147** Publisher-verified shared multi-tenant app (one-click setup for read-only scopes)
- **#133** MCP OAuth 2.1 / PKCE auth flow
- **#132** Copilot Meeting Insights (AI meeting notes and action items)
- **#131** Prepare for `Mail-Advanced.ReadWrite` breaking change (Microsoft Graph deprecation, Dec 2026)
- **#130** Places API expansion (workspace booking, check-in)
- **#129** Reference attachments (OneDrive/SharePoint file links — file-by-link instead of inline upload)
- **#128** Message Trace API for email delivery tracking

## Recently shipped

- **v3.9.0** (Jul 2026) — **nested folder addressing** (#216): the `folders`
  tool resolves folders by slash-path (`Triage/Delete`), explicit ID, or bare
  name (ambiguous names return candidate paths + IDs); `folders list` surfaces
  each folder's full path and ID; `search-emails folder=` resolves nested paths
  too. **Cross-folder search** (#169): `searchAllFolders=true` now returns a
  superset of inbox results (scan depth decoupled from result count), multi-word
  queries match non-contiguous subject words, the scope is labelled "all
  folders", and `kqlQuery` is renamed to `searchExpression` (deprecated alias
  kept). Validated with a live E2E sweep.
- **v3.8.3** (Jul 2026) — security + calendar patch: cleared the two HIGH
  transitive advisories (`hono`, `fast-uri`) that blocked the `npm audit`
  CI gate via in-range `overrides` (#215); `openWorldHint: true` on tools that
  surface external content — `search-emails`, `read-email`, `search-people`,
  `access-shared-mailbox`, `attachments`, `export` (#92); `list-events` returns
  canonical UTC ISO-8601 times plus a labelled local rendering (#118).
- **v3.8.2** (May 2026) — fixed a silent-failure bug where `auth` device-code
  authentication (and any tool error) returned empty output instead of a
  readable message in remote connector sessions; all `tools/call` errors now
  surface as visible `isError` content, device-code step 1 returns actionable
  hints (audience mismatch, public-client flows, blocked egress), and
  device-code HTTPS requests time out after 15s (#213).
- **v3.8.0** (May 2026) — `manage-event update` action closing the modify-event competitive gap (#124, community PR #173 by @taranasus); `OUTLOOK_AUTH_AUDIENCE` env var fixing `AADSTS9002331` for personal-only Azure apps (community PR #174); `OUTLOOK_DEFAULT_TIMEZONE` env var overriding the hardcoded `Australia/Melbourne` default (community PR #175); README demo media now uses absolute URLs so it renders on npm (#171).
- **v3.7.4** (May 2026) — F-24 chokepoint catches JSON-stringified arrays from MCP transport (#168); `search-emails kqlQuery` no longer silently drops on Step 0 fall-through (V37-F-1 part of #169); F-17 `maxResults` alias completion in list mode.
- **v3.7.3** (May 2026) — E2E sweep fix-up. MCP boundary param coercion + validation, strict unknown-param rejection, param-name aliases across tools, file-output `outputDir` honoured, ID surfacing on creates, identity surface in `auth about`, safety-belt warnings.
- **v3.7.2** (Apr 2026) — Restart-safe device code auth: state persists to `~/.outlook-assistant-pending-auth.json` (mode 0o600); token refresh handles public clients correctly. (#143)
- **v3.7.1** (Mar 2026) — `searchMetadata` in `_meta` block lets agents detect when filters drop; client-side fallbacks for `to` and free-text `query` on personal accounts. (#138, #140)

See [`CHANGELOG.md`](CHANGELOG.md) for full release notes.
