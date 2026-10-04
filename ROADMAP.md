# Roadmap

Active milestones for the Outlook Assistant MCP server. Items may shift or be cut as priorities evolve. The authoritative source is the [GitHub milestones page](https://github.com/littlebearapps/outlook-assistant/milestones); this document is a periodic snapshot.

For shipped work, see [`CHANGELOG.md`](CHANGELOG.md).

## v3.14.0 — Safety skill, hooks & MCP hardening (next)

This release gates the Claude directory and Cursor Marketplace submissions. The awesome-copilot listing (github/awesome-copilot#4455) will be moved to this tag. It has three layers: the server enforces, client hooks prompt, and the skill teaches. Every change must work across Claude Code and Desktop, GitHub Copilot (VS Code and CLI), Cursor, Codex/ChatGPT, Gemini CLI and local models.

**Status:** #270–#284 are all implemented and in review, unreleased: #270, #275–#277 and #281 in PR #294; #271–#274 and #278–#280 in PR #295; the plugin items #282–#284 in PR #296. The cross-client matrix ([`docs/cross-client-matrix.md`](docs/cross-client-matrix.md)) is started: Claude Code, GitHub Copilot CLI, Cursor CLI and Codex CLI have been checked; VS Code and the Cursor desktop app still need checking by hand.

**Server safety**
- **#270** A risk-class map (`read` / `reversible` / `outward` / `destructive` / `persistent`) that annotations, hooks, the skill and read-only mode are all derived from. New tools must be classified on purpose.
- **#271** MCP server `instructions`; Claude Code `requiresUserInteraction` on `send-email` and `create-event`; an `OUTLOOK_READ_ONLY` mode.
- **#272** Mail-tips warnings are surfaced instead of being sent inside the payload. Sends to external or out-of-office recipients need acknowledgement.
- **#273** A rule whose forward or redirect is blocked is refused, not downgraded; rate-limit fixes.
- **#274** `dryRun` previews for invites, cancel/decline/delete, auto-replies, and folder and contact deletes.
- **#280** `create-event` uses a Graph `transactionId`, so retries can't duplicate meetings.
- **#278** Less personal data in logs; verbose logging behind `OUTLOOK_DEBUG`.

**MCP protocol and tool quality**
- **#275** Every tool error sets `isError`. The stale "authenticate" tool references are fixed.
- **#276** Real JSON-RPC errors for unknown methods (needed for MCP 2026-07-28 clients); a correct `capabilities` shape; dead code removed.
- **#277** All four annotation hints set explicitly and accurately on every tool, plus a top-level `title`.
- **#279** Misleading result hints fixed; description hygiene.
- **#281** `server.json` metadata, an optional client ID, `smithery.yaml`, and a JSON Schema 2020-12 CI check.

**Plugin**
- **#282** The `using-outlook-assistant` skill: hard rules first, then a reference file per surface (email, calendar, rules and settings, contacts and folders, search and efficient use, personal vs M365, shared mailboxes, prompt injection, privacy).
- **#283** A safety hook: PreToolUse `ask` with plain-English reasons, a PostToolUse note that retrieved content is untrusted, and a `confirm_level` setting (`OUTLOOK_CONFIRM_LEVEL` where a client has no plugin settings). It runs in Claude Code, GitHub Copilot CLI (`com.github.copilot/hooks/hooks.json`) and Cursor (`.cursor-plugin/plugin.json` with `hooks/hooks-cursor.json`), which also fixes Cursor loading the v3.13.0 plugin with unexpanded `${user_config.*}` placeholders.
- **#284** Prompt-injection evals (with and without the skill) and a cross-client verification matrix.

**Follow-ups from this work** (no issues yet)
- Check the hook and skill by hand in VS Code with Copilot (Local agent). It reads the Copilot hook file, but so far that's known only from VS Code's source.
- Check the Cursor desktop app; only Cursor CLI has been verified.
- Cursor shows its own generic "Run this MCP tool?" prompt instead of the hook's reason, and an `Mcp(...)` allow rule or `--force` skips it. Revisit if Cursor starts showing hook reasons; until then the docs warn against allowlisting Outlook's send, rule and delete tools.
- Fill in the rest of the cross-client matrix: Claude Desktop, Gemini CLI, MCP Inspector and a local model.
- Tool descriptions that the docs sweep found out of step with the code:
  - `folders`: `sourceFolder` says it defaults to the inbox, but `move` ignores it.
  - `apply-category`: says it uses Graph `$batch`, but it sends one request per message.
  - `folders` `stats`: its hint names a `list-emails-delta` tool that doesn't exist.
  - `export` `format`: the description lists fewer batch formats than the code accepts.

## v3.15.0 — Structured outputs & paging

- **#285** `outputSchema` + `structuredContent` on all tools. Each half (structured data and text) must stand alone, because clients surface them differently.
- **#286** Real cursor pagination for `search-emails`, `list-events` and `access-shared-mailbox`.
- **#287** Progress notifications and cancellation for long exports and scans.
- **#288** Input validation gaps (nested `oneOf`, formats, ranges, per-action required parameters).
- **#289** Consistent parameter naming, with alias deprecation.
- **#290** Supply-chain hardening (image digests, SBOM, OpenSSF Scorecard).
- **#93** / **#243** Tool description audit: each description at most 1,024 characters (VS Code truncates there; a test enforces this since #279), and contradictions with actual behaviour fixed.

## v4.0.0 — MCP 2026-07-28 & server-side confirmation (breaking)

- **#291** Migrate to MCP TypeScript SDK v2 / protocol 2026-07-28 (`server/discover`, stateless requests), with URL-mode elicitation for device-code sign-in.
- **#269** Server-side confirmation for sends and destructive actions (two-phase confirm or MCP elicitation), enforced in every client.
- **#292** Split mixed read/write tools, and trim the tool count.

## Fix queue — next patch releases

Correctness bugs from the September 2026 Graph API audit and the v3.12.0 and
v3.12.1 release reviews. They ship in patch releases as fixes accumulate, rather
than one release per fix. The highest-impact ones come first.

- **#261** `search-emails` `query` sends `$orderby` with `$search`, which Graph rejects (`SearchWithOrderBy`), so the search falls back
- **#262** delta sync labels continuation pages of an initial sync as incremental and counts them as Created/Updated
- **#263** search-driven `export` wraps `from:`/`subject:` in one quoted phrase, so the field scopes are ignored
- **#239** `list-events` misses upcoming occurrences of recurring meetings (move to `calendarView`)
- **#245** `update-email` and `apply-category` claim `$batch` but run sequential PATCHes (v3.12.1 corrected the `update-email` description; the code is still sequential)
- **#240** `find-meeting-rooms` fallback calls the beta-only `findRooms` on v1.0
- **#250** `manage-contact` folder param is unusable
- **#258** leftovers from the post-3.12.0 hardening: request `Place.Read.All`
  for room lookup (with #240) and non-ASCII shared-mailbox addresses (log
  redaction moves to #278 in v3.14.0)
- **#264** (performance) `eml`/`mbox` conversation export fetches MIME one
  message at a time, up to 1000 sequential requests

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

## v3.16.0+ — New Graph APIs & Platform Maturity

Larger surface-area additions and platform hardening. v3.14.0 and v3.15.0 are
taken by the safety and MCP-quality work above, so these carry forward
(renamed from "v3.13.0+").

- **#147** Publisher-verified shared multi-tenant app (one-click setup for read-only scopes)
- **#133** MCP OAuth 2.1 / PKCE auth flow
- **#132** Copilot Meeting Insights (AI meeting notes and action items)
- **#131** Prepare for `Mail-Advanced.ReadWrite` breaking change (Microsoft Graph deprecation, Dec 2026)
- **#130** Places API expansion (workspace booking, check-in)
- **#129** Reference attachments (OneDrive/SharePoint file links — file-by-link instead of inline upload)
- **#128** Message Trace API for email delivery tracking

## Recently shipped

- **v3.13.0** (Oct 2026) — **Marketplace plugins**. A plugin bundle
  (`plugins/outlook-assistant/`) for Claude Code (installable now via
  `claude plugin marketplace add littlebearapps/outlook-assistant`) and, in
  the Agent Plugins format, GitHub Copilot and Cursor. The Azure client ID can
  be given at sign-in (`auth action=authenticate clientId=…`, saved locally)
  for clients that can't set environment variables. The client secret is
  documented as browser-flow only. Token-storage logs moved off stdout.
- **v3.12.1** (Oct 2026) — **Graph reliability and correctness fixes**. Graph
  requests retry throttling (`429`, and `503`/`504` for non-POST) with a
  request inactivity timeout and at most 4 requests in flight (#244); delta
  sync pages through the whole folder instead of stopping at `maxResults`
  (#254); `draft` update/send/delete refuse anything that isn't a draft (#246);
  `manage-rules` resolves nested folder paths (#248); flag dates honour `Z` and
  offsets (#247); `manage-event` keeps attendee types on update and no longer
  sends "via API" text (#242, #249); quoted `$search` phrases are escaped
  (#251); conversation read and export work on personal accounts; conversation
  export no longer overwrites files (#258).
- **v3.12.0** (Oct 2026) — **shared mailboxes and calendar search**, two
  community contributions. Opt-in shared-mailbox read and organise support
  (#228, by @DiasonD): a `sharedMailbox` parameter (alias `email`) on
  `search-emails`, `read-email`, `attachments`, `update-email`,
  `apply-category`, `export` and `folders`, plus `folderId`, `listFolders` and
  custom/nested folder names on `access-shared-mailbox`. It's off unless you set
  `OUTLOOK_SHARED_MAILBOX` (`read` or `true`), work/school accounts only, and
  sending from a shared mailbox stays unsupported. `list-events` gains
  `startAfter`, `startBefore` and `subject` filters for past, current and named
  events (#193, by @taranasus). Token refresh now requests the granted scopes
  plus `offline_access` (#241). Two security fixes: resource paths reject `.`
  and `..` segments, and `export` writes are confined to the output directory.
- **v3.11.2** (Sep 2026) — **security release**. Attachment downloads could be
  written outside `outputDir` via a sender-chosen filename
  ([GHSA-755c-c45g-69rv](https://github.com/littlebearapps/outlook-assistant/security/advisories/GHSA-755c-c45g-69rv)),
  and a caller-supplied `deltaToken` could send the access token to another host
  ([GHSA-mqfm-wfjq-jxq2](https://github.com/littlebearapps/outlook-assistant/security/advisories/GHSA-mqfm-wfjq-jxq2)).
  Also clears the open CodeQL alerts (HTML-to-text double decoding) and brings
  `npm audit` to 0.
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
