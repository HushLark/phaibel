#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "── Build ──"
npm run build

echo "── Link ──"
npm link

echo "── Stage & Commit ──"
git add -A
MSG="${1:-build: ship $(date +%Y-%m-%d-%H%M%S)}"
git commit -m "$MSG" || echo "Nothing to commit."

echo "── Pull & Push ──"
git pull --rebase origin main
git push origin main

echo "── Done ──"
