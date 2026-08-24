#!/usr/bin/env bash
# Public-repo scrub gate. This repository is published, so nothing here may
# carry a private address, a home path, key material, or a machine-local
# hostname. Run it before every commit; verify.sh runs it too.
#
# This file excludes itself from the scan (it necessarily contains the
# patterns it looks for). Extra, site-specific patterns can live in an
# untracked .scrub-denylist file — one extended-regex per line, # for
# comments — so private names never enter the public history.
set -uo pipefail

cd "$(dirname "$0")/.."

SELF="scripts/scrub-check.sh"
failed=0

# Tracked files plus new files that are not ignored: what a commit could carry.
mapfile -t FILES < <(git ls-files --cached --others --exclude-standard | grep -v "^${SELF}$")

if [ ${#FILES[@]} -eq 0 ]; then
  echo "scrub-check: no files to scan"
  exit 0
fi

report() {
  echo "scrub-check FAIL: $1"
  printf '%s\n' "$2" | sed 's/^/  /'
  failed=1
}

scan() {
  local label="$1" pattern="$2"
  local hits
  hits=$(grep -InIE -- "$pattern" "${FILES[@]}" 2>/dev/null)
  if [ -n "$hits" ]; then
    report "$label" "$hits"
  fi
}

# 1. RFC1918 addresses. Documentation uses localhost or 192.0.2.x (TEST-NET-1).
scan "private LAN address" \
  '\b(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})\b'

# 2. Absolute home directories give away a username and a machine layout.
scan "absolute home path" '(/home/[A-Za-z0-9._-]+|/Users/[A-Za-z0-9._-]+)'

# 3. Machine-local hostnames.
scan "machine-local hostname" '[A-Za-z0-9-]+\.(local|lan|internal)\b'

# 4. Key material.
scan "private key block" '[-]----BEGIN [A-Z ]*PRIVATE KEY'
scan "credential-shaped token" '\b(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,})\b'

# 5. Site-specific patterns, kept out of the public tree.
if [ -f .scrub-denylist ]; then
  while IFS= read -r pattern; do
    [ -z "$pattern" ] && continue
    case "$pattern" in \#*) continue ;; esac
    scan "denylisted term" "$pattern"
  done < .scrub-denylist
fi

# 6. Files that must never be committed, whatever they contain.
forbidden=$(printf '%s\n' "${FILES[@]}" | grep -E '(\.db|\.sqlite[^/]*|\.log|ledger\.jsonl)$|^(node_modules|dist|coverage)/' || true)
if [ -n "$forbidden" ]; then
  report "file that must never be committed" "$forbidden"
fi

if [ "$failed" -ne 0 ]; then
  echo "scrub-check: FAILED — fix the findings above before committing."
  exit 1
fi

echo "scrub-check: clean (${#FILES[@]} files)"
