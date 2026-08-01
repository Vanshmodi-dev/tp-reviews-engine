#!/usr/bin/env bash
# Assemble the TP AI Development Playbook parts into a single document.
# Usage: bash scripts/build-playbook.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="docs/TP-AI-Development-Playbook-v1.0.md"
: > "$OUT"
for f in docs/playbook/*.md; do
  cat "$f" >> "$OUT"
  printf '\n\n---\n\n' >> "$OUT"
done
printf 'Assembled %s\n' "$OUT"
wc -c "$OUT"
