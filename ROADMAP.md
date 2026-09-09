# Roadmap

Active milestones for the Outlook Assistant MCP server. Items may shift or be cut as priorities evolve. The authoritative source is the [GitHub milestones page](https://github.com/littlebearapps/outlook-assistant/milestones); this document is a periodic snapshot.

For shipped work, see [`CHANGELOG.md`](CHANGELOG.md).

## v3.11.2 — Tool description audit

The last item from the old `v3.7.5 — Fixes & Polish` slate. Everything else in
that milestone shipped in v3.11.0 (see "Recently shipped"); this one is held
back deliberately because it touches all 22 tool definitions plus the `llms.txt`
tool categories and the description column of
[`docs/quickrefs/tools-reference.md`](docs/quickrefs/tools-reference.md), and is
not worth half-doing inside a polish release.

- **#93** docs: audit and improve all tool descriptions

The `search-emails` and `searchExpression` descriptions were rewritten in
v3.10.0 and revised again in v3.11.1 (the `query` versus `searchExpression`
divergence and the `to` scan cap) — use them as the reference style.

> Renumbered from v3.11.1, which was taken by the search/export correctness
> release. #93 is documentation-only and was not worth blocking two critical
> defect fixes behind.

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

## v3.12.0+ — New Graph APIs & Platform Maturity

Larger surface-area additions and platform hardening. None of these shipped in
v3.10.0 (search correctness) or v3.11.0 (fixes & polish), so they carry forward
to the next feature slot.

- **#147** Publisher-verified shared multi-tenant app (one-click setup for read-only scopes)
- **#133** MCP OAuth 2.1 / PKCE auth flow
- **#132** Copilot Meeting Insights (AI meeting notes and action items)
- **#131** Prepare for `Mail-Advanced.ReadWrite` breaking change (Microsoft Graph deprecation, Dec 2026)
- **#130** Places API expansion (workspace booking, check-in)
- **#129** Reference attachments (OneDrive/SharePoint file links — file-by-link instead of inline upload)
- **#128** Message Trace API for email delivery tracking

## Recently shipped

- **v3.11.1** (Sep 2026) — **search and export correctness**. A search term
  combined with a date or boolean filter was silently dropped: the single-term
  rung built its predicate and then had it overwritten, so the request carried
  only the date window and the whole window came back reported as a filtered
  result (`filterApplied: true`, `droppedFilters: []`). Batch export named files
  `<date>_<subject>`, so a same-day reply chain overwrote itself on disk while
  the summary reported `Failed 0` — filenames now carry the time, collisions get
  a numeric suffix instead of clobbering, and a manifest maps each requested ID
  to the file actually written. A truncated local scan is now disclosed when it
  matched, not only when it returned nothing. Both critical defects returned
  HTTP 200 with well-formed output, so the new tests assert result sets rather
  than that the call succeeded.

- **v3.11.0** (Sep 2026) — **fixes & polish**, clearing the old v3.7.5 slate.
  `--version` / `--help` CLI flags: previously any argument was ignored and the
  process booted the MCP server and hung on stdin (#68). `AADSTS7000215` — the
  Secret ID versus Secret Value mistake, the most common setup failure — now
  explains itself instead of passing Microsoft's raw error through, via a single
  shared AADSTS hint table that the device-code path also reads so the two
  cannot drift (#69). The token-refresh round trip is covered end to end, disk
  through to the `Authorization` header on the next Graph call (#72). All 17
  development-dependency advisories cleared, including the critical
  `shell-quote` one; `npm audit` now reports zero at every severity, not just in
  the production scope. 37 suites / 937 tests.
- **v3.10.0** (Sep 2026) — **search correctness**, four bugs found by
  investigating a stale "`to:` search is broken" claim. Field-scoped
  `searchExpression` (`from:`, `to:`, `subject:`) is rejected outright by
  Graph on personal accounts; expressions built purely from `from:`, `to:` and
  `subject:` terms are now translated into the closest equivalent OData filters
  and retried, reported as `raw-kql-translated` (#217). Searches combining two filters no longer return the single-term
  superset when Graph rejects the combined filter — remaining terms are applied
  locally and `searchMetadata.droppedFilters` reports anything unhonoured
  (#229). Single quotes in `from`/`to` are OData-escaped, so `O'Brien` no
  longer produces a swallowed Graph 400, and filter values can no longer rewrite
  the query (#230). No-results guidance is derived from what was actually
  supplied and attempted, dropping a suggestion that had been false since
  v3.7.1 (#231). Also cleared the `npm audit` CI gate and added a weekly
  watchdog for it (#215). Validated with a live E2E sweep.
- **v3.9.1** (Aug 2026) — packaging hotfix: `request-handler.js` was missing
  from the published tarball, so every install from 3.8.2 through 3.9.0 failed
  at load with `Cannot find module './request-handler'` (#223).
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
