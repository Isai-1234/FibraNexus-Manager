#!/usr/bin/env bash
# Alinea el clone con GitHub (origin/main). Descarta commits locales divergentes.
set -e
git fetch origin main
git reset --hard origin/main
echo "✓ Alineado con origin/main ($(git rev-parse --short HEAD))"
