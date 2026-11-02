# Callwise 0.5.1 — response to Claude's 0.5.0 review

Date: November 2, 2026. Review baseline: `118decb1d545812de58dfc64282157dae5526ee7`.

The 29 findings have code changes. The seven High findings have regression coverage. A full suite of 296 tests, both synthetic renderer checks, JavaScript checks and the native Swift helper build passed locally. This does not establish real-call accuracy, real Apple app permission/export behavior, macOS 26 dual-analyzer capacity, or long-session performance.

Original evidence is preserved in [Claude's review](../0.5.0/CLAUDE_REVIEW.md) and [reproduction scripts](../0.5.0/claude-review-repros/). Reproductions were converted into assertions in `tests/claude-review-regressions.test.mjs` (24 added tests); existing follow-through tests now cover stdin transport. The browser meeting harness uses the production start coordinator.

## Findings and changes

| Finding | Change | Verification |
| --- | --- | --- |
| H1 | Distinguish an unscoped read from an unsaved meeting; resume queued jobs serially; cache open-action counts so library refreshes avoid repeatedly decrypting all action groups. | Reopened-service library and serial queued-document regression. |
| H2 | Give every helper run a UUID namespace independent of capture epoch. Ignore obsolete helper output. Replay only audio after the last final result; cap retries for the capture session. | Crash, new final, pause/resume, new final: all three survive with distinct IDs. |
| H3 | Production start coordinator rejects re-entry before creating a meeting and only cleans up a meeting created by that request. The notice button has an in-flight guard. | Concurrent real-controller start regression and synthetic participant-gate UI. |
| H4 | Disable the controller's legacy cloud recap and running-summary paths when the notebook service is present. Live-help notice names OpenAI and accurately describes conversation text being sent. | Notebook invokes neither legacy path; notice assertion. |
| H5 | Reuse only the selected meeting's summary, decisions and confirmed actions. Exclude original/enhanced notes and raw transcripts; disclose context sharing in Ready. | Prior-meeting raw-text sentinel cannot enter live-help context. |
| H6 | Remove silent store limits. Backup records are streamed from a consistent read transaction, with authenticated counts and completion frame. | 100,005 transcript rows backed up and restored under a fresh key. |
| H7 | Build the complete retained-audio set from plaintext SQLite identity columns. Validate the index before removing orphan files; remove orphan audio rows. | Last indexed file survives recovery beyond 100,000 chunk rows. |
| M1 | CWBACKUP2 uses individually authenticated, ordered frames and disk streaming. No whole-library base64 string or worker-to-main archive copy. Restore streams frames and rolls back incomplete archives. | Large-row roundtrip, truncated-file rollback, audio roundtrip and old-backup compatibility. |
| M2 | Delete all aborts jobs/recorders, closes search, clears decrypted caches/IDs, recreates the empty store with a new key and removes local backups plus MCP audit logs. Reject it while running, paused or finishing. | Cache/key/backup/old-edit regression; main guard inspected. |
| M3 | Search checks SQLite data_version on its long-lived read connection. | Search finds a meeting saved after its initial query. |
| M4 | A progress token alone is legacy metadata; unsupported legacy initialize versions negotiate a supported version. | 2024-11-05 initialize and progressToken tools/call assertions. |
| M5 | Include assistant access in notice text/config/hash and each meeting header; prevent changing it mid-meeting. MCP lists/searches/reads only ended meetings whose own notice allowed assistant access. | Per-meeting list/search/read denial and active-meeting exclusion. Real client checks still pending. |
| M6 | An objection pauses capture and prevents resume. The dialog offers keeping or deleting captured content, then continues in a new notes-only meeting. Any later captured meeting requires a fresh notice. | Objection/pause/resume-denial/deletion regression. Dialog wired into modal rendering. |
| M7 | Keep owner evidence separate from a grounded speaker/name suggestion. Text-only saves do not confirm owner/date; explicit confirmation controls are available. | First-person owner/evidence regression; UI inspected. |
| M8 | Rename/merge rows in one transaction with one state emission, preserving per-line override eligibility. | 1,500-row rename emits once and creates no manual overrides. |
| M9 | Ask History uses bounded search-hit neighbors, at most eight short evidence rows, a 30-second cancel signal, and a Stop control. | 1,500-line meeting submits only three relevant rows with a cancel signal. |
| M10 | Start Swift analyzers independently; channel errors fail only that channel. Process-wide errors remain bounded recovery events. | Channel-failure/discard regression and Swift build. Actual two-channel macOS 26 check remains pending. |
| L1 | End waits behind an existing Pause drain; resume waits for final-word draining. | Pause + End reaches ended with both channel drains completed. |
| L2 | Whitelist start fields; take notice preferences from main, force manual for notes-only, reject source changes on resume. | Injected preferences and notes-only/source-change regressions. |
| L3 | Patch clean textarea values and key enhanced-note editors by document version. | Adopted text refreshes; ordinary snapshots preserve a typed draft. |
| L4 | Emit and forward a discard for an empty final with the same run identity. | Discard identity regression; Swift build. |
| L5 | Query Notes markers through whose; serialize each export; report existing/unmodified exports accurately; pass JSON through stdin. | Concurrent save and >1 MB stdin regressions, literal-text test and Foundation stdin check. Real Notes folder-scale check remains pending. |
| L6 | Hide the Dock icon when the headless server is ready. | Code inspected; real Claude/Codex launch check remains pending. |
| L7 | Ready checks installed assets for the selected locale, normalizes locale spelling and removes an empty failed-start meeting. | Synthetic Ready view; production failure cleanup inspected. Real missing-assets flow remains pending. |
| L8 | New records use versioned, unambiguous AAD; legacy reads verify sealed record identity. Atomic writes fsync the file and parent directory. | Colon-alias relocation is rejected; existing store/backup tests pass. |
| L9 | Reminders cite readable time/speaker excerpts; Notes renders basic headings, bullets and emphasis with escaped user content. | Export tests; real Apple app formatting remains pending. |
| L10 | Crash recovery adds a visible transcript gap and queues one recap. | Repeating recovery adds no duplicate gap/job. |
| L11 | An unrelated content edit cannot turn the first recap into a draft. Explicit adoption clears the user-edit marker. | In-flight title edit still yields the main recap. |
| L12 | Tombstone deletions, reject writes for missing meetings, stop finishing consumers and remove any final late file after worker termination. | Forced-timing late-file deletion and rejected audio write regression. |

## Compatibility and remaining checks

- Existing 0.5.0 records and CWBACKUP1 files remain readable. New v2 records and CWBACKUP2 files require 0.5.1; do not downgrade after writing with this version.
- Historical meetings without assistant-access consent remain unavailable to MCP. Turning on the global switch does not expose those meetings retroactively.
- Deleting all local data removes Callwise's local key and internal backups; exported copies and backups saved elsewhere remain with their owner.
- This is an ad-hoc signed Apple Silicon development archive, not a notarized release. The installed app and user library were not replaced.
- Still required: a consented real call on both channels; macOS 26 dual-analyzer behavior and restart counts; real Notes/Reminders/Calendar permissions; group-speaker quality; 30/60-minute local recaps; 60-minute diarization/resource/battery checks; device switching; and real Claude Desktop/Codex MCP connections.
- Optional improvements beyond these findings remain separate, including full incremental indexing, a smaller diarization buffer and continuous/per-channel playback.

## Evidence

- [296 passing tests](validation/unit-tests.txt)
- [Meeting UI](validation/meeting-ui.txt) and [legacy/shared UI](validation/legacy-ui.txt), synthetic data only
- [Native helper build](validation/native-build.txt)

No real call was captured and no personal Notes/Reminders were exported during this fix pass.

## Packaged archive verification

The 0.5.1 Apple Silicon archive was extracted into a fresh temporary directory and passed `codesign --verify --deep --strict`. Version is 0.5.1 and minimum OS is 26.0. All 81 packaged runtime source files compared byte-for-byte with this source checkout. All 24 new review regression tests also passed under the packaged Electron Node runtime.

The archive contains 280,525,076 bytes; SHA256 is `e9f3f25e52d132463cdecded9bfeb47ba51b639bf474b9c4a72c305d11ef1820`.

Packaging now verifies and archives the app in its temporary build folder, because the cloud-managed Documents folder immediately adds FinderInfo to unpacked app bundles. Only the completed ZIP is copied to Documents. This avoids altering signed bundle contents. No installed application was replaced.

See [packaging log](validation/packaging.txt), [extracted archive verification](validation/package-verification.json), and [packaged runtime regressions](validation/packaged-runtime-tests.txt).
