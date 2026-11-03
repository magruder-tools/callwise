# Claude follow-up review — Callwise 0.5.1 (`local-meetings`, PR #5)

**Reviewer:** Claude (planner/reviewer) · **Builder:** Codex · **Date:** 2026-11-02
**Reviewed:** `local-meetings` at `84e1a49d395ff61ca7e1c0704c624ea309e2837a`, against my 0.5.0 review of `118decb`. All line numbers refer to `84e1a49`.

## Verdict

0.5.1 delivers most of what `REVIEW_RESPONSE.md` lists. Three of its claims don't fully hold:

- **M6 "prevents resume":** capture can still be resumed from outside the window (N1).
- **M6's deletion option:** it deletes more than the captured content (N4).
- **"CWBACKUP1 files remain readable":** one case fails (N7).

| Group | Result |
|---|---|
| High (7) | **All fixed.** Each one was confirmed by running code. |
| Medium (10) | **8 fixed.** M6 (objection handling) is incomplete. M10 (per-channel failure) is fixed in code but still needs the macOS 26 device check. |
| Low (12) | **All changed.** 7 confirmed by running code, 5 need a device. |
| New in this pass | **7 Medium, 5 Low, no High.** Three of them (N2, N11, N12) were already in 0.5.0. |

The new Medium issues fall into four groups:

- **Objection handling (follow-up to M6).**
  - The menu-bar *Resume* and the paused-state global shortcuts still resume capture after an objection (N1).
  - *Delete transcript and audio* also deletes the user's own notes and actions (N4).
- **After "Delete all".**
  - If the user pastes their OpenAI key again during setup, without restarting Callwise, the next meeting's live coaching sends the conversation to OpenAI. Meanwhile the notice and the Ready view say coaching is off (N2, pre-existing).
  - An assistant session that was already connected keeps reading the deleted library once access is switched back on (N3).
  - If the library was locked at launch, nothing in it is deleted (N12, pre-existing).
- **Speech.** A single `speech_input_overloaded` line stops that channel until the user pauses and resumes, or the helper restarts. *Retry audio* doesn't restart it (N5).
- **Backups.** One missing audio file makes every backup fail (N6).

**Recommendation:**
- Fix **N1, N4 and N5** before the first consented real call, because they change what happens during a call.
- N2, N3, N12 and N6 can follow, before wider use.
- No pending real-device check is marked done here.

## Status of the 0.5.0 findings

### High and Medium

| ID | Status | Evidence at `84e1a49` | How I checked |
|---|---|---|---|
| H1 History empty after restart | **Fixed** | `core/meetings/service.mjs:27`, `:116` (scoped read); `:44-55` (queued jobs resume one at a time); `:236-245` (cached open-action counts) | `check-H1`: 3 meetings listed after relaunch, and 3 queued recaps ran with at most 1 in parallel. Real Electron app on Linux: the meeting is listed before and after relaunch, and search finds it. |
| H2 Restart + Pause/Resume overwrote lines | **Fixed** (side effects: N8, N10) | `providers/apple-speech.mjs:67`, `:94` (run-scoped IDs); `:75` (old host ignored); `:82-91`, `:213-224` (replay only after the last final) | `r1` unchanged: the "Bravo" line survives, and all 3 IDs are distinct. |
| H3 Double Start left the call unsaved | **Fixed** | `desktop/meeting-start.mjs:3-6` (reject before `begin()`); `:69-86` (cleans up only its own meeting); `core/meetings/service.mjs:257-261`; `ui/meetings.mjs:259-276` | `check-H3-L2`: the second click is rejected, one meeting exists, and it is saved as ended (not interrupted) with 2 rows and a recap job. |
| H4 Whole conversation to OpenAI | **Fixed** | `core/controller.mjs:1134`, `:1223` (legacy recap and summary off when the notebook is attached); `desktop/main.mjs:242-253` (notebook always attached outside smoke mode); `core/meetings/notice.mjs:25` | `check-H4-H5`, live help on, OpenAI stubbed: 0 summary or recap requests during the call and after Pause → End. `r8` still shows the old path because it builds a controller without the notebook, which only smoke mode does. |
| H5 Prior meetings exported to live help | **Fixed** | `desktop/meeting-start.mjs:44-61`; disclosure in Ready at `ui/views/meetings.mjs:31` | `check-H4-H5`: the context holds the summary, decision and confirmed action only. Notes, transcript, open questions and proposed actions appear in no request. |
| H6 Backups dropped rows past 100,000 | **Fixed** | `core/meetings/store.mjs:224` (no cap); `:432-467` (one snapshot, counted frames) | `r2` unchanged: 100,050 rows backed up and 100,050 restored. |
| H7 Recovery deleted audio past 100,000 chunks | **Fixed** | `core/meetings/store.mjs:335-370` (index read from plaintext SQL; orphan rows removed) | `r3` unchanged: all 100,010 files kept, the last chunk is readable, and recovery takes 0.7–1.6 s (was about 10 s). |
| M1 Backups fail past ~9 h of audio | **Fixed** | `core/meetings/store.mjs:432-487`; `core/meetings/backup.mjs:16-88`; `desktop/workers/archive-worker.mjs:9` | `check-M1`, 11 h of two-channel audio: a 639 MB CWBACKUP2 in 8–9 s with a 218–225 MB peak RSS. All 7,920 restored chunks match the originals byte-for-byte. 0.5.0 fails on the same library with `RangeError: Invalid string length`. |
| M2 Delete all left state behind | **Fixed when the library is open.** Not fixed when it was locked at launch (N12). See also N2, N3. | `core/meetings/service.mjs:863-890`; `core/meetings/store.mjs:595-605`; `desktop/main.mjs:900-924` | `check-M2` and the real Electron app: History is empty, the key is replaced, internal backups and the audit log are gone, and editing the old meeting fails. |
| M3 MCP search went stale | **Fixed** | `desktop/meeting-search.mjs:13-19` (`PRAGMA data_version`) | `check-M3-M4-M5`, through the real `runMeetingMcp` loop with a separate writer: a meeting saved after the first search is found. |
| M4 MCP rejected legacy traffic | **Fixed** | `desktop/meeting-mcp.mjs:244-246` (modern detection needs the protocol-version metadata); `:255-264` (version negotiation) | `check-M3-M4-M5` and `r5`: a call with `progressToken` works, and both 2024-11-05 and 2025-12-31 negotiate to 2025-11-25. |
| M5 Notice didn't cover assistant access | **Fixed** (real clients pending; see N3, N9) | `core/meetings/notice.mjs:7`, `:25`; `core/meetings/service.mjs:301-302`; `desktop/main.mjs:630`; `desktop/meeting-mcp.mjs:115`, `:139-142`, `:149-152` | `check-M3-M4-M5`: meetings without consent, and running meetings, are hidden from list, search, get and excerpt. |
| M6 Objection only paused | **Incomplete** (N1, N4) | `desktop/meeting-start.mjs:28-31`; `core/meetings/service.mjs:979-1008`; `ui/views/meetings.mjs:134` | The builder's test passes. `N1` resumes through the menu bar and shortcuts. `N4` loses the user's notes. |
| M7 Owner stored as the quote | **Fixed** | `core/meetings/recaps.mjs:73-91`; `ui/meetings.mjs:433-455` | `r6` §3: the owner is "Dana", the quote is kept as evidence, and nothing is confirmed. Confirmation logic inspected. |
| M8 Speaker rename froze the app | **Fixed** | `core/meetings/service.mjs:634-655` | `r11`: 1,500 rows in about 0.2 s (196–214 ms across runs), 1 state emission, 0 overrides (was 6.7–9.3 s, 1,501 emissions, 1,500 overrides). |
| M9 Ask ran 137 local-model calls | **Fixed** | `core/meetings/service.mjs:1015-1060` | `check-M9`, 5 meetings × 700 rows through the real search worker: 1 call with 8 evidence rows and a cancel signal. |
| M10 One channel failure stopped both | **Fixed in code; unverified on device** (see N5) | `providers/apple-speech.mjs:102-113`, `:140-147`; `main.swift:168-181` | `N5`: a system-channel error leaves the mic channel transcribing. Two analyzers on macOS 26 still need the device check. |

### Low

| ID | Status | Evidence / check |
|---|---|---|
| L1 End during a Pause drain | **Fixed** | `core/controller.mjs:826-829`; `r6` §6 now ends. |
| L2 Trusted start payload | **Fixed** | `desktop/meeting-start.mjs:8-15`, `:33-43`; `check-H3-L2`: injected preferences are ignored, and notes-only forces `manual`. |
| L3 Stale enhanced-notes textarea | **Fixed** | `ui/render.mjs:51-57`; `r10` shows the adopted version. |
| L4 Phantom line after an empty final | **Fixed in code** | `main.swift:71`; `providers/apple-speech.mjs:98-101`; builder test. The Swift code wasn't built here. |
| L5 Notes export problems | **Fixed in code** | `desktop/apple-followthrough.mjs:17`, `:34-35` (stdin); `native/resources/apple-notes.js:19` (`whose`); builder tests. A Notes folder at real scale is still pending. |
| L6 Dock icon for headless MCP | **Code only** | `desktop/main.mjs:1392`. Device check pending. |
| L7 Language assets not checked | **Fixed in code** | `ui/views/meetings.mjs:31`; `desktop/meeting-start.mjs:69-86`. The real missing-assets flow is still pending. |
| L8 Storage hardening | **Fixed** | `core/meetings/store.mjs:38-49`, `:54-75`; builder test. `check-upgrade-050-library`: a 0.5.0 library still opens. |
| L9 Export polish | **Code only** | `desktop/apple-followthrough.mjs`. Real Apple-app formatting is still pending. |
| L10 Recovered meetings get no gap or recap | **Fixed** | `core/meetings/store.mjs:318-326`; builder test. |
| L11 First recap arrived as a draft | **Fixed** | `core/meetings/service.mjs:739`; in `r6` §2 the recap is no longer a draft. |
| L12 Late audio chunk survived Delete | **Fixed** | `core/meetings/service.mjs:826-861`; `core/meetings/store.mjs:376`; `r12` leaves no rows or files. |

---

## New findings

### Medium

#### N1 — After an objection, the menu-bar Resume and the global shortcuts still resume capture *(reproduced)*

- **Where:**
  - The objection guard exists only in `desktop/meeting-start.mjs:28-31`.
  - Three resume paths call `controller.command("start")` directly:
    - the menu-bar item: `desktop/main.mjs:560-570`;
    - the Pause shortcut, Control+Alt+P: `:469-481`;
    - the Help shortcut, Control+Alt+Space, which resumes before nudging: `:457-468`.
  - Both shortcuts stay registered while paused (`desktop/shortcuts.mjs:37-42`).
- **Trigger:** Someone objects, and the user clicks *Someone objected — pause now*. Then the user clicks *Resume* in the menu bar, or presses either shortcut. Pressing *Help me now* out of habit is enough.
- **Impact:**
  - Capture resumes, and new speech is saved into the meeting marked `objection: true`.
  - Meanwhile the in-window *Resume* is refused.
  - In the repro, "I said I did not want this recorded." was saved after the objection.
- **Fix:**
  - Put the check where every path passes. For example, `CallController.start()` asks the meeting service whether the active meeting can resume, and throws the same message if not. Alternatively, route the tray and shortcut resumes through `startMeeting()`.
  - While `objection` is set, disable the tray item and skip the resume step of both shortcuts.
  - Add a test that drives the tray handler and both shortcut actions.
- **Repro:** `N1-objection-resume-bypass.mjs`

#### N2 — After "Delete all", pasting the OpenAI key again turns live coaching on, while the notice and the Ready view say it's off *(reproduced; pre-existing in 0.5.0)*

- **Where:**
  - `desktop/main.mjs:926-929` sets `preferences = {}` and `controller.preferences = {}`. It skips the launch defaults at `:149-157`, which include `liveHelp: false`.
  - Two parts of the code then disagree about an unset `liveHelp`:
    - `core/meetings/notice.mjs:6` and `ui/views/meetings.mjs:31` treat it as off (`=== true`).
    - `CallController.setProviders()` (`core/controller.mjs:136-137`) treats it as on (`=== false`).
  - The same code was in 0.5.0: `main.mjs:934-937` and `controller.mjs:132-140` at `118decb`.
- **Trigger:**
  1. The user runs Delete all and lands on the setup screen.
  2. They paste their OpenAI key there, and it is saved through `desktop.connections.save`, which also rebuilds the providers (`ui/app.mjs:386`).
  3. They start a meeting before restarting Callwise.
- **Impact:**
  - The notice says transcription happens on the Mac and mentions no live suggestions, and the Ready view shows coaching off.
  - Auto-coaching still sends the conversation to OpenAI. In the repro, the first "Them" question went out (twice, because the stub answers with a 500 and the provider retries).
  - With no OpenAI key, coaching falls back to Codex (`desktop/main.mjs:232-237`). That fails today only because Delete all also removed `codex-work`, Codex's working folder (`:918`; created only at launch, `:102`).
    - So the user sees Codex errors in a meeting shown as local-only.
    - Codex sign-in and coaching stay broken until a restart.
  - After a restart, the launch defaults apply again.
- **Fix:**
  - Reset to the launch defaults, using one shared `DEFAULT_PREFERENCES` constant.
  - Make every cloud gate require `liveHelp === true`: `setProviders()` at `:136`, `prepare()` at `:1019`, `makeRecap()` at `:1148` and `maybeSummarize()` at `:1225`.
  - Recreate `codex-work` after Delete all.
  - Test: with preferences `{}` and an OpenAI key or a Codex provider, no provider calls are made.
- **Repro:** `N2-delete-all-live-help.mjs` (stubbed network; a fake Codex binary records whether it ran)

#### N3 — After "Delete all", a running MCP server keeps serving the deleted library *(reproduced; list/get/excerpt part new in 0.5.1)*

- **Where:**
  - `runMeetingMcp()` opens the read-only store and search worker once and keeps them for the life of the process (`desktop/meeting-mcp.mjs:375-381`).
  - `MeetingStore.reset()` (`core/meetings/store.mjs:595-605`, called from `core/meetings/service.mjs:887`) removes `meetings/` and creates a new library and key at the same path.
  - The MCP process keeps its connection to the unlinked files and its copy of the old key.
  - `PRAGMA data_version` never changes on that connection, so the old search index is reused too.
  - In 0.5.0, Delete all removed rows inside the same database file, so an open connection saw the deletion. Only 0.5.0's search kept serving deleted meetings, from its stale index (the M3 bug).
- **Trigger:**
  1. Claude Desktop or Codex keeps the server running, as it does for its whole session.
  2. The user runs Delete all.
  3. Later, the user switches *Allow assistants to read saved Callwise meetings* back on, without restarting the assistant app.
- **Impact:** In the same assistant session:
  - `meeting_list`, `meeting_search` and `meeting_get` return the deleted meetings. In the repro, `meeting_get` returned "Dana's current salary is 180k."
  - Meetings saved after the reset are invisible.
  - The deleted files keep using disk space until the assistant app quits.
- **Fix:**
  - On `open()`, record the library's identity: the `dev`/`ino` of `library.db` and `archive-key.bin`, or a random library ID written when the library is created.
  - Re-check it before every call. If it changed or a file is missing, close and reopen the store and the search worker.
  - Also drop the cached store and search worker whenever `enabled()` is false.
  - Test: start the server, `reset()` the store, re-enable access. `meeting_list` should show only the new library.
- **Repro:** `N3-mcp-after-delete-all.mjs` (real `runMeetingMcp` loop plus `MeetingService.deleteAll()`)

#### N4 — "Delete transcript and audio" after an objection deletes the whole meeting, including the user's notes *(reproduced)*

- **Where:**
  - `core/meetings/service.mjs:999-1007`: the `delete` choice calls `this.delete(id)`. That removes the header, `notes:original`, actions, speakers, events and audio.
  - The button reads "Delete transcript and audio; continue with notes only" (`ui/views/meetings.mjs:134`).
  - The continuation is a new, untitled notes-only meeting (`ui/meetings.mjs:485-495`). Its `clearContext: true` also drops the call's materials; the goal is a saved preference and is kept.
  - `tests/claude-review-regressions.test.mjs:662-666` asserts that the whole meeting is gone.
- **Impact:**
  - Notes typed during the call are deleted permanently. In the repro: "walk-away price 35k, ask for 3-year term".
  - User-added actions, the title and the people are deleted too.
  - Plan 3.3 asks to delete "what was transcribed so far (and audio)". The user's own notes aren't that.
- **Fix:**
  - Delete only what was captured, and what was derived from it:
    - transcript rows;
    - audio chunks and files;
    - diarization speaker names;
    - the coaching doc;
    - the recap, enhanced-notes drafts and their jobs.
  - Keep:
    - the header, marked for example `captureDeleted: true, captureMode: "notes-only"`;
    - `notes:original`;
    - user-origin actions.
  - Continue in the same meeting as notes-only, or carry the notes, title and people into the new one.
  - If deleting the whole meeting is intended, label the button "Delete this meeting, including my notes" and ask for confirmation.
  - Update the M6 test to match.
- **Repro:** `N4-objection-delete-notes.mjs`

#### N5 — One `speech_input_overloaded` line stops that channel until the user pauses and resumes or the helper restarts, and "Retry audio" can't restart it *(reproduced with a fake helper; frequency unverified)*

- **Where:**
  - **Swift side.** `main.swift:101` emits `speech_input_overloaded`, tagged with the channel, each time the input stream drops a buffer.
    - The stream keeps the newest 160 buffers (`:54`), and each buffer is a 100 ms packet (`ui/audio-worklet.js:7`). So the first drop means the analyzer is about 16 s behind.
    - The Swift channel keeps running after the drop.
  - **JavaScript side.** `providers/apple-speech.mjs:102-112` treats every channel error as fatal: `failedChannels.add()`. After that, `push()` drops all audio for that channel (`:144`). Only a pause and resume, or a restart of the whole helper (which clears the set at `:198`), brings the channel back.
  - In 0.5.0 the same line restarted the helper, within a cap.
  - **Retry audio.** `desktop/main.mjs:747-757` restarts only when a transcriber has `stopped`, which Apple transcribers never set.
    - So it also does nothing after "Local speech stopped repeatedly".
    - That part is pre-existing.
- **Impact:**
  - A brief overload ends transcription of that side of the call until the user pauses and resumes, or until an unrelated helper restart.
  - The *Retry audio* button offered with the error does nothing.
  - In the repro, after one overload line the system channel received 0 of 20 packets. 0.5.0 restarted the helper and delivered them all.
- **Fix:**
  - Treat overload as a warning:
    - in Swift, emit `type: "warning"`, rate-limited, as already done for `speech_drain_incomplete`;
    - in JavaScript, add one gap row per burst and keep pushing.
  - Fail or restart the channel only if drops persist, for example more than N in 60 s.
  - For Apple speech, make *Retry audio* pause and resume whenever any channel is `failed` or the session has stopped.
  - During the pending macOS 26 two-channel check, count how often drops happen.
    - Watch the moments right after a helper restart in particular. The replay can queue up to 150 of the stream's 160 slots at once (`providers/apple-speech.mjs:153-157`, `:213-224`), so drops may cluster there.
    - This is inferred from the code, not observed.
- **Repro:** `N5-overload-stops-channel.mjs` (it also runs against 0.5.0 for comparison)

#### N6 — One missing audio file makes every backup fail *(reproduced; regression from 0.5.0)*

- **Where:**
  - 0.5.0's `recover()` marked a chunk row `missing` when its file was gone (`store.mjs:298-300` at `118decb`). 0.5.1 dropped that loop (`core/meetings/store.mjs:297-372`).
  - `backupRecords()` reads every chunk not marked missing (`:453-460`). One `ENOENT` aborts the whole backup.
  - Playback shows the raw `ENOENT` instead of "This recording is no longer available." (`readAudio`, `:397-407`).
- **Trigger:**
  - **Rare causes:**
    - a crash between the two steps of `prune()`: the file is removed at `:424` and the row afterwards;
    - a file removed or restored outside Callwise;
    - rows left by the 0.5.0 H7 bug.
  - **A race:** deleting a meeting from History while a backup is running fails that backup.
    - In the same race, `deleteMeeting()`'s `wal_checkpoint(TRUNCATE)` (`:295`) blocks the main thread for the whole 5 s busy timeout (`:151`), because the backup holds its read snapshot.
    - Measured in the repro: about 5 s (5,014–5,026 ms), against 3 ms without a backup running.
- **Impact:**
  - Every later backup fails with an `ENOENT` path.
  - The user can't tell which meeting to fix, and has no backup until they find it.
- **Fix:**
  - When a chunk's file is absent, `backupRecords()` writes the record as `missing: true`, then reports how many were missing.
  - Restore the missing-file marking in `recover()` from the plaintext index:
    - stat the paths returned by `SELECT meeting_id,id`;
    - re-save only the rows whose file is gone.
  - Map `ENOENT` in `readAudio()` to the friendly message.
  - While a backup is running, use a `PASSIVE` checkpoint or skip it.
- **Repro:** `N6-missing-chunk-blocks-backup.mjs` (also runs against 0.5.0, which marks the row missing and finishes the backup)

#### N12 — "Delete all" leaves the whole library in place when it couldn't be opened at launch *(reproduced; pre-existing in 0.5.0)*

- **Where:**
  - If the archive key can't be unwrapped at launch, `meetingStore` stays `null` (`desktop/main.mjs:112-119`). That happens, for example, with a locked keychain or a denied keychain-access prompt.
  - Even so, the service is built (`:242-250`).
  - `deleteAll()` then calls `this.store?.reset()` (`core/meetings/service.mjs:887`), which does nothing without a store.
  - `desktop.delete`'s own file list (`desktop/main.mjs:907-918`) doesn't include `meetings/`.
  - The button stays enabled while the library is locked (`ui/views/meetings.mjs:224` disables it only while running, paused or finishing).
  - 0.5.0 had the same gap: its delete loop was guarded by `if (meetingStore)`.
- **Impact:**
  - `archive-key.bin` and `library.db` survive "Delete all Callwise data".
  - Nothing tells the user. The deleted meetings come back at the next launch with keychain access.
- **Fix:**
  - When no store is open, `desktop.delete` should remove `meetings/` itself, with the same `rmSync` that `reset()` uses, so the next launch starts a new library.
  - Test Delete all with a library that failed to open.
- **Repro:** `N12-delete-all-locked-library.mjs`

### Low

- **N7 — Restoring a 0.5.0 backup that contains an orphan audio chunk stops part-way and blocks a retry** *(reproduced, `N7-legacy-restore-orphan.mjs`)*.
  - The CWBACKUP1 path commits the records first, then writes audio outside that transaction (`core/meetings/store.mjs:568-585`).
  - `writeAudio()` now rejects a chunk whose meeting doesn't exist (`:376`). The 0.5.0 L12 race could leave exactly such a chunk, so the restore throws "Meeting not found." part-way.
  - In the repro:
    - 2 of 4 chunks were restored;
    - `recover()` and `clearCache()` never ran;
    - the retry was refused: "Restore requires an empty library".
  - So for this case, "CWBACKUP1 files remain readable" doesn't hold.
  - **Fix:** skip audio whose meeting isn't in the backup, and give the legacy path the same single transaction and rollback as `restoreFrames()`.
- **N8 — Speech-helper restarts are capped at 3 per capture, with no time window** *(reproduced, `N8-restart-budget.mjs`)*.
  - 0.5.0 counted only the last 60 s (`apple-speech.mjs:149` at `118decb`).
  - In 0.5.1 the fourth restart stops both channels however far apart the restarts are (`providers/apple-speech.mjs:185`).
  - Four exits 20 minutes apart ended transcription; 0.5.0 kept going.
  - **Fix:** a wider sliding window (for example 3 per 10 minutes) or backoff, plus a working *Retry audio* (N5).
- **N9 — MCP search applies consent only after the worker has cut results to the top 100 meetings** *(reproduced, `N9-mcp-search-cap.mjs`)*.
  - The worker slices to 100 at `desktop/workers/search-worker.mjs:104`; the consent filter runs afterwards, at `desktop/meeting-mcp.mjs:139-143`.
  - In the repro, 120 older meetings without assistant consent ranked higher, so a consented meeting containing "budget" wasn't returned.
  - The MCP process also decrypts and indexes every meeting without consent.
  - **Fix:** filter, or index only, meetings that are `ended && assistantAccess` in the MCP worker.
- **N10 — Run-scoped IDs make local-model prompts about 30% larger, and the model must copy them exactly** *(measured, `N10-evidence-id-length.mjs`; quality unverified)*.
  - Segment IDs now end in `:run:<uuid>` (`providers/apple-speech.mjs:94`), and every evidence chunk carries them verbatim (`core/meetings/recaps.mjs:5-29`).
  - `validateDocument()` drops any bullet or action whose ID isn't echoed back exactly (`:30-41`).
  - 700 rows grow from 14 to 18 chunks (+33% bytes), and each chunk is one local-model call.
  - A small on-device model may also miscopy 52-character IDs and silently lose recap items.
  - **Fix:** send short per-prompt aliases (`r1`, `r2`…) and map them back. Check during the pending 30- and 60-minute recap test.
- **N11 — A partial line from a crashed helper run stays in the transcript as an "unfinalized" duplicate** *(reproduced, `N11-restart-partial-duplicate.mjs`; also in 0.5.0)*.
  - The replay re-sends that audio, so the new run produces the line again.
  - **Fix:** in `recover()`, discard the old run's non-final rows through `onDiscard`.

### Improvements (not bugs)

- **Restore blocks the main thread** (`desktop/meeting-commands.mjs:138`).
  - Restoring the 11-hour library took 15–17 s here, synchronously in the main process. So the window can't respond meanwhile; that is inferred from the code, not observed in the app.
  - Move it to a worker, or show progress.
- **One malformed audio row locks the whole library.**
  - `recover()` throws "Invalid audio index…" from inside the `MeetingStore` constructor (`core/meetings/store.mjs:343-352`), so the app starts with a locked library.
  - Skipping the prune is enough.
- **A backup that times out leaves a partial file.** The 30-minute timeout terminates the worker before `backupToFile()` can clean up, so `<file>.<uuid>.tmp` stays next to the user's chosen path (`desktop/meeting-commands.mjs:106-109`).
- **Owner suggestions can be generic labels.** Without diarization, a first-person quote makes the owner "Them" or "Speaker 2" (`core/meetings/recaps.mjs:76-81`). Map generic labels to `null`.
- **Misleading MCP error for a running meeting.** It says the notice "did not allow assistant access" (`desktop/meeting-mcp.mjs:149-152`). It should say the meeting is still in progress.
- **The objection warning sticks.** `service.warning` is never cleared, so "Capture has ended. You can continue with a notes-only meeting." keeps showing on later meetings (`core/meetings/service.mjs:1005-1006`).

---

## What I ran

| Check | Result |
|---|---|
| `npm test` on Node 24.20.0, the Node in Electron 44.2.0 | **296/296 pass**, including the 24 new regression tests |
| `npm run check` | pass (129 modules) |
| `scripts/verify-ui.mjs` and `scripts/verify-meeting-ui.mjs`, headless Chromium | both pass |
| Electron desktop smoke `--smoke` under Xvfb | pass. Smoke mode doesn't construct the meeting service. |
| Real Electron app on Linux, with a test-only keychain stand-in (`linux-e2e/`) | **H1:** History lists the meeting before and after relaunch, and search finds it. **M2:** after Delete all, History is empty, no rows are left and the audit log is gone. |
| My 0.5.0 reproductions r1–r12, run unchanged | **Show the fixes:** r1, r2, r3, r6 §2/§3/§6, r10, r11, r12, and the M4 part of r5.<br>**Out of date:** r4, r6 §1/§4/§5 and r8 run code that 0.5.1 replaced, or that only smoke mode uses; `check-*` replaces them.<br>**Empty by design:** r5's M3 and M5 parts return nothing, because its meetings have no assistant consent.<br>**r9:** 7.4–7.9 ms per update at 3,000 rows (was 17.4 ms). |
| 20 new or adapted scripts (8 `check-*`, 12 `N*`) | all exit 0; outputs in `outputs/` |
| The same scripts on a 0.5.0 tree from `git archive 118decb` | N5, N6, N8, N11 and `check-M1` show the 0.5.0 behaviour quoted above |
| An independent check by a separate agent, before delivery | It re-ran the scripts and the test suite, checked about 60 line references (none wrong), and tested N1 and N3 further, N3 with the MCP server in its own process.<br>It also caught that Delete all removes Codex's working folder, so the Codex half of N2 can't send anything. That led to the OpenAI-key trigger now in N2.<br>Its other finding became N12, and its wording corrections are included. |

The builder's other claims I couldn't re-check here: the Swift build, the packaged archive's SHA-256, the 81-file comparison and the packaged-Node test run.

## Access limits

- **Linux container, no macOS.**
  - I couldn't build or run the Swift helper, Apple Speech, Foundation Models, FluidAudio, EventKit, Notes/JXA, permission prompts or signing.
  - The Swift-side statements come from reading `main.swift`: M10, N5's 16 s figure, and L4.
- **The packaged archive isn't on GitHub**, so I couldn't inspect it.
- **GitHub is read-only for me.**
  - Adding the repository with push access asks for a linked GitHub account, and this session's `gh` token is invalid.
  - So I couldn't comment on PR #5. This file and the repro folder are for Codex to commit or relay. I suggest `docs/reviews/0.5.1/CLAUDE_FOLLOWUP_REVIEW.md` and `docs/reviews/0.5.1/claude-followup-repros/`.
- **Synthetic data only.** No personal recordings or notes were accessed, and nothing was merged, released or installed.
- **My own 0.5.0 harness had two bugs.**
  - It didn't pass `CALLWISE_ROOT` to Electron.
  - It could pick the floating panel window instead of the main one.
  - The corrected copies are in `linux-e2e/`.

## Real-device checks still pending

None of the checks still listed as required in `REVIEW_RESPONSE.md` is done by this review:

- a consented real call on both channels;
- macOS 26 dual-analyzer behaviour and restart counts;
- Notes, Reminders and Calendar permissions and exports;
- group-speaker quality;
- 30- and 60-minute local recaps;
- 60-minute diarization, resource and battery checks;
- device switching;
- real Claude Desktop and Codex MCP connections, including the Dock icon (L6).

This review adds:

- **N5:** how often the input stream drops buffers with two analyzers, on macOS 26 and 27, especially right after a helper restart.
- **N10:** how many recap items and actions survive on 30- and 60-minute meetings with run-scoped IDs, compared with short aliases.
- **N1:** after the fix, the tray and shortcuts during an objection, on macOS.
- **N3:** after the fix, Delete all while Claude Desktop keeps the server running.

## Suggested fix order

1. **N1, N4:** objection handling, a promise made to participants.
2. **N5**, including *Retry audio* for Apple speech.
3. **N2, N3, N12:** Delete all.
4. **N6, N7:** backup and restore robustness.
5. **N8–N11**, then the improvements.

Then turn the `N*` scripts into tests and run `run-all.sh` again.

## Reproductions

Run them from the repository root with Node 24:

```
bash docs/reviews/0.5.1/claude-followup-repros/run-all.sh
```

- Setting `RUN_LARGE=1` adds the 11-hour backup and the slow original scripts. It needs about 1.6 GB of temporary disk.
- The comparisons use a 0.5.0 tree, which the script extracts from `118decb` unless `CALLWISE_050_ROOT` is set.
- They need no network or macOS APIs.
- My outputs from this run are in `outputs/`, along with the logs of the suite runs (`outputs/suite/`) and of the original scripts (`outputs/original-0.5.0-repros-rerun/`).

| Script | Shows |
|---|---|
| `check-H1-library-restart.mjs` | H1: History after relaunch; queued recaps resume one at a time |
| `check-H3-L2-start-coordinator.mjs` | H3: the second Start is rejected and the call is saved. L2: injected preferences and notes-only + audio are ignored. |
| `check-H4-H5-cloud-boundary.mjs` | H4: no running summary or recap requests with the notebook attached. H5: prior context is limited to summary, decisions and confirmed actions. |
| `check-M1-large-audio-backup.mjs` | M1: 11 h audio backup and restore (0.5.0: `RangeError`) |
| `check-M2-delete-all.mjs` | M2: service state, key and internal backups cleared |
| `check-M3-M4-M5-mcp.mjs` | M3 freshness, M4 legacy metadata and versions, M5 per-meeting consent, through `runMeetingMcp` |
| `check-M9-ask-history.mjs` | M9: one bounded local-model call with a cancel signal |
| `check-upgrade-050-library.mjs` | A 0.5.0 library opens, edits become v2 records, and it round-trips through CWBACKUP2 |
| `N1-objection-resume-bypass.mjs` | N1: menu-bar Resume / Control+Alt+P resume capture after an objection |
| `N2-delete-all-live-help.mjs` | N2: after Delete all and pasting the OpenAI key again, the conversation goes to OpenAI under a local-only notice. Without the key, the Codex fallback errors out. |
| `N3-mcp-after-delete-all.mjs` | N3: the same MCP session lists, searches and reads deleted meetings |
| `N4-objection-delete-notes.mjs` | N4: notes and actions deleted with the transcript |
| `N5-overload-stops-channel.mjs` | N5: 0 of 20 packets after one overload line; *Retry audio* does nothing |
| `N6-missing-chunk-blocks-backup.mjs` | N6: a missing file blocks the backup. The same failure, plus a ~5 s stall, when deleting during a backup. |
| `N7-legacy-restore-orphan.mjs` | N7: CWBACKUP1 restore stops part-way, and the retry is refused |
| `N8-restart-budget.mjs` | N8: the 4th restart, 20 minutes apart, stops speech |
| `N9-mcp-search-cap.mjs` | N9: a consented meeting is hidden behind 100+ meetings without consent |
| `N10-evidence-id-length.mjs` | N10: 14 → 18 chunks for 700 rows; one wrong character drops the bullet |
| `N11-restart-partial-duplicate.mjs` | N11: an old run's partial line kept as an "unfinalized" duplicate |
| `N12-delete-all-locked-library.mjs` | N12: Delete all with a locked library leaves `meetings/`; the meeting returns at a later launch |
| `linux-e2e/` | Real-app H1 and M2 runs (Linux, stand-in keychain) |
