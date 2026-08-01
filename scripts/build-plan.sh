#!/usr/bin/env bash
# Assemble the Implementation Plan parts into a single document.
# Usage: bash scripts/build-plan.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="docs/TP-Reviews-Engine-IMPL-PLAN-v1.0.md"
: > "$OUT"
for f in docs/plan/*.md; do
  cat "$f" >> "$OUT"
  printf '\n\n---\n\n' >> "$OUT"
done
printf 'Assembled %s\n' "$OUT"
wc -c "$OUT"
