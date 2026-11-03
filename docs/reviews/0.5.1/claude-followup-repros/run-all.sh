#!/usr/bin/env bash
# Run every 0.5.1 follow-up reproduction from the repository root with Node 24 (Electron 44.2's Node).
#   bash <this-folder>/run-all.sh                 # quick set, about 1 minute
#   RUN_LARGE=1 bash <this-folder>/run-all.sh     # adds the 11-hour audio backup (needs ~1.6 GB temporary disk)
# A 0.5.0 tree is needed for the before/after comparisons; it is extracted from commit 118decb if not given.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${CALLWISE_ROOT:-$(pwd)}"
OUT="${OUT_DIR:-$HERE/outputs}"; mkdir -p "$OUT"
OLD="${CALLWISE_050_ROOT:-}"
if [ -z "$OLD" ]; then
  OLD="$(mktemp -d)/callwise-050"; mkdir -p "$OLD"
  git -C "$ROOT" archive 118decb | tar -x -C "$OLD" && ln -s "$ROOT/node_modules" "$OLD/node_modules"
fi
run() { # script name, then optional VAR=value pairs
  local name="$1"; shift
  echo "=== $name"
  env "$@" CALLWISE_ROOT="$ROOT" CALLWISE_050_ROOT="$OLD" node "$HERE/$name.mjs" > "$OUT/$name.txt" 2>&1
  echo "(exit $?)" >> "$OUT/$name.txt"; cat "$OUT/$name.txt"
}
on050() { # same script against the 0.5.0 tree
  echo "=== $1 on 0.5.0"; CALLWISE_ROOT="$OLD" node "${@:2}" "$HERE/$1.mjs" > "$OUT/$1.on-0.5.0.txt" 2>&1; cat "$OUT/$1.on-0.5.0.txt"
}
cd "$ROOT"
# 0.5.0 findings re-checked through the 0.5.1 production paths
for s in check-H1-library-restart check-H3-L2-start-coordinator check-H4-H5-cloud-boundary check-M2-delete-all \
         check-M3-M4-M5-mcp check-M9-ask-history check-upgrade-050-library; do run "$s"; done
# New findings
for s in N1-objection-resume-bypass N2-delete-all-live-help N3-mcp-after-delete-all N4-objection-delete-notes \
         N5-overload-stops-channel N6-missing-chunk-blocks-backup N7-legacy-restore-orphan N8-restart-budget \
         N9-mcp-search-cap N10-evidence-id-length N11-restart-partial-duplicate N12-delete-all-locked-library; do run "$s"; done
# Before/after on 0.5.0
for s in N5-overload-stops-channel N6-missing-chunk-blocks-backup N8-restart-budget N11-restart-partial-duplicate; do on050 "$s"; done
# The original 0.5.0 scripts, unchanged (several now exercise code that 0.5.1 replaced; see the review)
ORIG="$ROOT/docs/reviews/0.5.0/claude-review-repros"; mkdir -p "$OUT/original-0.5.0-repros-rerun"
LIST="r1-epoch-collision r4-double-start r5-mcp r6-service r7-library-restart r8-cloud-recap r10-textarea r11-rename r12-delete-race"
[ "${RUN_LARGE:-0}" = 1 ] && LIST="$LIST r2-backup-cap r3-recover-audio-cap r9-perf"
for r in $LIST; do
  echo "=== original $r"; CALLWISE_ROOT="$ROOT" node "$ORIG/$r.mjs" > "$OUT/original-0.5.0-repros-rerun/$r.txt" 2>&1; cat "$OUT/original-0.5.0-repros-rerun/$r.txt"
done
if [ "${RUN_LARGE:-0}" = 1 ]; then
  run check-M1-large-audio-backup
  on050 check-M1-large-audio-backup --max-old-space-size=6000
fi
