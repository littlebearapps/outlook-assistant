# Outlook MCP Tool Testing Notes

## v3.1.0 Comprehensive Retest #2 — COMPLETE

**Date**: 2026-03-05
**Server Version**: 3.1.0
**Tester**: Claude Code (via live MCP calls)
**Account**: Personal Microsoft account (nathanschram@live.com)
**Purpose**: Fresh comprehensive retest of all 20 tools — happy paths, edge cases, and cross-cutting concerns

### Result: 20/20 tools PASS — 7 bugs, 6 enhancements filed

All 20 tools tested with multiple scenarios each. No crashes or regressions. 13 GitHub issues created (#46-#58).

### Pre-test Fixes Applied
- Auth server env var priority: `OUTLOOK_*` now checked before `MS_*` (3 source files, 2 test files)
- Auth pages and 16 documentation files made agent-agnostic ("your AI assistant" not "Claude")

### Results by Module

| Module | Tool | Status | Issues |
|--------|------|--------|--------|
| Auth | `auth` | PASS | #53 (enhancement) |
| Email | `search-emails` | PASS | #46 (bug), #47 (bug) |
| Email | `read-email` | PASS | #48 (bug) |
| Email | `send-email` | PASS | #49 (bug) |
| Email | `update-email` | PASS | — |
| Email | `attachments` | PASS | — |
| Email | `export` | PASS | #50 (bug) |
| Calendar | `list-events` | PASS | #51 (bug) |
| Calendar | `create-event` | PASS | — |
| Calendar | `manage-event` | PASS | — |
| Folder | `folders` | PASS | #54 (enhancement) |
| Rules | `manage-rules` | PASS | #52 (bug), #55 (enhancement) |
| Contacts | `manage-contact` | PASS | #56 (enhancement) |
| Contacts | `search-people` | PASS | — |
| Categories | `manage-category` | PASS | — |
| Categories | `apply-category` | PASS | — |
| Categories | `manage-focused-inbox` | PASS | — |
| Settings | `mailbox-settings` | PASS | #57 (enhancement), #58 (enhancement) |
| Advanced | `access-shared-mailbox` | PASS (graceful error) | — |
| Advanced | `find-meeting-rooms` | PASS (graceful error) | — |

### Bugs Found (#46-#52)

| Issue | Tool | Summary |
|-------|------|---------|
| #46 | `search-emails` | Nonexistent folder silently falls back to inbox |
| #47 | `search-emails` | `count=0` returns all emails instead of error |
| #48 | `read-email` | Minimal verbosity shows "No content" and blank To |
| #49 | `send-email` | HTML body Content-Type shows "text" not "HTML" |
| #50 | `export` | Conversation export raw API error on personal accounts |
| #51 | `list-events` | Times displayed in UTC not configured local timezone |
| #52 | `manage-rules` | Sequence display shows positional number not actual value |

### Enhancements Filed (#53-#58)

| Issue | Tool | Summary |
|-------|------|---------|
| #53 | `auth` | `about` action could show tool count, scopes, capabilities |
| #54 | `folders` | Add `action=delete` for folder removal |
| #55 | `manage-rules` | Add `action=delete` for rule removal |
| #56 | `manage-contact` | Minimal verbosity identical to standard |
| #57 | `mailbox-settings` | Section-specific `get` returns raw JSON vs formatted markdown |
| #58 | `mailbox-settings` | `set-auto-replies` without message reuses previous silently |

### Test Coverage Notes

- **send-email**: Tested with `dryRun=true` only (no live sends)
- **access-shared-mailbox**: Graceful error — requires org shared mailbox
- **find-meeting-rooms**: Graceful error — requires org-configured rooms + Places.Read.All
- **manage-event decline/cancel**: Tested delete only; decline/cancel need events from other organiser
- All test data cleaned up (calendar events, contacts, categories, focused inbox overrides, folders, rules)
- `set-auto-replies` and `set-working-hours` tested and restored to original values

### Cross-Cutting Observations

1. **Response formatting**: Generally excellent markdown. Inconsistency in `mailbox-settings` section-specific views (raw JSON vs formatted)
2. **Error messages**: Most tools return helpful errors. `search-emails` silently falls back on invalid folder (worst case). `export` conversation shows raw API error on personal accounts
3. **Parameter validation**: `count=0` not validated. Invalid section name passes through to API. Most required params validated well
4. **Destructive tools**: Properly marked and confirmation-gated
5. **Verbosity levels**: Work well for `search-emails` and `read-email`; `manage-contact` minimal = standard (no differentiation)

---

## v3.1.0 Retest — COMPLETE

**Date**: 2026-03-04
**Server Version**: 3.1.0
**Tester**: Claude Code (via MCP calls)
**Purpose**: Verify all 12 bug fixes (#33-#44) and confirm 20/20 tools working

### Result: 20/20 tools PASS

All tools tested via live MCP calls. Three additional bugs (#42-#44) found and fixed during testing.

### Retest Results
| Tool | v3.0.0 Status | v3.1.0 Status | Bugs Fixed |
|------|---------------|---------------|------------|
| `auth` | PASS | PASS | — |
| `search-emails` | PARTIAL | PASS | #35 |
| `read-email` | PASS | PASS | — |
| `send-email` | PASS | PASS | — |
| `update-email` | FAIL | PASS | #33, #38 |
| `attachments` | PASS | PASS | — |
| `export` | PASS | PASS | #41 |
| `list-events` | PASS | PASS | — |
| `create-event` | PASS | PASS | #40 |
| `manage-event` | PASS | PASS | — |
| `folders` | PARTIAL | PASS | #38 |
| `manage-rules` | FAIL | PASS | #39, #44 |
| `manage-contact` | PARTIAL | PASS | #37 |
| `search-people` | FAIL | PASS | #36 |
| `manage-category` | FAIL | PASS | #33 |
| `apply-category` | FAIL | PASS | #33, #42 |
| `manage-focused-inbox` | FAIL | PASS | #33 |
| `mailbox-settings` | FAIL | PASS | #33 |
| `access-shared-mailbox` | UNTESTED | PASS | #33, #43 |
| `find-meeting-rooms` | FAIL | PASS | #33 |

### New Bugs Found During Retest
| Issue | Tool | Problem | Fix |
|-------|------|---------|-----|
| #42 | `apply-category` | `$select=categories` embedded in path → 400 error | Moved to `callGraphAPI` 5th argument |
| #43 | `access-shared-mailbox` | Wrong import (`EMAIL_FIELDS` → `FIELD_PRESETS`) + query params in path | Fixed import, moved params to 5th argument |
| #44 | `manage-rules` | Output text referenced old tool name `edit-rule-sequence` | Changed to `manage-rules with action=reorder` |

### Notes
- `access-shared-mailbox`: Returns graceful "not found" error (no crash). Requires `Mail.Read.Shared` scope + org shared mailbox to fully test.
- `find-meeting-rooms`: Returns expected org-only error. Requires `Place.Read.All` scope + org-configured rooms.
- `send-email`: Tested with `dryRun=true` only (safe mode). Live send not tested.
- All 375/375 unit tests pass after fixes.

---

## v3.0.0 Testing Results (Previous Round)

**Date**: 2026-03-04
**Server Version**: 3.0.0
**Tester**: Claude Code

## Scope Configuration

### Configured Scopes (config.js — after update)
`Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `Calendars.Read`, `Calendars.ReadWrite`, `Contacts.Read`, `Contacts.ReadWrite`, `People.Read`, `MailboxSettings.ReadWrite`

### Initially Granted Scopes (before re-auth)
`User.Read`, `Mail.Read`, `Mail.Send`, `Calendars.Read`, `Calendars.ReadWrite`, `Contacts.Read`

**Root cause**: Auth server (`outlook-auth-server.js`) had a **separate hardcoded scope list** that was out of sync with `config.js`. The auth server was missing `Mail.ReadWrite`, `Contacts.ReadWrite`, `People.Read`, `MailboxSettings.ReadWrite`. Fixed both files and re-authenticated.

### After Re-auth (all granted)
`User.Read`, `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.Read`, `Calendars.ReadWrite`, `Contacts.Read`, `Contacts.ReadWrite`, `People.Read`, `MailboxSettings.ReadWrite`

### Still Missing (org-dependent, not applicable to personal accounts)
- `Mail.Read.Shared` — shared mailbox access
- `Place.Read.All` — meeting room discovery
- `offline_access` — missing from config.js (present in auth server)

---

## Phase 1: Tools With Current Permissions

### Tool: `auth` (Auth Module)
- **Status**: PASS
- **Permissions**: User.Read
- **Tests Run**: status, about, authenticate
- **Response Quality**: Good — clear status info
- **Issues Found**: None
- **Enhancements**: None

### Tool: `search-emails` (Email Module)
- **Status**: PARTIAL
- **Permissions**: Mail.Read
- **Tests Run**: list mode (no query), query search, subject filter, KQL query, folder filter, groupByConversation, receivedAfter date range, hasAttachments
- **Response Quality**: Good formatting, conversation grouping is excellent
- **Issues Found**:
  - BUG: `query` and `subject` params don't filter on personal MS accounts — `$search` OData operator silently fails, progressive fallback lands on "recent-emails" (returns unfiltered results)
  - BUG: `hasAttachments` filter also falls through to "recent-emails" — same `$search` issue
  - KQL (`kqlQuery` param) works correctly via different code path
  - `from`/`to` filters use `$filter` operator (more reliable) but untested with matching data
- **Enhancements**:
  - Consider logging a warning when falling back to "recent-emails" strategy
  - Convert `subject` filter to use `$filter` with `contains()` instead of `$search`
  - Add search strategy to output so users know when their query was silently ignored

### Tool: `read-email` (Email Module)
- **Status**: PASS
- **Permissions**: Mail.Read
- **Tests Run**: Basic read (OpenAI email), headersMode=true with importantOnly
- **Response Quality**: Excellent — clean markdown for content, well-structured forensic headers with auth results (SPF/DKIM/DMARC)
- **Issues Found**: None
- **Enhancements**: None

### Tool: `send-email` (Email Module)
- **Status**: PASS (dryRun only)
- **Permissions**: Mail.Send
- **Tests Run**: dryRun=true with test@example.com
- **Response Quality**: Good — clear preview showing To, Subject, Importance, Content-Type, body
- **Issues Found**: None (actual send not tested — would need real recipient)
- **Enhancements**: None

### Tool: `update-email` (Email Module)
- **Status**: FAIL
- **Permissions**: Mail.ReadWrite
- **Tests Run**: mark-read (403 even after re-auth), flag (callGraphAPI param swap)
- **Response Quality**: N/A — errors only
- **Issues Found**:
  - BUG (SYSTEMIC): `flag`/`unflag`/`complete` actions in `advanced/index.js:243,350` have swapped callGraphAPI params
  - BUG: `mark-as-read.js:33` uses `encodeURIComponent(emailId)` → double-encoded by `graph-api.js:38-41` path segment encoding → likely causes 403 even with correct scope
  - 403 persisted after re-auth with Mail.ReadWrite, confirming double-encoding as root cause
- **Enhancements**:
  - Fix callGraphAPI parameter order in advanced/index.js (flag handlers)
  - Remove `encodeURIComponent()` from mark-as-read.js (graph-api.js handles encoding)

### Tool: `attachments` (Email Module)
- **Status**: PASS
- **Permissions**: Mail.Read
- **Tests Run**: action=list on a message
- **Response Quality**: Good — clear "No attachments found" message
- **Issues Found**: None (no emails with actual attachments to test view/download)
- **Enhancements**: None

### Tool: `export` (Email Module)
- **Status**: PASS
- **Permissions**: Mail.Read
- **Tests Run**: target=mime (headersOnly=true), target=message (format=markdown), target=message (format=json)
- **Response Quality**: Excellent — MIME headers-only is great for forensics, markdown/json exports include clear summary table
- **Issues Found**:
  - Files save to CWD by default which may pollute project directories
  - MIME output is very verbose (77.6KB for headers only) — could truncate anti-spam headers
- **Enhancements**:
  - Default savePath should be a temp directory or require explicit path
  - Consider summarising verbose Exchange anti-spam headers in MIME output

### Tool: `list-events` (Calendar Module)
- **Status**: PASS
- **Permissions**: Calendars.Read
- **Tests Run**: Default listing (empty), listing after creating test event
- **Response Quality**: Good — shows subject, location, start/end, summary, ID
- **Issues Found**: None
- **Enhancements**: None

### Tool: `create-event` (Calendar Module)
- **Status**: PASS
- **Permissions**: Calendars.ReadWrite
- **Tests Run**: Created test event with subject, start, end, body
- **Response Quality**: Minimal — just "Event 'X' has been successfully created." No ID returned.
- **Issues Found**:
  - Times with `Z` suffix treated as UTC, displayed in AEDT — confusing. Times without `Z` correctly use DEFAULT_TIMEZONE.
  - No event ID returned in creation response — have to call list-events to get it
- **Enhancements**:
  - Return the created event ID in the response
  - Return created event details (start/end in local tz) for confirmation
  - Document the `Z` suffix gotcha in guides

### Tool: `manage-event` (Calendar Module)
- **Status**: PASS
- **Permissions**: Calendars.ReadWrite
- **Tests Run**: action=delete on test event
- **Response Quality**: Good — clear confirmation with event ID
- **Issues Found**: None
- **Enhancements**: None (decline/cancel untested — need events from other organiser)

### Tool: `folders` (Folder Module)
- **Status**: PARTIAL
- **Permissions**: Mail.Read (list/stats work), Mail.ReadWrite (create/move — 403 even after re-auth)
- **Tests Run**: action=list (includeItemCounts), action=stats (full verbosity), action=create (403)
- **Response Quality**: Excellent — list shows clear folder hierarchy with counts, stats gives detailed pagination planning info
- **Issues Found**:
  - action=create still 403 after re-auth — MCP server process may need restart to pick up new token, OR folder create has encoding issues
  - action=move not tested (same issue)
- **Enhancements**:
  - Stats "Pagination Planning" section is very useful for LLM context planning

### Tool: `manage-rules` (Rules Module)
- **Status**: FAIL
- **Permissions**: Unknown — empty response even after granting MailboxSettings.ReadWrite
- **Tests Run**: action=list (with and without includeDetails), tested before and after re-auth
- **Response Quality**: Empty — "Tool ran without output or errors" both times
- **Issues Found**:
  - BUG: Returns completely empty response instead of "No inbox rules found" or an error message
  - The handler code clearly returns text content, so the issue is likely an unhandled error being swallowed
  - Possible that `me/mailFolders/inbox/messageRules` endpoint is unsupported on personal MS accounts
- **Enhancements**:
  - Investigate and fix the empty response — should always return meaningful output
  - Add error logging to trace where the response is lost

---

## Phase 2: After Re-auth (Expanded Scopes)

### Tool: `manage-contact` (Contacts Module)
- **Status**: PARTIAL
- **Permissions**: Contacts.Read (list works), Contacts.ReadWrite (create/update/delete untested)
- **Tests Run**: action=list (count=5), action=search (query="Nathan")
- **Response Quality**: list is excellent — shows display name, email, phone, ID. search returns 400.
- **Issues Found**:
  - BUG: action=search returns 400 "ErrorInvalidUrlQueryFilter" — the OData filter query is malformed
  - action=get, create, update, delete not tested
- **Enhancements**:
  - Fix search query filter construction

### Tool: `search-people` (Contacts Module)
- **Status**: FAIL
- **Permissions**: People.Read
- **Tests Run**: query="Nathan"
- **Response Quality**: N/A — error only
- **Issues Found**:
  - BUG: Returns 400 "Could not find a property named 'emailAddresses' on type 'microsoft.graph.person'"
  - The Graph API `person` resource uses `scoredEmailAddresses`, not `emailAddresses`
- **Enhancements**:
  - Fix property name from `emailAddresses` to `scoredEmailAddresses` in the `$select` query

### Tool: `manage-category` (Categories Module)
- **Status**: FAIL
- **Permissions**: MailboxSettings.ReadWrite
- **Tests Run**: action=list
- **Response Quality**: N/A — error only
- **Issues Found**:
  - BUG (SYSTEMIC): callGraphAPI params swapped in ALL category operations (categories/index.js — 11 swapped calls)
- **Enhancements**:
  - Fix all callGraphAPI parameter order in categories/index.js

### Tool: `apply-category` (Categories Module)
- **Status**: FAIL
- **Permissions**: Mail.ReadWrite + MailboxSettings.ReadWrite
- **Tests Run**: Apply "Test Category" to a message
- **Response Quality**: N/A — error only
- **Issues Found**:
  - BUG (SYSTEMIC): Same callGraphAPI param swap (categories/index.js)
- **Enhancements**: Same fix as manage-category

### Tool: `manage-focused-inbox` (Categories Module)
- **Status**: FAIL
- **Permissions**: MailboxSettings.ReadWrite
- **Tests Run**: action=list
- **Response Quality**: N/A — error only
- **Issues Found**:
  - BUG (SYSTEMIC): callGraphAPI params swapped (categories/index.js — 5 swapped calls for focused inbox)
- **Enhancements**: Same fix as manage-category

### Tool: `mailbox-settings` (Settings Module)
- **Status**: FAIL
- **Permissions**: MailboxSettings.ReadWrite
- **Tests Run**: action=get
- **Response Quality**: N/A — error only
- **Issues Found**:
  - BUG (SYSTEMIC): callGraphAPI params swapped in ALL settings operations (settings/index.js — 7 swapped calls)
- **Enhancements**:
  - Fix all callGraphAPI parameter order in settings/index.js

### Tool: `access-shared-mailbox` (Advanced Module)
- **Status**: UNTESTED
- **Permissions**: Mail.Read.Shared (not added — org-dependent)
- **Tests Run**: None — no shared mailbox available on personal account
- **Response Quality**: N/A
- **Issues Found**:
  - Likely affected by the systemic callGraphAPI param swap in advanced/index.js
- **Enhancements**: Fix param order if affected

### Tool: `find-meeting-rooms` (Advanced Module)
- **Status**: FAIL
- **Permissions**: Place.Read.All (not added — org-dependent)
- **Tests Run**: Default (no params)
- **Response Quality**: Shows helpful error message noting requirements
- **Issues Found**:
  - BUG (SYSTEMIC): callGraphAPI params swapped in advanced/index.js (2 calls for room discovery)
  - Also requires org admin to have configured rooms — not available on personal accounts
- **Enhancements**: Fix param order; add note that this is org-only

---

## Systemic Bug: callGraphAPI Parameter Swap

### Root Cause
The function signature is `callGraphAPI(accessToken, method, path, data, queryParams)` but 23 call sites across 3 files pass the path as the second argument and method as the third.

### Affected Files (23 swapped calls total)
| File | Swapped Calls | Correct Calls |
|------|---------------|---------------|
| `advanced/index.js` | 5 | 0 |
| `categories/index.js` | 11 | 0 |
| `settings/index.js` | 7 | 0 |

### Unaffected Files (all correct)
- `email/*.js` (search, read, send, attachments, mark-as-read, export)
- `calendar/*.js` (list, create, accept, cancel, decline, delete)
- `contacts/index.js` (7 correct calls)
- `folder/*.js` (list, create, move)
- `rules/*.js` (list, create, reorder)

### Impact
These 3 files were likely written in a different phase/style from the rest of the codebase. Every tool backed by these files is completely non-functional.

---

## Additional Bug: Double URL Encoding

### Affected
- `email/mark-as-read.js:33` — `encodeURIComponent(emailId)` before passing to callGraphAPI
- `email/headers.js:190` — same pattern
- `email/read.js:69` — same pattern (but this one works! Investigate why)
- `email/export.js:59,447,506` — same pattern

### Root Cause
`graph-api.js:38-41` already encodes each path segment with `encodeURIComponent()`. Pre-encoding in the callers causes double-encoding (`=` → `%3D` → `%253D`).

### Puzzle
`read-email` uses the same pre-encoding pattern but works. This may be because GET requests are more tolerant of double-encoded IDs than PATCH requests, or the Graph API has special handling. Needs investigation.

---

## Documentation Updates Needed

### High Priority
1. **`docs/how-to/getting-started/connect-outlook-to-claude.md`** — API permissions list (lines 37-43) is missing 5 required scopes: `offline_access`, `User.Read`, `Mail.Read`, `Calendars.Read`, `Contacts.Read`. Users following this guide will set up a broken app.
2. **`docs/how-to/email/find-emails.md`** + **`docs/how-to/advanced/kql-search-reference.md`** — No warning that `query`/`subject` params silently fail on personal MS accounts. The KQL guide currently advises "try `query` first" which is backwards for personal accounts.

### Medium Priority
3. **Auth server env var docs** — Multiple guides (README.md, azure-setup.md, connect-outlook-to-claude.md) don't mention that `npm run auth-server` needs env vars in `.env` or shell. Claude Desktop `"env"` block does NOT apply to the auth server run separately.
4. **`create-event` timezone docs** — The `Z` suffix gotcha is easy to hit. `docs/how-to/calendar/create-calendar-events.md` and `docs/quickrefs/tools-reference.md` should warn about this.

### Low Priority
5. **`docs/guides/azure-setup.md`** — `MailboxSettings.Read` listed alongside `MailboxSettings.ReadWrite` (redundant).
6. **`README.md`** — Missing `offline_access` from permissions list.
7. **Auth server scope sync** — No docs warn that `outlook-auth-server.js` has a separate scope list from `config.js` that must be kept in sync.

---

## Summary

### Tool Status Overview

| Status | Count | Tools |
|--------|-------|-------|
| PASS | 8 | auth, read-email, send-email, attachments, export, list-events, create-event, manage-event |
| PARTIAL | 3 | search-emails, folders, manage-contact |
| FAIL | 8 | update-email, manage-rules, search-people, manage-category, apply-category, manage-focused-inbox, mailbox-settings, find-meeting-rooms |
| UNTESTED | 1 | access-shared-mailbox |

### Bug Priority

| Priority | Bug | Impact | Fix Effort |
|----------|-----|--------|------------|
| **P0** | callGraphAPI param swap (23 calls in 3 files) | 8 tools completely broken | Low — mechanical swap |
| **P1** | search-emails `$search` silent failure | Main search mode unusable on personal accounts | Medium — needs `$filter` fallback or KQL rewrite |
| **P1** | Auth server scope list out of sync with config.js | Users get wrong scopes, tools fail with 403 | Low — sync lists or import from config.js |
| **P2** | search-people wrong property name | Tool broken | Low — rename `emailAddresses` → `scoredEmailAddresses` |
| **P2** | manage-contact search 400 error | Search action broken | Low — fix OData filter |
| **P2** | Double URL encoding in mark-as-read/headers | Mark-read broken even with correct scopes | Low — remove pre-encoding |
| **P2** | manage-rules empty response | Tool appears broken, no error shown | Medium — debug error handling chain |
| **P3** | create-event no ID in response | Minor UX issue | Low |
| **P3** | export saves to CWD | Minor UX issue | Low |
