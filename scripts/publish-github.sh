#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v gh >/dev/null 2>&1; then
  printf '%s\n' 'GitHub CLI is required. Install gh, sign in, then run this script again.' >&2
  exit 1
fi
callwise_account=$(gh api user --jq .login)
if [ "$callwise_account" != 'magruder-tools' ]; then
  printf '%s\n' 'This script is prepared for magruder-tools. Switch gh to that account before continuing.' >&2
  exit 1
fi
if [ ! -d .git ]; then
  git init -b main
  if [ -f callwise-history.bundle ]; then
    git fetch ./callwise-history.bundle main
    git reset --mixed FETCH_HEAD
  else
    git add --all
    git -c user.name=Codex -c user.email=codex@localhost commit -m 'Initialize Callwise personal call copilot'
  fi
fi
if [ -n "$(git remote)" ]; then
  printf '%s\n' 'A Git remote already exists. Review it in Codex before pushing; this script will not change it.' >&2
  exit 1
fi
gh repo create magruder-tools/callwise --private --source=. --remote=origin --push
