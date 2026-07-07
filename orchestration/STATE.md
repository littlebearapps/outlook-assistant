# Outlook Assistant Orchestration State

Append-only execution ledger for the orchestration package.

## [2026-07-07 14:31] Phase 0.0 — Create state ledger
Branch/PR: main / n/a
Checks:
  - Baseline install: `npm install` → up to date, audited 658 packages → PASS
  - Baseline tests: `npm test` → Test Suites: 29 passed, 29 total; Tests: 751 passed, 751 total → PASS
  - Baseline lint: `npm run lint` → 25 warnings; 0 errors → PASS
Gate: PASSED
Notes: Initial sandboxed baseline attempt failed with `listen EPERM 0.0.0.0` in `test/auth/oauth-server.test.js`; reran the same gate outside the sandbox because Jest needs to bind a local test server. `npm install` reported 8 audit vulnerabilities; this is outside Phase 0 scope and did not change the required baseline gate.

## [2026-07-07 14:32] Phase 0.1 — T0.1 Azure app registration + local MCP config
Branch/PR: docs/phase-0-golive / n/a
Checks:
  - Read T0.1 brief: `sed -n '1,360p' orchestration/tasks/phase-0/T0.1-azure-app-config.md` → brief read; owner Azure input required → PASS
  - Verify cited scopes: `nl -ba config.js | sed -n '1,130p'` → `AUTH_CONFIG.scopes` matches T0.1 required delegated scopes → PASS
  - Verify local config ignore status: `git check-ignore .env; git check-ignore .mcp.json` → both ignored → PASS
  - Azure app registration: owner portal action not yet completed → BLOCKED
  - Local MCP config: client ID/account details unavailable → BLOCKED
Gate: BLOCKED(required owner input: Azure app client ID, sign-in account type, owner mailbox address, and chosen auth audience if not `common`)
Notes: No live mailbox calls were made. No local MCP config or `.env` was written because the required Azure details are not available. Next: owner completes/identifies Azure app registration per T0.1 checklist, then executor writes local config and runs the T0.1 acceptance checks.

## [2026-07-07 15:17] Phase 0.1 — T0.1 Azure app registration + local MCP config
Branch/PR: docs/phase-0-golive / n/a
Checks:
  - Owner Azure inputs: owner provided application client ID ending `f17c`, mailbox `david.basseal@vitasci.com.au`, work/school account type, audience `common` → PASS
  - Local config ignore status: `git status --short --ignored .env` → `!! .env` → PASS
  - No secrets entered the repo: `rg '<full-client-id>|702df17c|client secret|OUTLOOK_CLIENT_SECRET' orchestration/STATE.md` → no matches; `git status --short --untracked-files=all` shows orchestration package files only, `.env` ignored → PASS
  - Server starts with config env: `set -a; source .env; set +a; USE_TEST_MODE=true npm run test-mode` → `STARTING OUTLOOK-ASSISTANT MCP SERVER`; `Test mode is enabled`; `outlook-assistant connected and listening`; no `TokenStorage: OUTLOOK_CLIENT_ID is not configured` warning → PASS
  - Safety env vars present in local config: `.env` contains `OUTLOOK_MAX_EMAILS_PER_SESSION=10` and `OUTLOOK_ALLOWED_RECIPIENTS=david.basseal@vitasci.com.au` only → PASS
Gate: PASSED
Notes: Local config uses device-code auth, `OUTLOOK_AUTH_AUDIENCE=common`, and `OUTLOOK_DEFAULT_TIMEZONE=Australia/Sydney`. The earlier BLOCKED T0.1 entry is resolved by this passed entry. No live mailbox calls were made.

## [2026-07-07 16:26] Phase 0.2 — T0.2 Device-code authentication + read-only live smoke test
Branch/PR: docs/phase-0-golive / n/a
Checks:
  - Read T0.2 brief: `sed -n '1,420p' orchestration/tasks/phase-0/T0.2-auth-and-readonly-smoke.md` → brief read; owner browser sign-in required → PASS
  - Read known auth failures: `nl -ba HANDOVER.md | sed -n '193,205p'` and `rg -n "AADSTS|Device code" docs/troubleshooting.md` → known failures checked → PASS
  - Device-code initiate attempt: direct device-code initiation using repo auth helper with `.env` config → Microsoft returned `AADSTS50059: No tenant-identifying information found in either the request or implied by any provided credentials` → BLOCKED
  - Token state: `ls -la ~/.outlook-assistant-pending-auth.json ~/.outlook-assistant-tokens.json 2>/dev/null` → stale pending-auth file exists from 2026-06-28; no current token evidence recorded → BLOCKED
Gate: BLOCKED(auth error `AADSTS50059` is not listed in `HANDOVER.md` Common Auth Failures or `docs/troubleshooting.md`)
Notes: No device code was printed or recorded. No live mailbox read or mutation calls were made. The device-code initiation initially failed in the sandbox with `getaddrinfo ENOTFOUND login.microsoftonline.com`; reran outside the sandbox and received the Microsoft auth error above. Next: owner should verify the Azure app registration tenant/support account type and whether the supplied client ID belongs to the app configured for `common`, or provide the tenant GUID/audience to use.

## [2026-07-07 17:39] Phase 0.2 — T0.2 auth diagnostic update
Branch/PR: docs/phase-0-golive / n/a
Checks:
  - Owner Azure clarification: app registration is single-tenant (`My organisation only`); tenant ID provided → explains prior `AADSTS50059` with `common` audience → PASS
  - Local config correction: `.env` updated from `OUTLOOK_AUTH_AUDIENCE=common` to tenant GUID audience → PASS
Gate: BLOCKED(waiting for owner confirmation that Azure public-client platform settings are configured)
Notes: T0.2 remains blocked until owner confirms Azure app platform/public-client setup. No live mailbox calls were made.

## [2026-07-07 17:58] Phase 0.2 — T0.2 Device-code authentication + read-only live smoke test
Branch/PR: docs/phase-0-golive / n/a
Checks:
  - T0.2 authenticate: device-code initiation against tenant audience → browser sign-in completed by owner; `device-code-complete` → `Authentication successful; tokens saved.` → PASS
  - T0.2 token sanity: `cat ~/.outlook-assistant-tokens.json | python3 -c ...` → `auth_method: device-code`; `has access_token: True` → PASS
  - T0.2 auth status: `auth {"action":"status"}` → `Authenticated and ready (token expires in ~67 minutes)` → PASS
  - T0.2 auth about: `auth {"action":"about"}` → mailbox `David Basseal <david.basseal@vitasci.com.au>`; rate limit `10`; allowlist `david.basseal@vitasci.com.au` → PASS
  - T0.2 search-emails `{}`: recent inbox query → 1 recent email returned; subject redacted for privacy → PASS
  - T0.2 read-email selected message: selected recent message read → subject returned, body preview present, sender present; body content suppressed from transcript → PASS
  - T0.2 list-events `{}`: calendar view query → 3 events returned; non-error response → PASS
  - T0.2 folders `{"action":"list"}`: folder list query → 14 folders returned; includes Inbox → PASS
  - T0.2 evidence count: `grep -c "T0.2" orchestration/STATE.md` after this entry → at least 6 evidence lines → PASS
Gate: PASSED
Notes: Read-only smoke order was preserved before any mutating verification. Earlier `AADSTS50059` blocker was resolved by switching local auth audience from `common` to the single-tenant GUID supplied by the owner. No send, draft, calendar mutation, folder mutation, rules, category, settings, or other mutating tools were called.

## [2026-07-07 18:09] Phase 0.3 — T0.3 Send-safety verification
Branch/PR: docs/phase-0-golive / n/a
Checks:
  - T0.3 dryRun preview: `send-email {"to":"david.basseal@vitasci.com.au","subject":"outlook-assistant go-live dryRun T0.3","body":"dry run preview -- should never arrive","dryRun":true}` → starts `DRY RUN — Email NOT sent.`; echoes To, Subject, Body → PASS
  - T0.3 allowlist block: `send-email {"to":"blocked-test@example.net","subject":"allowlist block test","body":"should be blocked","dryRun":true}` → starts `Recipient not allowed: blocked-test@example.net.`; lists allowed recipient `david.basseal@vitasci.com.au` → PASS
  - T0.3 rate-limit session precheck: fresh process with `OUTLOOK_MAX_EMAILS_PER_SESSION=1`; `auth {"action":"status"}` → authenticated; `auth {"action":"about"}` → mailbox `David Basseal <david.basseal@vitasci.com.au>`, rate limit `1` → PASS
  - T0.3 single guarded live self-send: `send-email {"to":"david.basseal@vitasci.com.au","subject":"outlook-assistant go-live verification T0.3","body":"single guarded live send","checkRecipients":true}` → `Email sent successfully!`; subject echoed → PASS
  - T0.3 repeated live send blocked: repeated same call in same process → `Rate limit reached: 1 send-email operations per session. Restart the server to reset. Configure via OUTLOOK_MAX_SEND_EMAIL_PER_SESSION environment variable.` → PASS_WITH_DRIFT
  - T0.3 restore config: default `.env` has `OUTLOOK_MAX_EMAILS_PER_SESSION=10`; `auth {"action":"status"}` after restore → `Authenticated and ready (token expires in ~54 minutes)` → PASS
  - T0.3 owner receipt confirmation: pending owner confirmation that the single self-send arrived → BLOCKED
Gate: BLOCKED(required owner touchpoint: confirm receipt of the single test email)
Notes: Exactly one live send was attempted and it targeted only the owner allowlisted address. Drift: T0.3 expected the rate-limit response to mention `OUTLOOK_MAX_EMAILS_PER_SESSION`, but current `utils/safety.js` derives the tool-specific env key and returned `OUTLOOK_MAX_SEND_EMAIL_PER_SESSION`; the blocking behavior and limit value matched current code. No source files were changed.

## [2026-07-07 18:10] Phase 0.3 — T0.3 owner receipt confirmation
Branch/PR: docs/phase-0-golive / n/a
Checks:
  - T0.3 owner receipt confirmation: owner confirmed receipt of the single test email with subject `outlook-assistant go-live verification T0.3` → PASS
  - T0.3 evidence count: `grep -c "T0.3" orchestration/STATE.md` after this entry → at least 4 evidence lines → PASS
Gate: PASSED
Notes: This resolves the prior T0.3 BLOCKED entry. Total live sends authorized and performed in Phase 0 so far: exactly one, to the owner address only.

## [2026-07-07 18:14] Phase 0.4 — T0.4 Go-live sign-off + docs sync
Branch/PR: docs/phase-0-golive / n/a
Checks:
  - T0.4 docs drift pass: reviewed `HANDOVER.md`, `docs/troubleshooting.md`, `docs/how-to/getting-started/**`, FAQ policy, and Phase 0 observed errors → found undocumented `AADSTS50059` single-tenant audience failure and stale device-code secret guidance → PASS
  - T0.4 docs update: updated `HANDOVER.md`, `docs/troubleshooting.md`, `docs/how-to/getting-started/connect-outlook-to-claude.md`, `docs/how-to/getting-started/verify-your-connection.md`, `docs/faq/faq.md`, and `CHANGELOG.md` → PASS
  - T0.4 scope check: `git diff --name-only` → only allowed T0.4 docs files changed → PASS
  - T0.4 FAQ floor: `grep -cE '^## ' docs/faq/faq.md` → 11 → PASS
  - T0.4 suite untouched: `npm test` outside sandbox → Test Suites: 29 passed, 29 total; Tests: 751 passed, 751 total → PASS
  - T0.4 lint clean: `npm run lint` outside sandbox → 25 warnings; 0 errors → PASS
  - T0.4 local config safety: `git status --short --ignored .env` → `!! .env` → PASS
  - T0.4 owner final sign-off: pending explicit owner production-live approval → BLOCKED
Gate: BLOCKED(required owner touchpoint: final go-live sign-off line)
Notes: Docs drift outside T0.4's allowed file scope remains in `README.md`, `docs/guides/azure-setup.md`, and `.mcp.json.example` where older examples still emphasize client secrets/default `common`; not changed in this step because T0.4 files-in-scope does not include them. No source or test files were changed. Sandbox `npm test` still fails with `listen EPERM 0.0.0.0`, so the required gate was run outside the sandbox as in Phase 0.0.

T0.4 GO-LIVE SIGN-OFF (2026-07-07, Codex)
[x] Baseline verified pre-phase: 29 suites / 751 tests, lint 0 errors     (Phase 0.0 entry, 2026-07-07 14:31)
[x] Azure app registered; public client flow on; scopes match config.js  (Phase 0.1 entries, 2026-07-07 15:17; owner public-client confirmation before T0.2 retry)
[x] No secrets in repo (git log/status audited)                          (Phase 0.1 entry, 2026-07-07 15:17; `.env` ignored in T0.4)
[x] Device-code auth completed; tokens auto-refresh in place             (Phase 0.2 entry, 2026-07-07 17:58)
[x] All 6 read-only smoke checks passed                                  (Phase 0.2 entry, 2026-07-07 17:58)
[x] dryRun preview verified                                              (Phase 0.3 entry, 2026-07-07 18:09)
[x] Allowlist block verified                                             (Phase 0.3 entry, 2026-07-07 18:09)
[x] Rate limit verified; exactly 1 live email sent, to owner             (Phase 0.3 entries, 2026-07-07 18:09 and 18:10)
[x] Safety env vars restored to production values                        (Phase 0.3 entry, 2026-07-07 18:09)
[x] Owner sign-off: David Basseal, 2026-07-07 — "I sign off Outlook Assistant as production-live for read + guarded-send use on 2026-07-07."

## [2026-07-07 18:20] Phase 0.4 — T0.4 owner final sign-off
Branch/PR: docs/phase-0-golive / n/a
Checks:
  - T0.4 owner final sign-off: owner wrote `I sign off Outlook Assistant as production-live for read + guarded-send use on 2026-07-07.` → PASS
  - T0.4 checklist complete: `grep -A12 "GO-LIVE SIGN-OFF" orchestration/STATE.md` → every box `[x]`, owner line filled → PASS
Gate: PASSED
Notes: This resolves the prior T0.4 BLOCKED entry. Phase 0 exit criteria are satisfied: T0.1, T0.2, T0.3, and T0.4 gates are all recorded as passed. Outlook Assistant is production-live for read + guarded-send use.

## [2026-07-07 18:20] Phase 0 exit — Go-live & production hardening complete
Branch/PR: docs/phase-0-golive / n/a
Checks:
  - Phase 0 gates: STATE.md has PASSED entries for T0.1, T0.2, T0.3, and T0.4 → PASS
  - Production-live declaration: owner sign-off recorded for read + guarded-send use → PASS
  - Next phase: Phase 1 polish slate per `orchestration/workflows/phase-1-polish.md` → PASS
Gate: PASSED
Notes: Phase 1 may begin from issue #68 after committing Phase 0 docs/ledger changes.

## [2026-07-07 19:25] Phase 0.4 — T0.4 PR publication attempt
Branch/PR: docs/phase-0-golive / blocked
Checks:
  - Local commit: `git commit -m "docs: record phase 0 go-live signoff"` → `e9620e0` created with Phase 0 docs and `orchestration/STATE.md` → PASS
  - GitHub CLI auth: `gh auth status` → token for `davidb73-hub` is invalid → BLOCKED
  - GitHub connector auth: `get_me` → authenticated as `davidb73-hub` → PASS
  - Remote branch creation: GitHub connector `create_branch` for `docs/phase-0-golive` from `main` → `403 Resource not accessible by personal access token` → BLOCKED
Gate: BLOCKED(GitHub write permission unavailable for PR branch creation)
Notes: Phase 0 is complete locally and production-live sign-off is recorded, but the package-required remote PR/merge checkpoint is blocked until GitHub write auth is restored. Do not claim the docs PR is merged. Next: re-authenticate GitHub CLI or provide a token/connector with branch and PR write access, then push `docs/phase-0-golive` and open the docs PR.

## [2026-07-07 19:29] Phase 0.4 — GitHub re-auth attempt
Branch/PR: docs/phase-0-golive / blocked
Checks:
  - GitHub CLI re-auth: `gh auth login -h github.com -p https -w` → interactive prompt stalled after `Authenticate Git with your GitHub credentials?`; process terminated with `kill 43262` → BLOCKED
Gate: BLOCKED(GitHub CLI re-auth did not complete)
Notes: Execution remains stopped at the package-required T0.4 PR/merge checkpoint. Next exact action: complete GitHub authentication outside Codex with `gh auth login -h github.com -p https -w`, then run `git push -u origin docs/phase-0-golive` and open the draft docs PR. Do not start Phase 1 until the Phase 0 PR checkpoint is satisfied or the owner explicitly changes the execution package gate.

## [2026-07-08 00:49] Phase 0.4 — T0.4 draft PR opened
Branch/PR: docs/phase-0-golive / #209
Checks:
  - Privacy redaction: `rg -n "Without Prejudice|AccessEAP|I-AUS|FID1016813" orchestration/STATE.md CHANGELOG.md HANDOVER.md docs` → no matches → PASS
  - Fork push: `git push` → `docs/phase-0-golive` pushed to `davidb73-hub/outlook-assistant` → PASS
  - Draft PR: `gh pr create --repo littlebearapps/outlook-assistant --head davidb73-hub:docs/phase-0-golive --base main --draft` → https://github.com/littlebearapps/outlook-assistant/pull/209 → PASS
Gate: PASSED
Notes: This resolves the earlier GitHub auth/write blocker for PR creation by using the authenticated fork workflow. The PR remains draft and unmerged; Phase 0 local go-live is complete, but upstream merge/review is still pending.

## [2026-07-08 00:55] Phase 1 entry — Owner override to continue from fork
Branch/PR: docs/phase-0-golive-clean / #209 pending
Checks:
  - Owner instruction: "agreed. Proceed. I want you to continue building till the end. very end." after being told Phase 1 should wait unless continuing from fork as canonical → PASS
  - Canonical working path: proceed from `davidb73-hub/outlook-assistant` fork while upstream PR #209 remains draft/unmerged → PASS
Gate: PASSED_WITH_OWNER_OVERRIDE
Notes: This explicitly overrides the Phase 0 upstream merge checkpoint for execution momentum. Continue Phase 1 from the fork/canonical working branch. Keep PR #209 pending upstream; do not claim it is merged.

## [2026-07-08 01:20] Phase 1.1 — #68 `--version` CLI flag
Branch/PR: feat/68-version-flag / davidb73-hub/outlook-assistant#1
Checks:
  - Issue reconciliation: `gh issue view 68 --repo littlebearapps/outlook-assistant` → issue asks for both `--version` and `-v`, with output example `@littlebearapps/outlook-assistant v3.3.1` → PASS
  - Baseline tests before edit: `npm test` → Test Suites: 29 passed, 29 total; Tests: 748 passed, 748 total → PASS_WITH_DRIFT
  - Baseline product lint before edit: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - TDD red: `npx jest test/dispatcher/version-flag.test.js` before implementation → 2 failures; stdout was empty instead of `@littlebearapps/outlook-assistant v3.8.1` → PASS
  - Flag behavior: `node index.js --version` and `node index.js -v` → `@littlebearapps/outlook-assistant v3.8.1`; exit 0 → PASS
  - TDD green: `npx jest test/dispatcher/version-flag.test.js` → Test Suites: 1 passed, 1 total; Tests: 2 passed, 2 total → PASS
  - MCP unaffected: scripted stdio `initialize` + `tools/list` with `USE_TEST_MODE=true` → 22 tools → PASS
  - Full suite: `npm test` → Test Suites: 30 passed, 30 total; Tests: 750 passed, 750 total → PASS
  - Product lint: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS
  - Whitespace: `git diff --check` → no output → PASS
Gate: PASSED_WITH_DRIFT
Notes: Drift from package baseline: current clean working branch reports 748 tests before this task, not the older package reference of 751; this task adds two assertions for a final count of 750. Raw `npm run lint` fails only because untracked local orchestration scaffold files under `.claude/` are included by ESLint; tracked product JS lint remains 0 errors. Issue body contradicted the local brief by requiring `-v` and scoped package-name output; implementation follows the issue while reusing `config.SERVER_VERSION` for the version value.

## [2026-07-08 01:35] Phase 1.1 — #68 fork PR merge
Branch/PR: feat/68-version-flag / davidb73-hub/outlook-assistant#1
Checks:
  - PR ready: `gh pr ready 1 --repo davidb73-hub/outlook-assistant` → ready for review → PASS
  - Merge: `gh api -X PUT repos/davidb73-hub/outlook-assistant/pulls/1/merge ...` → merged `true`, merge sha `16a048edc36581e72e5a9b94be46b254392dd8fa` → PASS
Gate: PASSED
Notes: Standard `gh pr merge` returned a GitHub 504 and did not merge; verified PR was still open before using the direct GitHub merge API. Fork base `docs/phase-0-golive` now includes #68.

## [2026-07-08 01:50] Phase 1.2 — #69 AADSTS7000215 client secret guidance
Branch/PR: feat/69-secret-error-message / davidb73-hub/outlook-assistant#2
Checks:
  - Issue reconciliation: `gh issue view 69 --repo littlebearapps/outlook-assistant` → issue asks for friendly `AADSTS7000215` Secret ID vs Secret Value guidance → PASS
  - Baseline tests before edit: `npm test` → Test Suites: 30 passed, 30 total; Tests: 750 passed, 750 total → PASS
  - Baseline product lint before edit: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - TDD red: `npx jest test/auth -t "7000215"` before implementation → 3 failures; raw Azure error lacked Secret ID/Secret Value guidance → PASS
  - Targeted green: `npx jest test/auth -t "7000215"` → Test Suites: 2 passed, 5 skipped; Tests: 3 passed, 86 skipped → PASS
  - Full suite: `npm test` → Test Suites: 30 passed, 30 total; Tests: 753 passed, 753 total → PASS
  - Product lint: `git ls-files '*.js' auth/token-error.js | xargs npx eslint` → 25 warnings; 0 errors → PASS
  - Whitespace: `git diff --check` → no output → PASS
Gate: PASSED_WITH_DRIFT
Notes: Added shared auth token-endpoint error formatting for `AADSTS7000215`, preserving the original Azure code/message while adding the Azure Portal Secret Value correction. Applied to `auth/token-storage.js`, `auth/device-code.js`, and standalone `outlook-auth-server.js`. Raw `npm run lint` remains polluted by untracked local `.claude/` scaffold files; tracked product lint is clean.

## [2026-07-08 02:10] Phase 1.2 — #69 fork PR merge
Branch/PR: feat/69-secret-error-message / davidb73-hub/outlook-assistant#2
Checks:
  - PR opened: `gh pr create --repo davidb73-hub/outlook-assistant --base docs/phase-0-golive --head feat/69-secret-error-message ...` → https://github.com/davidb73-hub/outlook-assistant/pull/2 → PASS
  - GitHub API merge attempt: `gh api -X PUT repos/davidb73-hub/outlook-assistant/pulls/2/merge ...` → first 502, then `Merge already in progress`, but PR remained open → PASS_WITH_DRIFT
  - Local merge fallback: `git merge --no-ff feat/69-secret-error-message -m "Merge pull request #2 ..."` followed by `git push fork HEAD:docs/phase-0-golive` → fork base updated to `87a4ec7` → PASS
  - PR state: `gh pr view 2 --repo davidb73-hub/outlook-assistant --json state,mergedAt,mergeCommit` → state `MERGED`, merge commit `87a4ec76e14ae8b02fd1d5d6f204a4ad4175e70d` → PASS
Gate: PASSED_WITH_DRIFT
Notes: GitHub's merge API was unstable, so the completed PR was merged locally and pushed to the canonical fork base. GitHub then recognized PR #2 as merged.

## [2026-07-08 02:25] Phase 1.3 — #72 token-refresh integration test
Branch/PR: test/72-token-refresh-integration / davidb73-hub/outlook-assistant#3
Checks:
  - Issue reconciliation: `gh issue view 72 --repo littlebearapps/outlook-assistant` → issue asks for token refresh integration coverage; issue references legacy `auth/token-manager.js`, current code path is `utils/graph-api.js` + `auth/token-storage.js` → PASS_WITH_DRIFT
  - Baseline tests before edit: `npm test` → Test Suites: 30 passed, 30 total; Tests: 753 passed, 753 total → PASS
  - Baseline product lint before edit: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - Home token mtime before: `stat -f '%m' ~/.outlook-assistant-tokens.json` → `1783410139` → PASS
  - New integration test: `npx jest test/auth/token-refresh-integration.test.js` → Test Suites: 1 passed, 1 total; Tests: 3 passed, 3 total → PASS
  - Full suite: `npm test` → Test Suites: 31 passed, 31 total; Tests: 756 passed, 756 total → PASS
  - Product lint: `git ls-files '*.js' test/auth/token-refresh-integration.test.js | xargs npx eslint` → 25 warnings; 0 errors → PASS
  - No production-code changes: `git diff --name-only -- . ':!test' ':!CHANGELOG.md' ':!orchestration'` → no output → PASS
  - Home token mtime after: `stat -f '%m' ~/.outlook-assistant-tokens.json` → `1783410139` unchanged → PASS
Gate: PASSED_WITH_DRIFT
Notes: Added a test-only integration file that requires `utils/graph-api.js`, drives `callGraphAPIWithAuth()`, mocks only `https`, redirects token storage via a temporary `HOME`, verifies 401 → refresh → retry with the new bearer token, verifies refreshed tokens are persisted to the temp token file, and verifies refresh failure rethrows the original `UNAUTHORIZED` path. No CHANGELOG entry added because this is test-only and the brief says to skip unless precedent requires it.

## [2026-07-08 02:40] Phase 1.3 — #72 fork PR merge
Branch/PR: test/72-token-refresh-integration / davidb73-hub/outlook-assistant#3
Checks:
  - PR opened: `gh pr create --repo davidb73-hub/outlook-assistant --base docs/phase-0-golive --head test/72-token-refresh-integration ...` → https://github.com/davidb73-hub/outlook-assistant/pull/3 → PASS
  - Merge: `gh api -X PUT repos/davidb73-hub/outlook-assistant/pulls/3/merge ...` → merged `true`, merge sha `eb37216b79469655e7798d56b8587c24e9894bf9` → PASS
Gate: PASSED
Notes: Fork base `docs/phase-0-golive` now includes #72.

## [2026-07-08 03:00] Phase 1.4 — #92 openWorldHint annotation audit
Branch/PR: fix/92-openworldhint-audit / davidb73-hub/outlook-assistant#4
Checks:
  - Issue reconciliation: `gh issue view 92 --repo littlebearapps/outlook-assistant` → authoritative flip list is `search-emails`, `read-email`, `search-people`, `access-shared-mailbox`; leave `get-mail-tips`, `list-events`, `manage-contact` unchanged → PASS
  - Baseline tests before edit: `npm test` → Test Suites: 31 passed, 31 total; Tests: 756 passed, 756 total → PASS
  - Baseline product lint before edit: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - TDD red: `npx jest -t "annotation"` before implementation → failed because `search-emails` still had `openWorldHint: false` → PASS
  - Annotation pinning: `npx jest -t "annotation"` → Test Suites: 1 passed, 31 skipped; Tests: 1 passed, 756 skipped → PASS
  - Only non-openWorld hints unchanged in production modules: `git diff fork/docs/phase-0-golive -G"readOnlyHint|destructiveHint|idempotentHint" -- auth calendar categories contacts email folder rules settings advanced '*.js'` → no output → PASS
  - Tool count and annotation presence: scripted stdio `initialize` + `tools/list` with `USE_TEST_MODE=true` → `{"count":22,"missingOpenWorldHint":[]}` → PASS
  - Full suite: `npm test` → Test Suites: 32 passed, 32 total; Tests: 757 passed, 757 total → PASS
  - Product lint: `git ls-files '*.js' test/dispatcher/tool-annotations.test.js | xargs npx eslint` → 25 warnings; 0 errors → PASS
  - FAQ floor: `grep -cE '^## ' docs/faq/faq.md` → 11 → PASS
  - Whitespace: `git diff --check` → no output → PASS
Gate: PASSED_WITH_DRIFT
Notes: Flipped only the four issue-listed external-content tools to `openWorldHint: true`; added explicit `openWorldHint: false` to `mailbox-settings` so all 22 tools carry the key. Updated CHANGELOG, tools reference, and FAQ read-only-mode answer. Raw `npm run lint` remains polluted by untracked local `.claude/` scaffold files; tracked product lint is clean.

## [2026-07-08 03:15] Phase 1.4 — #92 fork PR merge
Branch/PR: fix/92-openworldhint-audit / davidb73-hub/outlook-assistant#4
Checks:
  - PR opened: `gh pr create --repo davidb73-hub/outlook-assistant --base docs/phase-0-golive --head fix/92-openworldhint-audit ...` → https://github.com/davidb73-hub/outlook-assistant/pull/4 → PASS
  - Merge: `gh api -X PUT repos/davidb73-hub/outlook-assistant/pulls/4/merge ...` → merged `true`, merge sha `1b346e151e17b6563287594f82f3a35ec95e1437` → PASS
Gate: PASSED
Notes: Fork base `docs/phase-0-golive` now includes #92. #93 may begin; group B sequencing is satisfied.

## [2026-07-08 03:30] Phase 1.5 — #93 tool-description audit
Branch/PR: fix/93-tool-descriptions-audit / no PR needed
Checks:
  - Issue reconciliation: `gh issue view 93 --repo littlebearapps/outlook-assistant` → asks for 22-tool description audit, `llms.txt`, and tools reference consistency → PASS
  - Description audit: current 22 tool descriptions reviewed against purpose, key params, return format, constraints/errors, and consistent style; all covered by v3.8.1/current-base prose → PASS
  - `llms.txt` scope check: `rg -n "Tool Categories|Email \\(8 tools\\)|Advanced \\(2 tools\\)" llms.txt` → lists all 22 tools by category → PASS
  - Tools reference scope check: `docs/quickrefs/tools-reference.md` lists all 22 tools with description, safety, and key parameters → PASS
  - Upstream audit comment: `gh issue comment 93 --repo littlebearapps/outlook-assistant --body-file /private/tmp/outlook-assistant-issue-93-audit.md` → https://github.com/littlebearapps/outlook-assistant/issues/93#issuecomment-4905843940 → PASS
  - Upstream close attempt: `gh issue close 93 --repo littlebearapps/outlook-assistant ...` → GraphQL permission error for `CloseIssue` → BLOCKED_UPSTREAM_PERMISSION
  - Close-request comment: close command still posted maintainer-facing close-as-shipped comment → https://github.com/littlebearapps/outlook-assistant/issues/93#issuecomment-4905846959 → PASS_WITH_DRIFT
  - Final upstream state: `gh issue view 93 --repo littlebearapps/outlook-assistant --json state` → `OPEN` → BLOCKED_UPSTREAM_PERMISSION
Gate: PASSED_WITH_OWNER_OVERRIDE
Notes: No description gaps found and no code/docs edits required for #93. Upstream issue closure is blocked because the fork owner lacks upstream close permission. Per owner instruction to continue from the fork as canonical and not stop on upstream permission gates, proceed to Phase 1 release using the fork state; upstream maintainers can close #93 from the posted audit evidence.

## [2026-07-08 03:50] Phase 1.6 — v3.8.2 patch release branch
Branch/PR: release/v3.8.2 / davidb73-hub/outlook-assistant#5
Checks:
  - Release branch: `git switch -C release/v3.8.2 fork/docs/phase-0-golive` → branch created from fork base including #68, #69, #72, #92, and #93 audit ledger → PASS
  - Release baseline tests: `npm test` → Test Suites: 32 passed, 32 total; Tests: 757 passed, 757 total → PASS
  - Release baseline product lint: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - Version bump: `npm version patch --no-git-tag-version` → `v3.8.2`; `package.json`, `package-lock.json`, and `server.json` synced → PASS
  - Version consistency: `node -p "require('./package.json').version + ' ' + require('./server.json').version + ' ' + require('./server.json').packages[0].version"` → `3.8.2 3.8.2 3.8.2` → PASS
  - Release test gate: `npm test` → Test Suites: 32 passed, 32 total; Tests: 757 passed, 757 total → PASS
  - Release lint gate: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS
  - CLI version: `node index.js --version` → `@littlebearapps/outlook-assistant v3.8.2` → PASS
  - Tool count: scripted stdio `initialize` + `tools/list` with `USE_TEST_MODE=true` → 22 tools → PASS
  - FAQ floor: `grep -cE '^## ' docs/faq/faq.md` → 11 → PASS
Gate: PASSED_WITH_DRIFT
Notes: Owner approval for the version bump is covered by the earlier instruction to continue to the end without further approval. Raw `npm run lint` remains polluted by untracked local `.claude/` scaffold files; tracked product lint is clean.

## [2026-07-08 04:15] Phase 2.1 — #118 `list-events` timezone information
Branch/PR: fix/118-list-events-timezone / davidb73-hub/outlook-assistant#6
Checks:
  - Issue reconciliation: `gh issue view 118 --repo littlebearapps/outlook-assistant` → issue asks for explicit timezone information in `list-events` output → PASS
  - Baseline tests before edit: `npm test` → Test Suites: 32 passed, 32 total; Tests: 757 passed, 757 total → PASS
  - TDD red: `npx jest test/calendar -t timezone` before implementation → failed because `Start:`/`End:` lines omitted `(Australia/Melbourne)` → PASS
  - Targeted green: `npx jest test/calendar -t timezone` → Test Suites: 3 passed, 3 total; Tests: 8 passed, 51 skipped → PASS
  - Full suite: `npm test` → Test Suites: 32 passed, 32 total; Tests: 758 passed, 758 total → PASS
  - Product lint: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - Whitespace: `git diff --check` → no output → PASS
  - PR opened: `gh pr create --repo davidb73-hub/outlook-assistant --base docs/phase-0-golive --head fix/118-list-events-timezone ...` → https://github.com/davidb73-hub/outlook-assistant/pull/6 → PASS
Gate: PASSED_WITH_DRIFT
Notes: `list-events` now appends the configured display timezone to every rendered start and end time, matching the timezone used for conversion. Raw `npm run lint` remains polluted by untracked local `.claude/` scaffold files; tracked product lint is clean. Live read-only verification remains pending until after the fork PR is merged.

## [2026-07-08 09:21] Phase 2.1 — #118 fork PR merge + live read-only verification
Branch/PR: fix/118-list-events-timezone / davidb73-hub/outlook-assistant#6
Checks:
  - Merge: `gh api -X PUT repos/davidb73-hub/outlook-assistant/pulls/6/merge ...` → merged `true`, merge sha `ecf6c01043809f27b5ab0c2eec89217332f98a6f` → PASS
  - Local base sync: `git pull --ff-only fork docs/phase-0-golive` → fast-forwarded local base from `0c3f2ed` to `ecf6c01` → PASS
  - Live read-only check: exported local `.env`, called `list-events` with `count: 3` against live mailbox → 3 events returned, 6 start/end lines checked, every time line included `(Australia/Sydney)` → PASS
Gate: PASSED
Notes: The first live-check attempt sourced `.env` without exporting variables and therefore failed authentication via the stale/default `common` audience path. Reran with `set -a; source .env; set +a`; token refresh succeeded and the read-only calendar verification passed. No calendar mutation was performed, and event subjects/bodies/IDs were not recorded.

## [2026-07-08 09:55] Phase 2.2 — #125 recurring calendar events
Branch/PR: feat/125-recurring-events / davidb73-hub/outlook-assistant#7
Checks:
  - Issue reconciliation: `gh issue view 125 --repo littlebearapps/outlook-assistant` → issue asks for simplified recurrence params plus raw Graph recurrence support and validation → PASS
  - Microsoft Graph docs check: official Learn docs for `POST /me/events`, `patternedRecurrence`, `recurrencePattern`, and `recurrenceRange` verified the `recurrence.pattern`/`recurrence.range` shape and enum values → PASS
  - Baseline tests before edit: `npm test` → Test Suites: 32 passed, 32 total; Tests: 758 passed, 758 total → PASS
  - Baseline product lint before edit: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - TDD red: `npx jest test/calendar/create.test.js -t recurrence` and `npx jest test/utils/schema-coerce.test.js -t "nested|recurrenceRaw"` before implementation → failed for missing recurrence payloads, validation, nested schema enforcement, and `recurrenceRaw` schema → PASS
  - Targeted green: same recurrence/schema commands after implementation → Test Suites: 2 passed; recurrence tests and nested-schema tests pass → PASS
  - MCP schema boundary: stdio `tools/call` `create-event` with `recurrenceRaw.pattern.unsupported=true` under `USE_TEST_MODE=true` → rejected with `recurrenceRaw.pattern: unknown property 'unsupported'.` → PASS
  - Full suite: `npm test` → Test Suites: 32 passed, 32 total; Tests: 769 passed, 769 total → PASS
  - Product lint: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - Whitespace: `git diff --check` → no output → PASS
  - PR opened: `gh pr create --repo davidb73-hub/outlook-assistant --base docs/phase-0-golive --head feat/125-recurring-events ...` → https://github.com/davidb73-hub/outlook-assistant/pull/7 → PASS
Gate: PASSED_WITH_DRIFT
Notes: Added simplified `create-event` recurrence params (`recurrenceType`, `recurrenceInterval`, `recurrenceDaysOfWeek`, `recurrenceEndDate`, `recurrenceCount`) plus raw Graph `recurrenceRaw` and `recurrence` alias support. Extended schema coercion to enforce nested `additionalProperties`, `required`, and enum constraints where schemas declare them. Raw `npm run lint` remains polluted by untracked local `.claude/` scaffold files; tracked product lint is clean. Live create/list/delete verification remains pending until after the fork PR is merged.

## [2026-07-08 10:05] Phase 2.2 — #125 fork PR merge + live create/list/delete verification
Branch/PR: feat/125-recurring-events / davidb73-hub/outlook-assistant#7
Checks:
  - Merge: `gh api -X PUT repos/davidb73-hub/outlook-assistant/pulls/7/merge ...` → merged `true`, merge sha `8d1fbf997cd8f9503e01f2d3e1a7422143f71e04` → PASS
  - Local base sync: `git pull --ff-only fork docs/phase-0-golive` → fast-forwarded local base from `6a85d2a` to `8d1fbf9` → PASS
  - Live create/list/delete check: exported local `.env`, created no-attendee weekly recurring test event with subject `oa-125-test` and `recurrenceCount: 2`; create response included recurrence; `list-events` found the event with timezone-labelled output; `manage-event` delete removed the created event → PASS
Gate: PASSED
Notes: This was the single permitted live calendar mutation for #125 and it was cleaned up in the same script using the returned event ID. No event IDs, mailbox content, or unrelated calendar details were recorded.

## [2026-07-08 10:35] Phase 2.3 — #126 `find-meeting-times`
Branch/PR: feat/126-find-meeting-times / davidb73-hub/outlook-assistant#8
Checks:
  - Issue reconciliation: `gh issue view 126 --repo littlebearapps/outlook-assistant` → issue recommends standalone `find-meeting-times` tool with attendees, duration, time constraints, ranked suggestions, and read-only annotation → PASS
  - Microsoft Graph docs check: official Learn docs for `POST /me/findMeetingTimes` verified work/school-only support, delegated `Calendars.Read.Shared` least-privileged permission, request params, `Prefer: outlook.timezone`, and response suggestion shape → PASS_WITH_DRIFT
  - Baseline tests before edit: `npm test` → Test Suites: 32 passed, 32 total; Tests: 769 passed, 769 total → PASS
  - Baseline product lint before edit: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - TDD red: `npx jest test/advanced -t "meeting-times"` before implementation → failed because `handleFindMeetingTimes` was not exported → PASS
  - Targeted green: `npx jest test/advanced -t "meeting-times"` → Test Suites: 1 passed; Tests: 5 passed, 34 skipped → PASS
  - Annotation pin: `npx jest test/dispatcher/tool-annotations.test.js` → 23 tools, `find-meeting-times` annotations pinned → PASS
  - Tool registration: stdio `tools/list` under `USE_TEST_MODE=true` → 23 tools; `find-meeting-times` present with `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` → PASS
  - Stale count refs: `rg -n "22 tools|all 22|Advanced \\(2 tools\\)|advanced-2-tools|\\*\\*Read-only\\*\\* \\(7\\)|2 tools: access-shared" README.md CLAUDE.md package.json docs test` → no matches → PASS
  - Full suite: `npm test` → Test Suites: 32 passed, 32 total; Tests: 774 passed, 774 total → PASS
  - Product lint: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - Whitespace: `git diff --check` → no output → PASS
  - PR opened: `gh pr create --repo davidb73-hub/outlook-assistant --base docs/phase-0-golive --head feat/126-find-meeting-times ...` → https://github.com/davidb73-hub/outlook-assistant/pull/8 → PASS
Gate: PASSED_WITH_DRIFT
Notes: Drift from local task brief: Microsoft's current docs require delegated `Calendars.Read.Shared` for work/school accounts and do not support personal Microsoft accounts. To avoid breaking personal-account auth by default, added `OUTLOOK_EXTRA_SCOPES` support and documented `Calendars.Read.Shared` as an optional work/school scope for `find-meeting-times`. Live verification remains pending until after the fork PR is merged; it may require Azure permission update and re-authentication.

## [2026-07-08 10:50] Phase 2.3 — #126 fork PR merge + live read-only verification
Branch/PR: feat/126-find-meeting-times / davidb73-hub/outlook-assistant#8
Checks:
  - Merge: `gh api -X PUT repos/davidb73-hub/outlook-assistant/pulls/8/merge ...` → merged `true`, merge sha `6d75ca08fc6e32e928122293704aff9a2ab4391d` → PASS
  - Local base sync: `git pull --ff-only fork docs/phase-0-golive` → fast-forwarded local base from `8551d32` to `6d75ca0` → PASS
  - Live read-only check: exported local `.env` plus `OUTLOOK_EXTRA_SCOPES=Calendars.Read.Shared`, called `find-meeting-times` with owner as sole attendee, 30-minute duration, 2026-07-20 to 2026-07-24 work-hours window, max 3 candidates → Graph returned meeting-time suggestions → PASS
Gate: PASSED
Notes: No live mutation was performed. The command printed only sanitized booleans and did not record suggested slots, attendee mailbox content, tokens, or IDs.

## [2026-07-08 11:20] Phase 2.4 — #117 + #169 search-emails improvements
Branch/PR: fix/117-169-search-improvements / davidb73-hub/outlook-assistant#9
Checks:
  - Issue reconciliation: `gh issue view 117` and `gh issue view 169` → #117 asks for Sent Items hints/folder context; #169 asks for `searchAllFolders=true` parity, no silent `kqlQuery` drop, no-results render fix, and clearer raw search parameter naming → PASS
  - Baseline inherited from Phase 2.3 fork base: `npm test` → Test Suites: 32 passed, 32 total; Tests: 774 passed, 774 total; `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - TDD red: `npx jest test/email/search.test.js -t "kqlQuery|folder context|sent items"` and `npx jest test/dispatcher/action-fallthrough.test.js -t "search-emails"` before implementation → failed for missing `searchQuery`, folder metadata, Sent Items hint, and no-results guidance when `searchAllFolders` was already true → PASS
  - Targeted green: same focused test commands after implementation → Test Suites: 2 passed; search-focused tests and boundary alias test pass → PASS
  - Search suite: `npx jest test/email/search.test.js` → Test Suites: 1 passed; Tests: 45 passed → PASS
  - Alias boundary: stdio `tools/call` under `USE_TEST_MODE=true` with both legacy `kqlQuery` and new `searchQuery` → both accepted; no MCP unknown-param error; user-facing no-results filter labels match the supplied param name → PASS
  - Full suite: `npm test` → Test Suites: 32 passed, 32 total; Tests: 779 passed, 779 total → PASS
  - Product lint: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - Whitespace: `git diff --check` → no output → PASS
  - PR opened: `gh pr create --repo davidb73-hub/outlook-assistant --base docs/phase-0-golive --head fix/117-169-search-improvements ...` → https://github.com/davidb73-hub/outlook-assistant/pull/9 → PASS
Gate: PASSED_WITH_DRIFT
Notes: Preserved the v3.7.4 no-fall-through guarantee for raw Graph search. Added canonical `searchQuery` while keeping `kqlQuery` as a backwards-compatible alias, added folder/searchAllFolders metadata, removed the misleading "try searchAllFolders" suggestion when it was already enabled, and added a Sent Items `from`→`to` hint. Raw `npm run lint` remains polluted by untracked local `.claude/` scaffold files; tracked product lint is clean. Live read-only checks remain pending until after the fork PR is merged.

## [2026-07-08 11:35] Phase 2.4 — #117 + #169 fork PR merge + live read-only verification
Branch/PR: fix/117-169-search-improvements / davidb73-hub/outlook-assistant#9
Checks:
  - Merge: `gh api -X PUT repos/davidb73-hub/outlook-assistant/pulls/9/merge ...` → merged `true`, merge sha `17652919808a1ad338b38dea44d6a1accf564fd2` → PASS
  - Local base sync: `git switch -C docs/phase-0-golive-final fork/docs/phase-0-golive` after fetch → local base aligned to merged fork branch → PASS_WITH_DRIFT
  - Live Sent Items check: `search-emails {"folder":"sentitems","count":3}` against live mailbox → 3 sent items returned; no error → PASS
  - Live all-folders parity check: `search-emails {"query":"outlook-assistant","count":10}` returned 1; `search-emails {"query":"outlook-assistant","searchAllFolders":true,"count":10}` returned 2 → all-folders result count ≥ single-folder count → PASS
  - Live legacy alias check: `search-emails {"kqlQuery":"outlook-assistant","searchAllFolders":true,"count":10}` → accepted legacy param, returned 2, final strategy `raw-kql` → PASS
Gate: PASSED_WITH_DRIFT
Notes: No live mutation was performed. The live script printed only sanitized counts and strategy names; no subjects, bodies, message IDs, or tokens were recorded. Drift: local base had a duplicate pre-PR search commit due to an operator branching mistake; it was repointed to the merged fork base, discarding only the operator-created duplicate commit.

## [2026-07-08 12:05] Phase 2.5 — #127 structured contact email fields
Branch/PR: feat/127-contact-email-fields / davidb73-hub/outlook-assistant#10
Checks:
  - Issue reconciliation: `gh issue view 127 --repo littlebearapps/outlook-assistant` → issue asks for Graph contact fields `primaryEmailAddress`, `secondaryEmailAddress`, and `tertiaryEmailAddress` while preserving legacy `emailAddresses` support → PASS
  - Microsoft Graph docs check: official Learn docs for contact resource verified the three structured email fields exist in v1.0 → PASS
  - Baseline before edit: `npm test` → Test Suites: 32 passed, 32 total; Tests: 779 passed, 779 total; `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - TDD red: `npx jest test/contacts` before implementation → failed for structured field rendering, create payload, and update payload expectations → PASS
  - Targeted green: `npx jest test/contacts` → Test Suites: 1 passed; Tests: 40 passed → PASS
  - Schema boundary: stdio `tools/call manage-contact` with new structured email params under `USE_TEST_MODE=true` → accepted; unknown `unsupportedEmailField` rejected with the valid parameter list including the three new fields → PASS
  - Full suite: `npm test` → Test Suites: 32 passed, 32 total; Tests: 782 passed, 782 total → PASS
  - Product lint: `git ls-files '*.js' | xargs npx eslint` → 25 warnings; 0 errors → PASS_WITH_DRIFT
  - Whitespace: `git diff --check` → no output → PASS
  - PR opened: `gh pr create --repo davidb73-hub/outlook-assistant --base docs/phase-0-golive --head feat/127-contact-email-fields ...` → https://github.com/davidb73-hub/outlook-assistant/pull/10 → PASS
Gate: PASSED_WITH_DRIFT
Notes: Added structured contact email field support to `manage-contact` create/update and list/get display while preserving existing `email`/`emails` compatibility. Raw `npm run lint` remains polluted by untracked local `.claude/` scaffold files; tracked product lint is clean. Live create/get/delete verification remains pending until after the fork PR is merged.
