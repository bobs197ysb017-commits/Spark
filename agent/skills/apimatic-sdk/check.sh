#!/usr/bin/env bash
# apimatic-sdk skill regression checks (APIMatic CLI v2 / docs.apimatic.io/v4)
# Run from the repo root: bash skills/apimatic-sdk/check.sh
#
# For AI evals, see: skills/apimatic-sdk/evals/README.md

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0

pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
separator() { echo ""; echo "--- $1 ---"; }

FILES=("$SKILL_DIR/SKILL.md" "$SKILL_DIR"/references/*.md "$SKILL_DIR"/examples/*.md "$SKILL_DIR"/scripts/*.mjs)
INSTALL_CMD="(npm (install|i|update|up|upgrade)|npx)( -[-[:alnum:]]+)* [\"']?"
# An install with no version: on Node older than 24, npm resolves it to CLI v1.
BARE_INSTALL="${INSTALL_CMD}@apimatic/cli([^-_@[:alnum:]/]|$)"
V2_INSTALL="npm install -g @apimatic/cli@2([^[:alnum:].]|$)"
PRERELEASE_INSTALL="${INSTALL_CMD}@apimatic/cli@((beta|latest|next)\b|[0-9]+\.[0-9]+\.[0-9]+-)"

# ─────────────────────────────────────────────
separator "Node.js 24+ and @apimatic/cli"

if grep -qE "Node(\.js)? 24|v24" "$SKILL_DIR/SKILL.md"; then
  pass "SKILL.md: requires Node 24"
else
  fail "SKILL.md: Node 24 requirement missing"
fi

if grep -nE "Node(\.js)? (16|18|20)(\+| or (higher|later))|>= ?(16|18|20)\b|v20\.x" "${FILES[@]}" > /dev/null 2>&1; then
  fail "An old Node.js requirement (16/18/20) is still present"
else
  pass "No old Node.js requirements"
fi

if grep -qE "$PRERELEASE_INSTALL" "${FILES[@]}"; then
  fail "An install/npx command pins @apimatic/cli to @beta, @latest, @next or a prerelease"
  grep -nE "$PRERELEASE_INSTALL" "${FILES[@]}" || true
else
  pass "No install/npx command pins @apimatic/cli to @beta, @latest, @next or a prerelease"
fi

if grep -qE "$BARE_INSTALL" "${FILES[@]}"; then
  fail "An install/npx command has no version, which installs CLI v1 on Node older than 24"
  grep -nE "$BARE_INSTALL" "${FILES[@]}" || true
else
  pass "Every install/npx command pins a version"
fi

if grep -qE "$V2_INSTALL" "$SKILL_DIR/SKILL.md"; then
  pass "SKILL.md: install command is npm install -g @apimatic/cli@2"
else
  fail "SKILL.md: npm install -g @apimatic/cli@2 missing"
fi

# ─────────────────────────────────────────────
echo ""
echo "════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "REGRESSION DETECTED — $FAIL check(s) failed. Review output above."
  exit 1
else
  echo "All checks passed."
  exit 0
fi
