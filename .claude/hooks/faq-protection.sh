#!/bin/bash
# faq-protection.sh
# Hook: PreToolUse (Bash, Write, Edit)
# Purpose: Protect docs/faq/index.md from accidental deletion or
#          truncation. The file is the upstream content source for
#          the marketing-site help-centre FAQPage JSON-LD pipeline
#          (littlebearapps/littlebearapps.com#142, this repo's #167).
#          Removing it breaks the site sync at build time. The file
#          should be UPDATED as features ship, not deleted.
#
# Behaviour:
#   - Bash: blocks `rm`, `mv`, `git rm`, `git mv` targeting the FAQ
#           file or its parent directory.
#   - Write: blocks writing empty / trivially short content to the
#           FAQ file (≥7 question-shaped H2s required by #167).
#   - Edit: pass-through, rely on the .claude/rules/faq-maintenance.md
#           guidance.
#
# To override the deletion guard for a legitimate move/rename,
# coordinate with the site-side mapping in
# `littlebearapps/littlebearapps.com:scripts/docs-sync.config.ts`
# *first* and clear this hook in a follow-up.
#
# Claude Code only — other tools do not support Claude Code hooks.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

FAQ_PATH="docs/faq/index.md"
FAQ_DIR="docs/faq"
MIN_QUESTIONS=7

block() {
  # block <reason>
  jq -n --arg reason "$1" '{decision: "block", reason: $reason}'
  exit 1
}

case "$TOOL_NAME" in
  Bash)
    CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
    [ -z "$CMD" ] && echo '{}' && exit 0

    # Strip the contents of quoted strings before pattern matching so
    # benign references like `echo "rm docs/faq/..."`, heredocs in git
    # commit messages, or string literals in scripts don't trigger
    # the guard. Sed pass: remove "..." and '...' bodies (non-greedy,
    # no nested quote handling — fine for the cases we care about).
    STRIPPED=$(printf '%s' "$CMD" | sed -E 's/"[^"]*"//g; s/'"'"'[^'"'"']*'"'"'//g')

    # Anchor destructive verbs at a real shell command boundary:
    # start-of-string, newline, semicolon, pipe, ampersand, or open-paren.
    BOUNDARY='(^|[;|&(]|^|\n)[[:space:]]*'
    FAQ_REF='(docs/faq/index\.md|docs/faq(/|[[:space:]]|$))'

    if echo "$STRIPPED" | grep -qE "${BOUNDARY}rm([[:space:]]+-[a-zA-Z]+)*[[:space:]]+([^|;&]*[[:space:]])?${FAQ_REF}"; then
      block "BLOCKED: $FAQ_PATH (or $FAQ_DIR/) cannot be deleted via Bash. This file is the upstream content source for the marketing-site help-centre FAQPage JSON-LD pipeline (#167). Removing it breaks the site sync at build time. UPDATE the file instead — see .claude/rules/faq-maintenance.md for the policy and update cadence."
    fi
    if echo "$STRIPPED" | grep -qE "${BOUNDARY}mv[[:space:]]+([^|;&]*[[:space:]])?${FAQ_REF}"; then
      block "BLOCKED: refusing to mv $FAQ_PATH (or $FAQ_DIR/) — the marketing-site sync expects the path $FAQ_PATH. If you must move it, update littlebearapps/littlebearapps.com:scripts/docs-sync.config.ts FIRST, then clear this hook. See .claude/rules/faq-maintenance.md."
    fi
    if echo "$STRIPPED" | grep -qE "${BOUNDARY}git[[:space:]]+rm([[:space:]]+-[a-zA-Z]+)*[[:space:]]+([^|;&]*[[:space:]])?${FAQ_REF}"; then
      block "BLOCKED: refusing to \`git rm\` $FAQ_PATH (or $FAQ_DIR/) — see .claude/rules/faq-maintenance.md."
    fi
    if echo "$STRIPPED" | grep -qE "${BOUNDARY}git[[:space:]]+mv[[:space:]]+([^|;&]*[[:space:]])?${FAQ_REF}"; then
      block "BLOCKED: refusing to \`git mv\` $FAQ_PATH (or $FAQ_DIR/) — see .claude/rules/faq-maintenance.md."
    fi
    echo '{}'
    exit 0
    ;;

  Write)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
    [ -z "$FILE_PATH" ] && echo '{}' && exit 0

    case "$FILE_PATH" in
      */"$FAQ_PATH"|"$FAQ_PATH")
        CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null)
        # Count question-shaped H2s in the proposed content.
        # Match lines starting with "## " — close enough for a guard.
        H2_COUNT=$(printf '%s\n' "$CONTENT" | grep -cE '^## ' || true)
        if [ "${H2_COUNT:-0}" -lt "$MIN_QUESTIONS" ]; then
          block "BLOCKED: $FAQ_PATH must have at least $MIN_QUESTIONS question-shaped H2 headings (found ${H2_COUNT:-0} in proposed Write). The file feeds the marketing-site help-centre FAQPage JSON-LD pipeline; trimming below the threshold downgrades AI-citation surface and may break the schema (#167). UPDATE the file (Edit) to revise specific Q&A pairs rather than overwriting the whole file. See .claude/rules/faq-maintenance.md for the policy."
        fi
        ;;
    esac
    echo '{}'
    exit 0
    ;;

  *)
    echo '{}'
    exit 0
    ;;
esac
