#!/usr/bin/env bash
# Assemble the TRD parts into a single document.
# Usage: bash scripts/build-trd.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="docs/TP-Reviews-Engine-TRD-v1.0.md"
: > "$OUT"
for f in docs/trd/*.md; do
  cat "$f" >> "$OUT"
  printf '\n\n---\n\n' >> "$OUT"
done
printf 'Assembled %s\n' "$OUT"
wc -c "$OUT"
