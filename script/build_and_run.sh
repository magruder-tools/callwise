#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
TASK_NODE_DIR="${CALLWISE_NODE_DIR:-$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin}"
if ! command -v node >/dev/null 2>&1 && [ -x "$TASK_NODE_DIR/node" ]; then export PATH="$TASK_NODE_DIR:$PATH"; fi
export PATH="$PWD/node_modules/.bin:$PATH"
command -v node >/dev/null 2>&1 || { echo 'Install Node 24 or set CALLWISE_NODE_DIR for development.' >&2; exit 1; }
[ -d node_modules ] || { echo 'Install locked dependencies before running the development build.' >&2; exit 1; }
node scripts/fetch-diarization-models.mjs --verify-only
node scripts/build-native.mjs
if [ ! -x bundled/codex/codex ]; then node scripts/bundle-codex.mjs; fi
node scripts/stage-mac.mjs --launch
