# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
