# Roadmap

Active milestones for the Outlook Assistant MCP server. Items may shift or be cut as priorities evolve. The authoritative source is the [GitHub milestones page](https://github.com/littlebearapps/outlook-assistant/milestones); this document is a periodic snapshot (last synced 2026-10-07, with v3.14.1 live). Issues are listed under their current titles.

For shipped work, see [`CHANGELOG.md`](CHANGELOG.md).

## v3.14.2 — Fix queue

The next patch after v3.14.1: user-facing bug fixes that are small and safe to ship alone.

- **#261** fix(search): query search sends $orderby with $search, so Graph rejects it (SearchWithOrderBy) and falls back
- **#263** fix(export): search export wraps from:/subject: in one quoted phrase, so field scopes are ignored
- **#240** fix(calendar): find-meeting-rooms fallback calls beta-only findRooms on v1.0 and misreports M365 users as personal
- **#320** fix(docker): image fails at start because the Dockerfile omits server.js, tools.js and request-handler.js
- **#321** chore(deps): clear critical proxy-addr advisory (GHSA-jqcg-44mw-7w3h) before the CI audit gate fails
- **#322** fix(delta): minimal verbosity lists no message IDs, so callers cannot act on changes
- **#323** fix(calendar): update preview undercounts notified attendees; rule reorder hides a failed follow-up listing
- **#328** search-emails: dotless domain label in `from` matches display name only, and zero-results guidance falsely says nothing in the mailbox matches
- **#329** search-emails: raw searchExpression silently ignores receivedAfter/receivedBefore, and the pagination footer tells callers to use them
- **#131** docs: confirm Mail-Advanced.ReadWrite enforcement (31 Dec 2026) doesn't affect Outlook Assistant — a troubleshooting note, no code change; due before Microsoft's 31 December 2026 deadline.
- **#305** question(settings): scheduled auto-replies set via Graph may not fire on personal accounts — likely docs and success-message wording after a manual re-test.

**Repo-only** (no npm release needed; they land before v3.14.2 so the release exercises them):

- **#319** ci(release): notify-website hid 401s as green; harden curl, auto-tag diff and prerelease publishing
- **#119** Add CITATION.cff + README cross-link to product page

## v3.15.0 — Structured outputs, paging & Hermes

Machine-readable results and real paging, Hermes Agent support, and the v3.14.0 follow-ups. Verified across the cross-client matrix ([`docs/cross-client-matrix.md`](docs/cross-client-matrix.md)).

- **#285** feat: outputSchema + structuredContent on all tools — the structured and text halves must each stand alone, because clients surface them differently.
- **#239** fix(calendar): list-events misses upcoming occurrences of recurring meetings — moves `list-events` to `calendarView`.
- **#286** feat: real cursor pagination for search-emails, list-events and access-shared-mailbox — depends on #261 (v3.14.2) and #239.
- **#264** perf(conversations): eml/mbox conversation export downloads MIME sequentially (up to 1000 requests) — bounded parallel downloads.
- **#288** fix: input validation gaps
- **#289** chore: parameter naming consistency and alias deprecation — deprecated aliases keep working until v4.0.0.
- **#243** fix(docs): tool descriptions contradict implemented behaviour — adds a description↔schema test.
- **#93** docs: audit and improve all tool descriptions — umbrella issue; closes once #243's test lands.
- **#309** feat(plugin): Hermes Agent support, stage 1: scanner-safe skill text and plugin-catalog listing
- **#310** feat(plugin): Hermes Agent support, stage 2: native approval guard plugin (outlook-assistant-guard)
- **#324** test(evals): skill-evals grading can pass vacuously; sync-version --check misses a missing metadata.version — fixed before the Hermes work relies on the evals.
- **#299** v3.14.0 follow-ups: hook prompt review and manual client checks — still open: a focused review of the hook's prompt text against the server's argument handling, and hand checks in VS Code with Copilot (Local agent), the Cursor desktop app, Claude Desktop, Gemini CLI, MCP Inspector and a local model.
- **#290** ci: supply-chain hardening (image digests, SBOM, OpenSSF Scorecard)

## v3.16.0 — Calendar, tasks & contacts

The next feature minor after v3.15.0. New scopes are opt-in and reported by `auth action=about`; nothing changes for existing sign-ins.

- **#125** feat: recurring calendar events (create-event recurrence support) — with a series guard on `manage-event`; the read side lands in v3.15.0 via #239.
- **#127** feat: contact structured email fields (primary/secondary/tertiary)
- **#250** fix(contacts): manage-contact folder param is unusable (no way to list contact folders)
- **#89** feat: add manage-tasks tool for Microsoft To Do — behind an opt-in scope.
- **#117** feat: improve search-emails experience for Sent Items and non-inbox folders
- **#245** perf(email): use $batch for bulk flag/read/category updates

## v4.0.0 — MCP 2026-07-28 & server-side confirmation

Breaking. SDK v1.x gets fixes until at least late January 2027.

- **#291** feat!: migrate to MCP TS SDK v2 / protocol 2026-07-28 — stateless requests, `server/discover`, multi-round-trip requests and URL-mode elicitation for device-code sign-in.
- **#325** chore!: require Node 22+ and test on Node 24 — Node 18 and 20 are end of life; Node 24 joins the CI matrix earlier, repo-only.
- **#287** feat: progress notifications and cancellation for long operations — builds on #291 (the new handler context).
- **#269** feat(safety): server-side confirmation for sends and destructive actions (two-phase confirm / MCP elicitation) — driven by the risk-class map and enforced in every client; builds on #291.
- **#292** refactor!: split mixed read/write tools and trim the tool count — also removes the aliases deprecated in v3.15.0 (#289).

## v4.1.0+ — New Graph surfaces & auth options

Later backlog, after the v4.0.0 SDK move and tool split. Larger or Microsoft 365-only additions, roughly by audience size.

- **#126** feat: findMeetingTimes scheduling assistant — a `scheduling` tool absorbing `find-meeting-rooms`; work/school only.
- **#91** feat: extend search-people with org hierarchy — work/school only.
- **#129** feat: reference attachments (OneDrive/SharePoint file links)
- **#90** feat: add MCP prompts for email workflows — after the SDK v2 migration (#291).
- **#133** feat(auth): PKCE for the browser sign-in flow (no client secret)
- **#123** feat: client credentials (app-only) authentication to eliminate 90-day re-auth cliff — waits for server-side confirmation (#269); work/school only.
- **#130** feat: Places API expansion (workspace booking, check-in) — needs #240; work/school only.
- **#128** feat: Message Trace API for email delivery tracking — Exchange admins only.

## Recently shipped

- **v3.14.1** (Oct 2026) — **Live-test fixes** (milestone #9), from the
  2026-10-05 live test of all 22 tools on v3.14.0:
  - **A session limit of `0` now blocks the tool** instead of meaning "no
    limit" (#302); so does any value that isn't a whole number. Unset still
    means no limit. Blocked tools are named in the server `instructions`,
    `auth action=about` and the startup log. This is the one upgrade note.
  - `manage-rules` uses Graph's `hasAttachments` rule property, so rules
    with "has attachments" conditions no longer fail with a 400 (#300); an
    `export` `savePath` ending in `/` creates that folder (#301).
  - `manage-event` update dry runs say who would be emailed (#303);
    automatic-reply schedules show the UTC instant plus a labelled local time
    (#304); every page of an initial delta sync is labelled initial (#262).
  - Tool output wording and smaller gaps (#306, #307), and the small server
    fixes from the v3.14.0 docs sweep (#299).

- **v3.14.0** (Oct 2026) — **Safety skill, hooks & MCP hardening** (milestone
  #6). A risk-class map drives every tool's annotations and an
  `OUTLOOK_READ_ONLY` mode; the server sends `instructions` with hard rules;
  `dryRun` previews for invitations, meeting actions, automatic replies and
  folder and contact deletes, and `dryRun` is refused where there's no preview;
  mail tips can refuse a send; a rule with blocked forwarding is refused whole;
  `create-event` is retry-safe; quieter logs. The plugin gains the
  `using-outlook-assistant` skill and a safety hook for Claude Code, GitHub
  Copilot CLI and Cursor. Three advisories fixed (recipient allowlist, export
  file writes, dry runs).
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
