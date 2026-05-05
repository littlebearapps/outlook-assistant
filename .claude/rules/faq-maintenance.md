# FAQ Maintenance Policy

`docs/faq/index.md` is the upstream content source for the marketing-site help-centre FAQPage JSON-LD pipeline. The marketing site (`littlebearapps/littlebearapps.com`) syncs from this file via `scripts/docs-sync.config.ts` and emits `<script type="application/ld+json">` `FAQPage` blocks on the rendered page. Removing or truncating the file breaks the site build.

The file is enforced by `.claude/hooks/faq-protection.sh` which blocks deletion via Bash and rejects Writes that drop below the minimum question count. **Update — never delete.**

## What's protected

| Operation | Protection |
|-----------|------------|
| `rm docs/faq/index.md` (any flags) | **Blocked** at PreToolUse (Bash) |
| `rm -rf docs/faq/` | **Blocked** at PreToolUse (Bash) |
| `mv docs/faq/...` to anywhere | **Blocked** at PreToolUse (Bash) |
| `git rm` / `git mv` of the file or directory | **Blocked** at PreToolUse (Bash) |
| `Write docs/faq/index.md` with fewer than 7 `## ` headings | **Blocked** at PreToolUse (Write) |
| `Edit docs/faq/index.md` | Pass-through — use Edit for revisions |

## When to update the FAQ

Review the FAQ at every release for accuracy and additions. The trigger checklist:

- **New tool added or removed** → update the "What you can do" / installation answers if relevant.
- **Auth flow change** (device code, browser, scopes, token handling) → update questions 3, 4, 7 (permissions, tokens, device-vs-browser).
- **New safety controls** (rate limit, allowlist, dryRun additions, MCP annotations) → update the read-only-mode answer.
- **Account-compatibility shift** (new feature gated to M365, new personal-account caveat) → update the personal-account answer.
- **Privacy / data-flow change** → update the "Will Outlook Assistant send my email content..." answer.
- **Install/update/uninstall procedure change** (new client config, new env var, package rename) → update questions 1, 8, 9.
- **Major version bumps** (3.x → 4.x) — review every question end to end.

## Quality bar

- ≥7 question-shaped `## ` H2 headings (the hook enforces this floor; the current file has 11).
- Each H2 phrased as a question — ends with `?` or starts with How / What / Why / When / Where / Can / Do / Does / Is / Are / Should / Will.
- Every question has a complete answer — no `TODO`, no `[placeholder]`, no `(coming soon)`.
- Prefer concrete, link-rich answers over hand-waving — AI citations work better with crisp facts pointing at authoritative locations (README sections, CHANGELOG, ROADMAP, troubleshooting).
- Keep tone consistent with the rest of the docs: pragmatic, second-person, no marketing fluff.

## How to revise

For typo fixes or copy tweaks, use **Edit** with `old_string` / `new_string`. For replacing a whole question, use Edit on the full Q&A block (from the `## ` line to the next `## ` line or end of file).

If you legitimately need to rewrite the whole file (e.g. major restructure), preserve at least 7 question-shaped H2s and ensure each has a complete answer before saving — the Write hook will reject anything below that.

## How to legitimately move or delete

If a future restructure genuinely requires moving or removing `docs/faq/index.md`:

1. Land the matching change in `littlebearapps/littlebearapps.com:scripts/docs-sync.config.ts` **first** (or simultaneously) so the site sync doesn't hard-fail.
2. Coordinate the deploy windows so neither side ships in isolation.
3. Update or remove this rule and the `.claude/hooks/faq-protection.sh` hook in the same upstream PR that performs the move.

## References

- Issue: [littlebearapps/outlook-assistant#167](https://github.com/littlebearapps/outlook-assistant/issues/167) — original scaffolding ask
- Site-side mapping (pending): `littlebearapps/littlebearapps.com:scripts/docs-sync.config.ts`
- Hook: `.claude/hooks/faq-protection.sh`
- Schema spec: <https://schema.org/FAQPage>
