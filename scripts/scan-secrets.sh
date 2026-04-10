#!/usr/bin/env bash
# scripts/scan-secrets.sh
#
# CI lint: reject raw secret patterns in .env and example config files.
# Run in CI before deploy, or locally before committing secrets-adjacent changes.
#
# Exit 0 — clean
# Exit 1 — raw secret pattern detected; see output for offending lines
#
# EXTENDING: add a new pattern to PATTERNS when a new venue introduces a
# key-type secret. Use the raw var name, not the *_PATH var.
# Pattern format: 'VARNAME=<non-empty, non-placeholder value>'

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Files to scan — .env and any committed example/template configs.
# Never scan /opt/bot/secrets or any path outside the repository.
SCAN_TARGETS=(
  "$REPO_ROOT/backend/.env"
  "$REPO_ROOT/backend/.env.example"
)

# Raw secret var names that must NEVER appear with a real value in scanned files.
# A "real value" is anything that is:
#   - not empty
#   - not a placeholder (SET_IN_SERVER_ONLY, ** prefix, <...> angle-bracket template)
PATTERNS=(
  'WALLET_PRIVATE_KEY'
  'TELEGRAM_SESSION'
  'VALIANT_AGENT_KEY'
)

# Placeholder patterns — values matching these are OK (they are intentional stubs)
PLACEHOLDER_RE='(SET_IN_SERVER_ONLY|\*\*|^<|^$)'

found=0

for target in "${SCAN_TARGETS[@]}"; do
  [[ -f "$target" ]] || continue

  for var in "${PATTERNS[@]}"; do
    # Match lines like:  VARNAME=something  (not commented out)
    while IFS= read -r line; do
      # Skip comment lines
      [[ "$line" =~ ^[[:space:]]*# ]] && continue

      # Extract value after the '='
      value="${line#*=}"

      # Skip placeholders
      [[ "$value" =~ $PLACEHOLDER_RE ]] && continue

      echo "[SCAN] RAW SECRET DETECTED in ${target}:"
      echo "       ${line}"
      echo "       → Remove the value; use ${var}_PATH=/opt/bot/secrets/<file> instead."
      found=1
    done < <(grep -n "^${var}=" "$target" 2>/dev/null || true)
  done
done

if [[ $found -eq 1 ]]; then
  echo ""
  echo "[SCAN] FAIL — raw secret(s) found. See above."
  exit 1
fi

echo "[SCAN] OK — no raw secrets detected in scanned files."
exit 0
