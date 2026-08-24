#!/usr/bin/env bash
# The whole gate, in one command: types, tests, public-repo scrub, and the
# README quickstart lint. Every phase ends with this green.
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n=== %s ===\n' "$1"; }

step "typecheck"
pnpm typecheck

step "test"
pnpm test

step "scrub-check"
bash scripts/scrub-check.sh

step "README quickstart lint"
if [ ! -f README.md ]; then
  echo "README.md is not written yet (SPEC.md feature 9) — lint skipped."
else
  missing=0
  for needle in "## Quickstart" "pnpm install" "curl" "cancel"; do
    if ! grep -qF -- "$needle" README.md; then
      echo "README.md is missing: $needle"
      missing=1
    fi
  done
  if [ "$missing" -ne 0 ]; then
    echo "README quickstart lint: FAILED"
    exit 1
  fi
  echo "README quickstart lint: ok"
fi

printf '\nverify: all gates green\n'
