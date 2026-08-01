#!/usr/bin/env bash
# Assemble the SAD/TDD parts into a single document.
# Usage: bash scripts/build-doc.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="docs/TP-Reviews-Engine-SAD-v1.0.md"
: > "$OUT"
for f in docs/sad/*.md; do
  cat "$f" >> "$OUT"
  printf '\n\n---\n\n' >> "$OUT"
done
printf 'Assembled %s\n' "$OUT"
wc -c "$OUT"
