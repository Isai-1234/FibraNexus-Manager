#!/usr/bin/env bash
# Sincroniza Codespaces / clones con origin/main (merge, sin git config global)
set -e
git fetch origin main
if git pull --no-rebase origin main; then
  echo "✓ Sincronizado con origin/main"
  exit 0
fi
echo "⚠ Ramas divergentes — alineando con GitHub (origin/main)..."
git stash push -u -m "pre-sync-$(date +%s)" 2>/dev/null || true
git reset --hard origin/main
echo "✓ Reset a origin/main. Cambios locales guardados en stash si los había."
