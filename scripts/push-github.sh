#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${1:-}"
BRANCH="${2:-main}"

if [[ -z "$REPO_URL" ]]; then
  echo "Usage: ./scripts/push-github.sh https://github.com/USERNAME/REPO.git [branch]"
  exit 1
fi

if [[ ! -d .git ]]; then
  git init
fi

git branch -M "$BRANCH"
git add .
git commit -m "Initial commit: Hermes Router CLI" || true

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

git push -u origin "$BRANCH"
