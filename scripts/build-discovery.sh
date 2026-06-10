#!/usr/bin/env bash
# Regenerate the LLM-discoverability files.
#
# - llms-full.txt is a concatenation of README + the substantive docs.
# - llms.txt / llms-full.txt are mirrored under docs/ so the GitHub Pages
#   site serves them.
#
# Run after editing README.md or any file under docs/ that should land in
# llms-full.txt:
#
#   pnpm discovery:build
#
# Or directly:
#
#   ./scripts/build-discovery.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

{
  printf '<!--\n  auto-geo — full LLM-ingestible bundle.\n\n  This file concatenates README.md and the substantive docs (concept, SOP,\n  architecture, validation) with H1 boundaries between them so a single\n  fetch ingests the whole project. Source of truth is the linked files;\n  if this drifts, the originals win.\n-->\n\n'
  printf '# README\n\n'
  cat README.md
  printf '\n\n---\n\n# Concept — What is a GEO resource page?\n\n'
  tail -n +2 docs/concept.md
  printf '\n\n---\n\n# GEO Standard Operating Procedure\n\n'
  tail -n +2 docs/sop.md
  printf '\n\n---\n\n# Page architecture\n\n'
  tail -n +2 docs/architecture.md
  printf '\n\n---\n\n# Validation reference\n\n'
  tail -n +2 docs/validation.md
  printf '\n'
} > llms-full.txt

cp llms.txt docs/llms.txt
cp llms-full.txt docs/llms-full.txt

echo "Regenerated llms-full.txt and synced docs/ copies."
