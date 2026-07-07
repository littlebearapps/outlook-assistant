# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Added the configured timezone label to `list-events` start and end times so
  converted calendar output is no longer ambiguous. (#118)

## [3.8.2] - 2026-07-08

### Added

- Added `--version` and `-v` CLI flags that print the package version and exit
  without starting the MCP stdio server. (#68)

### Fixed

- Improved `AADSTS7000215` authentication errors so operators are told to use
  the Azure client secret **Value**, not the Secret ID. (#69)
- Set `openWorldHint: true` on tools that return external-content surfaces
  (`search-emails`, `read-email`, `search-people`, and
  `access-shared-mailbox`) and pinned annotations for all 22 tools. (#92)

### Documentation

- Documented the single-tenant Azure app fix for `AADSTS50059`: set
  `OUTLOOK_AUTH_AUDIENCE` to the app registration's Directory (tenant) ID
  instead of using the default `common` audience.
- Clarified that the default device-code flow does not require a client
  secret when Azure public client flows are enabled, and updated getting-started
  examples to include send-safety environment variables.

### Tests

- Added integration coverage for the Graph 401 → token refresh → retry flow,
  including persistence of refreshed tokens to an isolated token file. (#72)

## [3.8.1] - 2026-05

Patch release driven by a glama.ai / safemcp.info scoring audit. Lifts the
glama "Tool Definition Quality" dimension from B (avg 3.8/5 across 22 tools)
toward A by rewriting every tool description with usage guidance, return-value
shape, and side-effect notes. Also fixes two annotation correctness issues
surfaced by the audit, tightens `.gitignore`, and renames the FAQ source file
for a cleaner public URL.

### Fixed

- **`manage-contact` destructive-hint correctness** — flipped tool-level
  `destructiveHint` from `false` to `true` so MCP clients prompt for
  confirmation. The tool exposes a `delete` action; the previous annotation
  was misleading. Flagged by the glama.ai 2026-05-26 tool-definition audit
  ("destructive hint contradiction").
- **`folders` description clarity** — kept the conservative tool-level
  `destructiveHint: true` (covers the `delete` sub-action) but rewrote the
  description to explicitly call out that `list` and `stats` sub-actions are
  read-only despite the annotation. Closes the gap glama flagged as
  "missing mode-specific details".

### Changed

- **Tool descriptions — all 22 tools** — rewrote the top-level `description`
  field on every tool in `auth/`, `calendar/`, `categories/`, `contacts/`,
  `email/`, `folder/`, `rules/`, `settings/`, and `advanced/` to follow a
  `purpose → when-to-use → returns → side-effects/pagination/errors`
  template, lifting the glama.ai per-tool average from 3.8/5 toward 4.4+/5.
  Source prose lifted from `docs/quickrefs/tools-reference.md` (the
  single-source-of-truth quick reference) — no behavioural changes, no
  schema changes, no input/output changes. Pure metadata.
- **`docs/faq/index.md` → `docs/faq/faq.md`** — renamed the FAQ source file
  for a cleaner public URL on the marketing-site help centre
  (`/help/outlook-assistant/faq/` instead of `/help/outlook-assistant/index/`).
  Internal references updated in `CLAUDE.md`, `llms.txt`,
  `.claude/rules/faq-maintenance.md`, and `.claude/hooks/faq-protection.sh`.
  The marketing-site sync (`littlebearapps/littlebearapps.com:
  scripts/docs-sync.config.ts`) picks up the new filename on next build.
  No content changes — same frontmatter, same 11 Q&A pairs. (#191)
- **`.gitignore`** — added `._*` (macOS resource-fork metadata) and `*.mov`
  (screen recordings often left in repo root from QA captures) so they no
  longer clutter `git status`.



Minor release. Closes roadmap item **#124** (`manage-event update` action) and adds two
config-layer overrides surfaced by an external contributor running the server against a
personal-only Azure app in the UK.

### Added

- **`manage-event` `update` action** — modify existing calendar events in place via
  `PATCH /me/events/{id}` without delete-and-recreate. Partial-update semantics: only
  the fields you pass are changed. Covers `subject`, `start`, `end`, `attendees`,
  `body`, `location`, `isOnlineMeeting`, `sensitivity`, `showAs`, `importance`,
  `categories`, `reminderMinutesBeforeStart`. `dryRun` parameter supported. Closes the
  competitive gap against ms-365-mcp-server, ryaker/outlook-mcp, Aanerud/MCP-Microsoft-Office,
  and lokka. (#124, #173 — community contribution by @taranasus)
- **`OUTLOOK_AUTH_AUDIENCE` env var** — configurable Microsoft Identity Platform OAuth
  audience. Defaults to `common` (current behaviour). Accepts `common`, `consumers`,
  `organizations`, or a single-tenant GUID. Fixes `AADSTS9002331` for Azure apps
  registered as "Personal Microsoft accounts only" (need `consumers`) and unblocks
  single-tenant setups. (#174 — community contribution by @taranasus)
- **`OUTLOOK_DEFAULT_TIMEZONE` env var** — override the hardcoded `Australia/Melbourne`
  default applied to calendar events when callers don't supply a timezone. Accepts any
  IANA timezone identifier. (#175 — community contribution by @taranasus)

### Documentation

- **README demo media** — use absolute GitHub URLs for the demo GIF/MP4 so they render
  correctly on the npm package page. (#171)
- **Troubleshooting** — new entry for `AADSTS9002331` ("configured for personal accounts
  only") pointing at `OUTLOOK_AUTH_AUDIENCE=consumers`.
- **Calendar how-to** — `manage-event-responses.md` gains an "Update an Event" section
  covering the new `update` action.

### Contributors

Second batch of community PRs from **@taranasus** (#173, #174, #175). Thanks!

## [3.7.4] - 2026-05

Patch release closing two regressions surfaced by an independent
v3.7.3 E2E re-verification against a live personal Outlook.com
mailbox. The v3.7.3 release tag is left in place; v3.7.4 ships the
post-tag bug fixes plus the new patches below so the version users
install actually contains the fixes the version claims.

### Fixed

- **F-24 chokepoint catches JSON-stringified arrays** — the original
  v3.7.3 fix only rejected live JS arrays in string-typed recipient
  params. In practice some MCP transports JSON-stringify array
  literals before transmission when the schema declares
  `type: "string"`, so the chokepoint received the literal string
  `'["a@x.com"]'` (brackets and quotes intact) and `Array.isArray`
  returned false. The user-visible failure mode (Graph 400
  `ErrorInvalidRecipients`) was unchanged. The check now also
  detects strings that parse as JSON arrays and rejects them with
  the same friendly hint, including the comma-joined form callers
  should pass instead. False-positive guards verified against
  bracketed subjects (`[GitHub] PR opened`) and malformed brackets.
  (#168)
- **`search-emails kqlQuery` no longer silently dropped** — two
  bugs in `progressiveSearch` Step 0:
  1. The kqlQuery was auto-wrapped in extra double quotes, breaking
     any caller using KQL field syntax (e.g. `subject:"foo bar"`
     became `"subject:"foo bar""` — broken nested quotes that Graph
     parsed unpredictably or failed to honour).
  2. If Step 0 returned 0 results (often a side-effect of bug 1),
     execution silently fell through to combined-search, which ran
     *without* the kqlQuery filter and returned recent unfiltered
     messages with a misleading `combined-search` strategy line.
  Fixed: don't auto-wrap quoted/multi-word/colon-bearing kqlQuery
  values; only quote bare single tokens. Always return from the
  raw-KQL branch — never fall through. Empty results carry
  `noResults: true` so the formatter shows the helpful suggestions
  block. Errors carry a `kqlError` marker and a `raw-kql-error`
  strategy line for programmatic detection. (#169)
- **F-17 `maxResults` alias in list mode** — wired through both
  `email/search.js` and `email/list.js` so `search-emails
  folder=junk maxResults=5` returns 5 results, not the previous 25.
  (Originally part of post-tag commit `9b4373a`, included here for
  the merged release notes.)

### Tests

- 690 → 708 passing tests, 26 suites, 0 failures (+18 regression
  cases): 5 for #168 covering both array forms, whitespace,
  multi-element arrays, and false-positive guards; 7 for #169
  covering silent-drop prevention, no-double-wrap on quoted/colon/
  multi-word KQL, single-token auto-wrap, and error surfacing.

### Documentation

- Added `ROADMAP.md` covering the active v3.7.5, v3.8.0, and v3.9.0
  milestones plus a recently-shipped section. Linked from `README.md`.
  Resolves the "no published roadmap to compare against" gap surfaced
  during the v3.7.2 build-page audit (littlebearapps/littlebearapps.com#142).
- Added `docs/faq/index.md` — 11 question/answer pairs covering install,
  account compatibility, Microsoft Graph permissions, token storage,
  read-only mode, Azure registration, device-code-vs-browser auth,
  updates, uninstall, privacy, and getting help. Linked from
  `docs/README.md`. The marketing-site help-centre infrastructure
  emits Schema.org `FAQPage` JSON-LD from this file once the matching
  `scripts/docs-sync.config.ts` mapping lands in
  `littlebearapps/littlebearapps.com`. (#167)
- Updated `docs/troubleshooting.md` with two new rows: one for the
  `send-email` `ErrorInvalidRecipients` regression closed by #168, one
  for the `kqlQuery` silent-drop closed by V37-F-1 of #169.
- Bumped how-to-guide count in README from 28 → 29 (matches actual
  count under `docs/how-to/`).

### Deferred to v3.8.0

- **V37-F-2** — `searchAllFolders=true` returning fewer matches than
  inbox-only `query` searches on personal Outlook.com. Needs a Graph
  `$search` semantics audit and possibly a client-side cross-folder
  fanout fallback. Tracked under #169.
- **V37-F-3 / F-12 edge case** — multi-word query AND-match misses
  subjects with bracket-prefixed tokens like `[GitHub] A fine-grained
  personal access token has been added`. Tracked under #138.
- **noResults rendering** says "in 'inbox'" even when
  `searchAllFolders=true` was passed. Cosmetic; underlying
  `_searchInfo` strategy is correct.
- Renaming `kqlQuery` to something less misleading — Microsoft Graph
  `$search` is not full KQL.

## [3.7.3] - 2026-05

E2E sweep findings fix-up. The previous session ran a full manual sweep
of every tool/action permutation against a live personal Outlook.com
mailbox and filed 48 findings across 7 GitHub issues (#159 tracker,
#160-#165 themes). v3.7.3 fixes them.

### Fixed

- **MCP boundary param coercion** — most MCP clients deliver array,
  boolean, integer, and number params as JSON-encoded strings. Handlers
  were written assuming JS-typed values, so mismatches surfaced as
  per-character Graph errors (`update-email ids`), silent no-ops
  (`manage-rules isEnabled`, `markAsRead`, `includeDetails`), or
  silently-ignored params (`folders includeItemCounts`). A single
  chokepoint in `index.js` now walks each tool's `inputSchema` once
  and coerces values into the right JS type before dispatch — no
  per-handler edits needed. (#160)
- **`update-email ids` array iterates char-by-char** — batch flag /
  unflag / complete operations now work. Was completely broken; one
  call could produce 400+ Graph errors. (F-25)
- **`apply-category categories` array has no working shape** — array
  param now deserialises properly. The categorisation pathway via
  `apply-category` was unusable from MCP. (F-33, F-36)
- **`manage-rules` boolean params silently ignored** — `isEnabled`,
  `markAsRead`, `includeDetails` are now honoured. Update output
  shows explicit before/after (`isEnabled: true → false`). (F-42, F-44, F-45)
- **`search-emails query="multi word"` misses obvious matches** —
  client-side fallback now splits on whitespace and AND-matches all
  words across subject/body/from. The flagship "progressive search
  finds emails Microsoft's `$search` API misses" claim now actually
  works for the common multi-word case. (F-12)
- **`set-auto-replies enabled=false` doesn't transition `scheduled`
  → `disabled`** — schedule timestamps are now explicitly cleared on
  disable, so the state actually flips. Was the cleanup-blocker for
  the v3.7.2 E2E sweep. (F-6)
- **`set-auto-replies enabled=true` (no schedule) silently coerced to
  disabled on personal accounts** — divergence between requested and
  Graph-applied status now surfaces a warning explaining the
  personal-account constraint. (F-7)
- **`set-auto-replies` with only `externalAudience` claims "updated"**
  — now clarifies "no status change applied; only externalAudience
  was updated" so callers don't think the state flipped. (F-4)
- **`manage-category set color=…` is a silent no-op** — handler now
  re-fetches after PATCH and warns when Graph stored something
  different (master-category colors are immutable on some account
  types). (F-35)
- **`manage-category list` truncates IDs with ellipsis** — full IDs
  emitted at standard verbosity so they can be copy-pasted. (F-9)
- **`manage-contact update jobTitle` shows up as "Company"** —
  formatter now emits separate "Job Title" and "Company" lines instead
  of squashing both into a single "Company" line. (F-40)
- **`attachments download outputDir`, `export target=message
  outputDir`, `export target=conversation outputDir` ignored or
  inconsistent** — all now honour `outputDir`, default to
  `os.tmpdir()` instead of cwd, and auto-create the target directory.
  Adds a deprecated `savePath` alias for the original schema name.
  (F-19, F-27, F-29)
- **`read-email` body output leaks tracking-pixel zero-width chars** —
  `formatEmailContent` now strips `U+200B..U+200F`, `U+2060`, `U+FEFF`,
  and the corresponding HTML entities (`&#8203;`, `&zwj;`, etc.) before
  returning. Hundreds of these were bloating token usage on Gmail-style
  messages. (F-16)
- **`search-emails maxResults` ignored in non-delta mode** — handler
  now accepts `maxResults` as an alias for `count` in both search
  and list paths. (F-17)
- **MCP chokepoint coercion silently passed arrays through to
  string-typed params** — `to`, `cc`, `bcc`, etc. accept comma-
  separated strings, but an array literal slipped through as a
  JSON-stringified value and bounced off Graph as an opaque 400.
  The string branch now rejects arrays at the MCP boundary with
  `expected comma-separated string, got array — pass "a,b" instead
  of ["a","b"]`. (F-24)
- **Delta-sync mislabels nextLink as "Delta Token"** — output now
  distinguishes a continuation token (more pages of the same sync)
  from a real delta token (sync complete). `_meta.tokenType` exposes
  the distinction programmatically. (F-15)
- **`folders create` and `manage-rules create` don't return the new
  ID** — both now include `**ID**: <id>` in the response and surface
  the ID in `_meta`. (F-31, F-43)
- **Multi-action tools silently route typos to list/get** — every
  multi-action tool's switch default now returns an explicit "Unknown
  action 'X'. Valid actions: …" error. The MCP boundary enum
  validation also rejects out-of-enum action values. (F-5, F-32, #162)
- **`manage-event accept` deliberately omitted** — documented in
  CLAUDE.md and tools-reference rather than left as a silent gap.
  Microsoft Graph doesn't expose an accept verb that works
  reliably on personal Outlook.com calendars. (F-38)
- **`get-mail-tips` reports "No issues detected" for invalid
  recipients on personal accounts** — now detects empty Graph
  responses (M365-only feature) and explicitly says "no warnings
  flagged ≠ validated as deliverable" so callers don't get false
  confidence. (F-23)
- **`find-meeting-rooms` 404 wrapped with permission-style hint on
  personal accounts** — now distinguishes "feature not available on
  this account type" (clear M365-only message) from generic permission
  errors. (F-47)
- **`auth action=about` doesn't show the authenticated mailbox** —
  output now includes `displayName <email>` at the top of the
  diagnostics block via a single `GET /me` round-trip. (F-2)
- **Safety-belt env vars off by default with no visible warning** —
  `auth about` and server startup now warn when
  `OUTLOOK_MAX_EMAILS_PER_SESSION` or `OUTLOOK_ALLOWED_RECIPIENTS`
  are unset, with a copy-paste snippet for the .mcp.json env block.
  Ships a `.mcp.json.example` with both vars pre-wired. (F-1, F-48)
- **`manage-contact list` shows "Total: 50" with no pagination cue**
  — now requests `$count: true` from Graph and surfaces "Showing N
  of M" plus a "pass `skip: N`" hint when more pages exist. Adds a
  `skip` schema param. (F-22)

### Changed

- **Strict parameter validation** — every tool now rejects unknown
  parameters at the MCP boundary (`additionalProperties: false`).
  Calls that previously silently ignored typos (e.g. `verbosity` on
  `folders list`) now error with a clear list of valid params.
  Authorised AI clients should be unaffected; clients depending on
  silent-ignore behaviour will need to drop the bogus params. (F-10)
- **Param-name aliases** — backwards-compatible aliases added so
  callers don't have to remember per-tool naming:
  `manage-event` accepts `id` (canonical) alongside `eventId`,
  `manage-rules` accepts `displayName` alongside `name` (matches
  Graph's own field name), `manage-category` accepts `categoryId`
  (deprecated) alongside `id` and `set` (deprecated) alongside
  `update`, `access-shared-mailbox` accepts `email` alongside
  `sharedMailbox`, `manage-contact create` accepts `firstName` /
  `lastName` / `emails` (mapped to Graph's `givenName` / `surname`
  / `emailAddresses[]`), `attachments download` and `export
  target=message` accept `outputDir` alongside `savePath`,
  `export target=messages` accepts `query` as a shortcut for
  `searchQuery: { subject }`. (#163)
- **Export Formats — per-target support clarified** — README and
  schema description now spell out which formats are valid for each
  `target`. mbox/html are conversation-only; target=message rejects
  them with a helpful message instead of "Unknown format". (F-26, F-30)
- **README claim audit** — softened the email forensics claim to
  reflect that the tool surfaces raw header data (DKIM, SPF, DMARC,
  X-Mailer, X-Originating-IP, delivery chain) but does not yet emit
  an automated phishing verdict. Updated Account Compatibility
  table — Focused Inbox API works on personal Outlook.com but mail
  routing is unaffected. Added a Recommended setup snippet under
  Send-email protections showing the safety belts pre-wired. (F-11,
  F-20, #164)

### Added

- **`utils/schema-coerce.js`** — JSON-schema-driven param coercion +
  validation module used at the MCP boundary. 36 unit + integration
  tests covering each coercion path, `additionalProperties`, enum,
  and required validation against the real schemas.
- **`.mcp.json.example`** — copy-paste config template with safety
  env vars pre-wired and inline comments explaining each.
- **Test suite expansion** — 82 new regression tests covering every
  fix above. 608 → 690 passing tests.

## [3.7.2] - 2026-04

### Fixed

- **Device code auth state lost on MCP server restart** — the pending device code was stored only in module-level memory, which is lost when the MCP server process restarts between the `authenticate` and `device-code-complete` tool calls. Now persisted to `~/.outlook-assistant-pending-auth.json` (mode 0o600) so the completion step works even after server restarts. Critical for Untether (Telegram bridge) and any environment where MCP servers restart between tool calls. (#142)
- **Token refresh fails for device-code auth** — `refreshAccessToken()` unconditionally included `client_secret` in refresh requests, but device code flow is a public client flow where Microsoft rejects `client_secret` ("Public clients can't send a client secret"). Now stores `auth_method: "device-code"` in the token file and conditionally excludes `client_secret` from refresh requests for device-code-obtained tokens. Browser-flow tokens continue to include `client_secret` as before. (#143)

### Added

- **`auth_method` field in token file** — tokens now include `auth_method: "device-code"` or `auth_method: "browser"` to track how they were obtained, enabling correct refresh behaviour for each flow.
- **New test files** `test/auth/auth-tools.test.js` and `test/auth/token-refresh.test.js` — 10 tests covering device code state persistence, disk fallback, expiry cleanup, auth_method propagation, and conditional `client_secret` handling.

## [3.7.1] - 2026-04

### Fixed

- **Silent fallback returns unfiltered results** — `search-emails` no longer silently returns unfiltered recent emails when filters (`from`, `to`, `subject`, `query`) match nothing in the target folder. Now returns 0 results with actionable guidance (suggests `searchAllFolders: true` and correct folder). Previously, AI agents had no way to detect the fallback and would make incorrect conclusions. (#138)
- **`to` filter broken on personal accounts** — `toRecipients/any()` OData lambda expressions fail silently on personal Microsoft accounts. Added client-side `to` filter fallback: fetches recent messages and filters by `toRecipients` locally. Same pattern used by `conversations.js` for conversation grouping. (#139)
- **`query` free-text search fails on personal accounts** — when `contains(subject)` returns 0 results for a `query` search, now tries client-side body search against `bodyPreview`, `subject`, and `from` fields before giving up.

### Added

- **`searchMetadata` in `_meta` block** — all `search-emails` responses now include `_meta.searchMetadata` with `strategiesAttempted`, `finalStrategy`, `filterApplied`, and `originalFilters`. AI agents can now programmatically detect when search filters were not applied. (#140)
- **`filterToClientSide()` helper** — client-side `toRecipients` filtering for personal account fallback.
- **`filterQueryClientSide()` helper** — client-side body/subject/from text search for personal account fallback.
- **New test file** `test/email/search.test.js` — 32 tests covering search fallback behaviour, client-side filtering, and helper functions.

## [3.7.0] - 2026-03

### Added

- **Enhanced `manage-rules` conditions** — 12 new condition types with OR logic support:
  - `containsSubject` now accepts comma-separated keywords with OR logic (e.g. `"invoice, receipt, payment"`)
  - `bodyContains`, `bodyOrSubjectContains` — match body/subject text (OR logic)
  - `senderContains`, `recipientContains` — partial sender/recipient matching
  - `sentToAddresses` — exact recipient email matching
  - `importance`, `sensitivity` — enum-based filtering
  - `sentToMe`, `sentOnlyToMe`, `sentCcMe`, `isAutomaticReply` — boolean routing conditions
- **Enhanced `manage-rules` actions** — 7 new action types:
  - `copyToFolder` — copy to folder (with name resolution)
  - `markImportance` — set importance level
  - `forwardTo`, `redirectTo` — auto-forward/redirect (with recipient allowlist check)
  - `assignCategories` — assign Outlook categories
  - `stopProcessingRules` — stop evaluating subsequent rules
  - `deleteMessage` — move to Deleted Items (no permanentDelete for safety)
- **Rule exceptions** — `except*` parameters to exclude specific senders, subjects, or conditions from a rule
- **`action=update`** on `manage-rules` — modify existing rules by name or ID (rename, enable/disable, change conditions/actions/exceptions)
- **`dryRun` parameter** on `manage-rules` create and update — preview rule without committing
- **`formatRuleDryRunPreview()`** in `utils/safety.js` — human-readable rule preview for dry-run operations
- **Rate limiting** on rule create, update, and delete operations via `OUTLOOK_MAX_MANAGE_RULES_PER_SESSION`

### Changed

- **Rules module**: refactored into `rule-builder.js` (shared builders), `create.js`, `update.js`, `list.js`
- **`manage-rules` actions**: `list|create|reorder|delete` → `list|create|update|reorder|delete`
- **List formatting**: detailed view now shows all condition types, action types, and exceptions

## [3.6.0] - 2026-03

### Added

- **`draft` tool** — full draft email lifecycle: create, update, send, delete, reply, reply-all, and forward drafts via Microsoft Graph API (#110)
  - `action=create` — save a new draft to the Drafts folder (supports `dryRun` and `checkRecipients`)
  - `action=update` — edit subject, body, recipients, or importance on an existing draft
  - `action=send` — send a draft (shares rate limit with `send-email`)
  - `action=delete` — remove a draft
  - `action=reply` / `action=reply-all` — create a reply draft from an existing message (auto-populates recipients and threading headers)
  - `action=forward` — create a forward draft with new recipients
  - `comment` parameter for reply/forward (prepended note, mutually exclusive with `body`)
- **`draft` field preset** in `utils/field-presets.js` — optimised field selection for draft operations
- **New how-to guide**: [Create and Manage Email Drafts](docs/how-to/email/create-draft-emails.md)

### Changed

- **Email module**: 7 → 8 tools (added `draft`)
- **Total tools**: 21 → 22
- **Safety annotations**: `draft` tool marked `destructiveHint: true` and `openWorldHint: true` (send/delete actions are irreversible)
- **Safety controls**: draft create/update rate-limited via `OUTLOOK_MAX_DRAFT_PER_SESSION`; send action shares `send-email` rate limit; recipient allowlist applies to create, update, and forward

## [3.5.2] - 2026-03

### Fixed

- **`search-emails` query fallback** — `query` parameter now falls back to `contains(subject)` instead of `$search` on personal accounts, returning partial results instead of failing with 503 (#98)
- **`search-emails` conversation filters** — `groupByConversation=true` with `subject`, `from`, or `to` filters now applies them via client-side filtering, fixing silent filter drops on personal accounts (#99)
- **`search-emails` domain filters** — domain-based `from` filters (e.g. `from="souliv.com.au"`) now use `contains()` instead of `eq`, matching all emails from that domain (#100)
- **`search-emails` hasAttachments** — `hasAttachments=true` filter now skips redundant combined search and removes `$orderby` conflict that caused fallback on personal accounts (#103)
- **`get-mail-tips` array parsing** — recipients passed as JSON array strings (e.g. `["a@b.com","c@d.com"]`) are now parsed correctly instead of including brackets in output (#104)
- **`auth` about tool count** — `action=about` now reports dynamic tool count (21) instead of hardcoded 20 (#105)
- **`manage-category` update response** — update action now shows the new `displayName` in the response instead of the old value (#106)
- **`send-email` dryRun + checkRecipients** — dry run with `checkRecipients=true` now always includes mail tips in the preview, even when no warnings are found (#107)
- **`apply-category` clear all** — `action=set` with an empty `categories` array now clears all categories from a message instead of returning an error (#108)

## [3.5.1] - 2026-03

### Added

- **Device code flow** — headless/remote authentication without the auth server, SSH tunnels, or port forwarding. Visit `microsoft.com/devicelogin`, enter a short code, done. Default auth method for new users (#95)
- **`action=device-code-complete`** on `auth` tool — two-step device code flow: `authenticate` returns code + URL, `device-code-complete` polls until the user signs in
- **`method` parameter** on `auth` tool — choose `device-code` (default) or `browser` (traditional OAuth redirect via port 3333)
- **Token auto-refresh** — `ensureAuthenticated()` now uses `token-storage.js` with proactive refresh (5-minute buffer before expiry). Re-authentication drops from hourly to ~quarterly
- **`callGraphAPIWithAuth()`** — Graph API wrapper with automatic 401 retry after token refresh (`utils/graph-api.js`)
- **`OUTLOOK_AUTH_METHOD`** env var — set default auth method (`device-code` or `browser`)

### Changed

- **Default auth method** changed from `browser` to `device-code` — no auth server needed for first-time setup
- **`ensureAuthenticated()`** now uses modern `token-storage.js` instead of legacy `token-manager.js` — all 21 tools get auto-refresh for free
- **Auth status** now reports token expiry time (e.g. "token expires in ~45 minutes")
- Auth tool description updated to document new actions and parameters

## [3.5.0] - 2026-03

### Added

- **`get-mail-tips` tool** — pre-send recipient validation: check for out-of-office, mailbox full, delivery restrictions, moderation, external recipients, group member counts, and max message size before sending. No other Outlook MCP server offers this (#83)
- **`checkRecipients` param on `send-email`** — opt-in pre-send mail tips check; combine with `dryRun=true` for full pre-send review showing warnings alongside the email preview
- **Batch API infrastructure** — `callGraphAPIBatch()` in `utils/graph-api.js` sends up to 20 Graph API requests in a single `$batch` call, reducing round-trips for bulk operations
- **Immutable IDs** — opt-in via `OUTLOOK_IMMUTABLE_IDS=true` env var; adds `Prefer: IdType="ImmutableId"` header so message/event IDs persist through folder moves
- **`extraHeaders` parameter on `callGraphAPI()`** — allows callers to pass additional HTTP headers (e.g. `Prefer`) per-request
- **New how-to guide**: [Check Recipients Before Sending](docs/how-to/email/check-recipients-before-sending.md)

### Fixed

- **Batch CSV export filename collision** — same-day exports no longer overwrite; filenames now use full ISO timestamp instead of date-only (#82)

### Changed

- **Email module**: 6 → 7 tools (added `get-mail-tips`)
- **Total tools**: 20 → 21
- **CI publishes to MCP Registry** — publish workflow now auto-publishes to the Official MCP Registry via `mcp-publisher` with GitHub OIDC auth (no secrets needed)
- Added Cursor one-click install deep link to README

## [3.4.1] - 2026-03

### Security

- **minimatch ReDoS** (CVE-2026-27903) — removed stale `yarn.lock` that pinned vulnerable `minimatch@3.1.2`; npm `overrides` already enforced `>=3.1.3` for `package-lock.json` (Dependabot #42)

### Fixed

- **`search-emails` folder resolution** — well-known Graph API folder names (`sentitems`, `deleteditems`, `junkemail`) and display names (`Sent Items`, `Deleted Items`, `Junk Email`) now resolve correctly (#79)
- **`mailbox-settings` timeZone** — `section=timeZone` no longer returns `[object Object]`; extracts scalar value from Graph API response envelope (#80)
- **`update-email` flag dueDateTime** — corrected datetime format (strip trailing Z), uses configured timezone instead of hardcoded UTC, auto-generates required `startDateTime` (#81)

### Changed

- **Version sync automation** — `config.js` reads version from `package.json` at runtime; npm `version` lifecycle script auto-syncs `server.json` (#78)
- Removed stale `yarn.lock` (project uses npm/`package-lock.json`)

## [3.4.0] - 2026-03

### Added

- **CSV export format** — export email metadata to spreadsheet-friendly CSV for data analysis, compliance reporting, and bulk operations (#71, PR #75 by @Chizaram-Igolo)
  - Metadata-only columns: id, subject, from, to, cc, receivedDateTime, isRead, importance, hasAttachments
  - CSV injection protection following OWASP guidelines (single-quote prefix for formula characters)
  - Batch export aggregates into a single CSV file with one row per email
  - Works with all export targets: `message`, `messages`, and `conversation`

## [3.3.0] - 2026-03

### Security

- **XSS prevention** — OAuth callback server now escapes all user-controlled values in HTML responses (`escapeHtml()` utility) (#60)
- **CSRF protection** — OAuth flow uses cryptographic state parameter (`crypto.randomUUID()`) with 10-minute expiry (#61)
- **HTTP security headers** — All auth server responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'` (#62)
- **Error sanitisation** — Graph API errors truncated to 200 chars; token exchange errors show generic message instead of raw `error.message` (#63)
- **Removed insecure fallback** — Token storage no longer falls back to `/tmp` (world-readable); throws if no home directory found (#64)

### Added

- **CodeQL scanning** — GitHub Actions SAST workflow (`.github/workflows/codeql.yml`) runs on push, PR, and weekly schedule (#65)
- **Dependency review** — CI blocks PRs introducing high-severity dependency vulnerabilities (#66)
- **Pre-commit hooks** — Husky + lint-staged for automatic linting and formatting on commit (#67)
- **Commit message linting** — commitlint enforces conventional commits via commit-msg hook (#67)

### Changed

- **Renamed** from "Outlook MCP" to "Outlook Assistant" across all code, docs, and configuration (34 files)
- Bumped `@modelcontextprotocol/sdk` minimum from `^1.1.0` to `^1.27.1`

### Fixed

- ESLint 10 compatibility: `preserve-caught-error` in `email/folder-utils.js`, `no-useless-assignment` in `utils/graph-api.js` and `utils/response-formatter.js`

### Dependencies

- `@modelcontextprotocol/sdk` ^1.27.1 (was ^1.1.0)
- `husky` ^9.1.7 (new)
- `lint-staged` ^16.3.2 (new)
- `@commitlint/cli` ^20.4.3, `@commitlint/config-conventional` ^20.4.3 (new)
- `eslint` ^10.0.2, `@eslint/js` ^10.0.1, `globals` ^17.4.0 (major bumps)

## [3.2.0] - 2026-02

### Fixed

- **Nonexistent folder silent fallback** — `search-emails` with an invalid `folder` now throws an error instead of silently falling back to inbox (#46)
- **`count=0` returns all emails** — `search-emails` now validates that `count` must be at least 1; uses nullish coalescing to correctly handle `count=0` (#47)
- **read-email minimal shows "No content"** — minimal verbosity now uses a dedicated `read-minimal` field preset that includes `bodyPreview` and `toRecipients`; shows body preview instead of "No content"; only renders `**To:**` when recipients exist (#48)
- **HTML body Content-Type shows "text"** — `send-email` HTML detection now matches `<div>`, `<p>`, `<br>`, `<table>`, `<span>`, `<a `, `<img>`, `<strong>`, `<em>`, `<b>`, `<i>` — not just `<html` (#49)
- **Conversation export error on personal accounts** — `export` and `read-email` conversation operations now catch `ErrorInvalidUrlQueryFilter`/`InefficientFilter` errors and return a friendly message suggesting individual message IDs instead (#50)
- **list-events times in UTC not local timezone** — calendar events now display in `Australia/Melbourne` timezone using `toLocaleString('en-AU')` with proper UTC normalisation (#51)
- **Rule sequence shows positional index** — rule listing now displays `[sequence] Name` instead of `1. Name - Sequence: N`, correctly showing the actual Graph API sequence value (#52)

### Added

- **auth `about` diagnostics** — `auth` tool with `action=about` now shows tool count, scopes, module breakdown, timezone, test mode, rate limit, and recipient allowlist configuration (#53)
- **folders `action=delete`** — delete mail folders by ID or name with protected folder guard (Inbox, Drafts, Sent, etc. cannot be deleted); tool now has `destructiveHint: true` (#54)
- **manage-rules `action=delete`** — delete inbox rules by name or ID; tool now has `destructiveHint: true` (#55)
- **Contact minimal verbosity** — `manage-contact` at `outputVerbosity=minimal` now shows only name and email (no phone, company, or ID), distinct from standard verbosity (#56)
- **Settings section-specific formatting** — `mailbox-settings` with `section=workingHours`, `automaticRepliesSetting`, `language`, or `timeZone` now returns formatted output instead of raw JSON (#57)
- **Auto-reply message warning** — enabling auto-replies without providing messages now warns if no message is configured, or notes when a previously configured message will be reused (#58)

### Changed

- `folders` tool annotations updated to `destructiveHint: true` (now includes delete action)
- `manage-rules` tool annotations updated to `destructiveHint: true` (now includes delete action)
- Security audit: updated `hono` and `@hono/node-server` transitive dependencies to fix 2 high-severity vulnerabilities

## [3.1.0] - 2026-03

### Fixed

- **callGraphAPI parameter order** in 3 modules (advanced, categories, settings) — 24 API calls had method and path arguments swapped, causing "Method must be a valid HTTP token" errors (#33)
- **Auth server scope desync** — `outlook-auth-server.js` now imports scopes from `config.js` instead of maintaining a separate hardcoded list (#34)
- **search-emails silent failure** on personal Microsoft accounts — `subject` parameter now uses OData `$filter` instead of `$search` (KQL), which is unsupported on personal accounts. Added user-visible warning when search falls back to recent-emails (#35)
- **search-people wrong property** — changed `emailAddresses` to `scoredEmailAddresses` in People API `$select` and display code (#36)
- **manage-contact search 400 error** — simplified OData filter to `contains(displayName, ...)` with client-side fallback when `$filter` fails (#37)
- **Double URL encoding** in 12 Graph API calls across 6 files — removed `encodeURIComponent()` from callers since `graph-api.js` already encodes path segments (#38)
- **manage-rules empty response** — fixed import destructuring bug where `require('./list')` returned the module object instead of the handler function (#39)
- **create-event discarded response** — event creation now returns event ID, start/end times with timezone, and web link in both response text and `_meta` (#40)
- **export saves to working directory** — default export path changed from CWD to `os.tmpdir()` to avoid polluting project directories (#41)
- **apply-category 400 error** — `$select=categories` was embedded in the path string, causing double URL-encoding by `graph-api.js`. Moved to `callGraphAPI` query params argument (#42)
- **access-shared-mailbox crash** — wrong import name (`EMAIL_FIELDS` → `FIELD_PRESETS`) caused "Cannot read properties of undefined", plus query params embedded in path string. Fixed import and moved params to `callGraphAPI` 5th argument (#43)
- **manage-rules stale tool name** — output text referenced old `edit-rule-sequence` tool instead of `manage-rules with action=reorder` (#44)

### Changed

- Auth server (`outlook-auth-server.js`) imports scopes, redirect URI, and token path from central `config.js`
- `search-emails` progressive fallback now warns users when query cannot be applied
- `manage-contact` search uses client-side filtering as fallback for incompatible OData endpoints

## [3.0.0] - 2026-02

### Changed

- **Tool consolidation: 55 → 20 tools** (~64% reduction, ~11,000 tokens saved per turn)
  - Email: 17 → 6 (`search-emails`, `read-email`, `send-email`, `update-email`, `attachments`, `export`)
  - Calendar: 5 → 3 (`list-events`, `create-event`, `manage-event`)
  - Contacts: 7 → 2 (`manage-contact`, `search-people`)
  - Categories: 7 → 3 (`manage-category`, `apply-category`, `manage-focused-inbox`)
  - Settings: 5 → 1 (`mailbox-settings`)
  - Folders: 4 → 1 (`folders`)
  - Rules: 3 → 1 (`manage-rules`)
  - Auth: 3 → 1 (`auth`)
  - Advanced: 4 → 2 (`access-shared-mailbox`, `find-meeting-rooms`)
- Consolidated tools use action parameters (STRAP pattern) instead of separate tool definitions
- Preferred env vars renamed to `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET` (old `MS_*` names still accepted)

### Added

- **MCP safety annotations** on all 20 tools (`readOnlyHint`, `destructiveHint`, `idempotentHint`)
  - 6 read-only tools auto-approved by Claude Code
  - 2 destructive tools (`send-email`, `manage-event`) prompt for confirmation
- **send-email safety controls**:
  - `dryRun` parameter — preview composed emails without sending
  - Session rate limiting via `OUTLOOK_MAX_EMAILS_PER_SESSION` env var
  - Recipient allowlist via `OUTLOOK_ALLOWED_RECIPIENTS` env var
- `utils/safety.js` — shared safety utilities (rate limiter, allowlist checker, dry-run formatter)
- `update-email` tool — unified mark-read, flag, unflag, and complete operations

### Removed

- 35 individual tools replaced by consolidated equivalents (see consolidation map in CLAUDE.md)
- `set-message-flag` and `clear-message-flag` from Advanced module (merged into `update-email`)

## [2.1.0] - 2026-02

### Changed

- Migrated ESLint 8 to ESLint 9 with flat config
- Replaced gitleaks with GitHub Advanced Security secret scanning
- Hardened security, cleaned up logging, improved CI pipeline

### Added

- Comprehensive test coverage across all modules (375 tests, 14 suites)
- Codecov integration with coverage badge
- Comprehensive Azure setup guide in documentation
- Full documentation refresh with LBA branding and GitHub templates

### Fixed

- Formatted `codecov.yml` for Prettier compatibility
- Resolved CI failures in formatting and security audit steps

### Dependencies

- `actions/checkout` v4 to v6
- `actions/setup-node` v4 to v6
- `codecov/codecov-action` v4 to v5
- `@commitlint/cli` to v20, `supertest` to v7.2
- `prettier` and `dotenv` bumped to latest

## [2.0.0] - 2024-12

### Added

- **55 tools** across 9 modules (was 27 tools across 5 modules)
- **Email Headers & MIME**: `get-email-headers`, `get-mime-content` for forensics and archival
- **Conversation Threading**: `list-conversations`, `get-conversation`, `export-conversation`
- **Contacts Module** (7 tools): Full CRUD operations + relevance-based people search
- **Categories Module** (7 tools): Category management + Focused Inbox overrides
- **Settings Module** (5 tools): Auto-replies, working hours configuration
- **Advanced Module** (4 tools): Shared mailbox access, message flags, meeting room search
- Export formats: MBOX and HTML for conversations
- New email tools: `export-email`, `batch-export-emails`, `list-emails-delta`, `search-by-message-id`

### Fixed

- `get-folder-stats` - Removed invalid `sizeInBytes` property from Graph API query

## [1.0.0] - 2024-11

### Added

- Initial release with 27 tools across 5 modules
- **Authentication**: OAuth 2.0 flow with Microsoft Graph API
- **Email Module**: List, search, read, send emails with attachment support
- **Calendar Module**: List, create, decline, cancel, delete events
- **Folder Module**: List, create folders; move emails between folders
- **Rules Module**: List, create, reorder inbox rules
- Test mode with mock data for development
- MCP Inspector integration for debugging
