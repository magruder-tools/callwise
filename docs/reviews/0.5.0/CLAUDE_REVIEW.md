# Claude review — Callwise 0.5.0 (`local-meetings`, PR #5)

**Reviewer:** Claude (planner/reviewer) · **Builder:** ChatGPT/Codex · **Date:** 2026-11-01
**Reviewed:** `local-meetings` at `118decb` (runtime tree from `9ac07ff`). All line numbers below refer to that commit. The PR says this tree is identical to the packaged build `23201dfb`, but that commit isn't on GitHub, so I couldn't check it myself.

## Verdict

The structure is good: sealed records with per-record AAD, a fail-closed key, a notice hash tied to recording and cloud choices, a configure guard during meetings, preview-and-fingerprint Apple exports, and an access check on every MCP call. But **0.5.0 isn't ready for real calls yet.**

Seven high-severity bugs:

- **Three hit normal use.**
  - After a restart, saved meetings disappear from History and queued recaps never run.
  - A speech-helper restart followed by Pause/Resume makes new speech **overwrite earlier transcript lines**.
  - Double-clicking *Start listening* leaves the whole call unsaved.
- **Two break participant-notice promises.**
  - With live help on, the **whole conversation** goes to OpenAI, but the notice says "relevant excerpts".
  - Past meetings picked as context are sent into live-help prompts, including their transcripts.
- **Two hit larger libraries.**
  - Backups silently drop rows past 100,000 per table.
  - Startup recovery deletes retained audio past 100,000 chunks.

Most fixes are small. Findings verified by running code are marked *reproduced* and list their script; those marked *code* or *calculation* come from reading the code. A separate independent pass rechecked every line reference and re-ran the scripts, and its corrections are included.

## What I ran

| Check | Result |
|---|---|
| `npm test` on Node **24.20.0** (the Node bundled in Electron 44.2.0) | **272/272 pass** |
| `npm run check` | pass |
| `scripts/verify-ui.mjs` and `scripts/verify-meeting-ui.mjs`, headless Chromium (repo Playwright pointed at this sandbox's Chromium build via `executablePath`) | both pass |
| Electron desktop smoke `--smoke` on Linux (Xvfb) | pass. Smoke mode never constructs `MeetingService` (`desktop/main.mjs:241`), so it doesn't exercise 0.5 meetings |
| **Real Electron app end to end** on Linux with a test-only keychain stand-in: notes-only meeting → quit → relaunch → History; *Delete all Callwise data* | reproduced H1 and M2 |
| Reproduction scripts against the real modules (`MeetingStore`, `MeetingService`, `CallController`, `AppleSpeechSession`, `MeetingMcp`/`runMeetingMcp`, `MeetingRecorder` + worker, `render.mjs`) | see *Reproductions* |

**Not possible here (Linux sandbox):**
- Building or running the Swift helper, Apple speech, Foundation Models or FluidAudio.
- EventKit, Notes/JXA, macOS permission prompts, signing, and the packaged app.

Swift findings come from reading the code. I skimmed the eight preserved 0.4.2 fixes and found nothing blocking.

---

## Bugs

### High

#### H1 — History is empty after every restart, and queued recap/enhance jobs never resume *(reproduced, including in the real app)*
- **Where:** `core/meetings/service.mjs:112`.
  - `all(table)` skips SQLite when `meetingId === this.unsavedMeeting`. With no `meetingId` and no unsaved meeting, both sides are `undefined`, so the store is never read.
  - Callers affected: `library()` (`:216`, which feeds History and the Ready view's past-meetings picker at `ui/views/meetings.mjs:29`) and job resume in `attach()` (`:43`).
- **Trigger:** Save any meeting, quit, relaunch.
- **Impact:**
  - History shows its empty state, so the meetings look lost. They are still stored, and search finds them.
  - Recaps queued at quit, or reset by `store.recover()` after a crash, are never generated.
  - In the real app, History listed the meeting before the restart and was empty after it. Searching "planning" still found it.
- **Fix:**
  - Initialize `this.unsavedMeeting = null`.
  - Change the check to `meetingId !== undefined && meetingId === this.unsavedMeeting`.
  - Resume queued jobs one at a time; otherwise every queued job spawns `callwise-native llm` at launch simultaneously.
  - Add a test: a store with a saved meeting and a queued job, then a new service. `snapshot().library` contains the meeting, and the job runs.
- **Caution:** once fixed, `library()` decrypts every header and calls `all("actions", id)` for each meeting on every `invalidate()`, which runs on every transcript update during a call. The record cache holds 48 groups, so a few hundred meetings thrash it. Keep a small cached library index (header subset plus open-action count) that updates only when meeting or action records change.
- **Repro:** `r7-library-restart.mjs`, `linux-e2e/e2e-history.mjs`.

#### H2 — After a speech-helper restart, Pause/Resume reuses segment IDs and new speech overwrites earlier lines *(reproduced)*
- **Where:**
  - `providers/apple-speech.mjs:163` (`recover()` does `this.epoch++`).
  - `desktop/main.mjs:211` (a new session starts at `epoch: options.captureEpoch`).
  - `main.swift:72` (the ID is `<channel>:e<epoch>:<utterance>`, and the utterance counter restarts at 0 in every process).
- **Trigger:**
  - During capture epoch 1, the helper restarts once. Causes: crash, the 20 s heartbeat timeout, stdin backpressure, or any **id-less** error line from the helper (channel errors such as `speech_input_overloaded` or a results-stream failure). Errors tied to a request ID only reject that request.
  - The restarted helper emits `mic:e2:N`.
  - The user then pauses and resumes, or the Mac sleeps or locks. That starts capture epoch 2 and a new helper, which emits `mic:e2:N` again.
- **Impact:**
  - In `CoachEngine.ingest`, a volatile result for an ID that already has a final is dropped.
  - The new final then replaces the old row's text and time, and the stored row is overwritten.
  - Earlier speech is lost silently. In the repro, the "Bravo…" sentence is gone and `mic:e2:0` now holds "Charlie…".
- **Fix:**
  - Make IDs unique per helper process. Keep `epoch = captureEpoch` and add a run counter (for example `mic:e1r2:0`), or pass a random session token.
  - Never advance `epoch` into the capture-epoch space.
  - As a safeguard, don't let a final from another epoch or run replace an existing final.
- **Repro:** `r1-epoch-collision.mjs`.

#### H3 — A second "Start listening" while the first is connecting marks the live meeting ended, so the call is never saved *(reproduced with main's handler logic)*
- **Where:**
  - `ui/views/meetings.mjs:35`: the notice dialog's button is disabled only by the checkbox, not while a start is in flight. The Ready view's *Start meeting* is disabled while connecting; this one isn't.
  - `ui/meetings.mjs:244-258` and `desktop/main.mjs:656-664`, which call `meetings.begin()` again.
  - `core/meetings/service.mjs:243-247`: `begin()` silently returns the existing active meeting.
  - `core/controller.mjs:337` throws "The connection is still starting."
  - `desktop/main.mjs:1056-1074`: the catch marks the **active** meeting `ended` + `interrupted`.
- **Trigger:** Double-click or double-Enter on *Start listening*. The Apple speech connect is slow enough for this to happen.
- **Impact:**
  - The first start succeeds and capture runs. The live transcript even shows, because it comes from the engine.
  - `observe()` ignores the meeting because its header says `ended`. The repro saved 0 segments and queued no recap.
  - The user sees a start error and, later, an empty "interrupted" meeting.
- **Fix:**
  - Disable the button and ignore re-entry while a start is pending.
  - In main, reject a start while `controller.connecting` **before** `begin()`.
  - Only mark a meeting failed if this call created it (keep the id `begin()` returned).
  - Make `begin()` throw "A meeting is already active" instead of returning it.
- **Repro:** `r4-double-start.mjs`. Lines 21-32 mirror `desktop/main.mjs:656-664` and `:1054-1077`.

#### H4 — With live help on, the whole conversation goes to OpenAI, but the notice says "relevant excerpts" *(reproduced)*
- **Where:**
  - `core/controller.mjs:1215-1260`: `maybeSummarize()` runs on every running state (`:119`) and, every 3 minutes of active time, sends every final turn since the last summary (`newTurns`).
  - `core/controller.mjs:115-118, 1128-1175`: `makeRecap()` sends the full transcript plus advice cards again after **Pause → End**, a typed or Fireflies meeting, or a sleep/lock auto-pause followed by End. Ending while running goes through `finishing`, so `wasActive` is false and this path is skipped.
  - Notice wording: `core/meetings/notice.mjs:24`.
- **Trigger:** Live help on and an OpenAI key saved.
- **Impact:**
  - Every final line of a live-help call longer than 3 minutes is sent to OpenAI, and some End paths send it all again, for a recap the 0.5 notebook never shows.
  - Participants hear only "Relevant conversation excerpts may also be sent to my configured AI service for live assistance."
  - Plan 3.3 required naming OpenAI. Plan D9 and 6.1 (line 518) replace the controller recap with the local pipeline, with OpenAI recaps as a separate opt-in.
  - The user's own profile is also sent, but that is the user's own data and is already sent with coaching requests.
- **Fix:**
  - Make the live-help wording accurate and name the provider, for example "While live suggestions are on, what we say is sent to OpenAI during the call."
  - Remove the controller's cloud recap when the meeting service is active.
  - Add a test that the requests made during and after a live-help call match the notice configuration.
- **Repro:** `r8-cloud-recap.mjs`. Its stub returns HTTP 500, so the provider retries and each call appears twice; a successful response sends one.

#### H5 — Past meetings chosen as context are exported, transcripts and notes included, into live-help prompts *(code)*
- **Where:**
  - `desktop/main.mjs:665-673` adds `meetings.export(id).slice(0, 16000)` as a `recap` material. That is the full Markdown export: recap, original notes, enhanced notes and transcript.
  - Coaching sends every loaded material (`core/engine.mjs:658`, `makePrompt({ materials })`), and so does preparation (`core/controller.mjs:1003`).
- **Trigger:** Live help on (OpenAI key or Codex) and past meetings selected under *Bring a little context*. Today H1 hides older meetings from that picker; once H1 is fixed, this is routine.
- **Impact:** Other people's words and the user's raw notes from an earlier meeting go to OpenAI or Codex. Those participants may have been told everything stayed on the Mac.
- **Fix:**
  - Send only the recap, decisions and confirmed actions.
  - Plan 4.10 also allowed up to five short excerpts relevant to the goal. Allow them only from past meetings whose own notice included cloud AI.
  - When live help is on, say in Ready that the selected meetings will be shared with the AI service.

#### H6 — Backups silently drop rows past 100,000 per table *(reproduced; large libraries)*
- **Where:** `core/meetings/store.mjs:204` (`all()` caps every read at `Math.min(100000, …)`); `backup()` at `:372` reads each table with `all(t)`.
- **Trigger:** More than 100,000 rows in any table. Segments reach that after roughly 100–200 hours of transcribed meetings.
- **Impact:** The backup reports success, but a restore gets only 100,000 rows. The repro wrote 100,050 segments and restored 100,000, with no error. The loss surfaces only at restore time.
- **Fix:**
  - Page through tables or snapshot the database (the plan's `VACUUM INTO` plus chunk files) and stream to the file.
  - Verify counts against `SELECT count(*)` before reporting success.
  - More broadly, `all()` must never truncate silently: page explicitly or throw.
- **Repro:** `r2-backup-cap.mjs`.

#### H7 — Startup recovery deletes retained audio once there are more than 100,000 chunks *(reproduced; large libraries)*
- **Where:** `core/meetings/store.mjs:302-313`. `valid` comes from `all("audio_chunks")`, which stops at 100,000 rows, and then every file under `audio/` not in that set is deleted (`:310`). The mark-missing loop (`:298`) and `prune()` (`:360`) share the cap, so retention isn't enforced past it either.
- **Trigger:** More than 100,000 chunk rows (10 s per channel), about **139 hours** of two-channel recordings kept at once. That means "Until I delete it", or **90-day retention at about 1.5 h/day** of recorded calls.
- **Impact:**
  - Recordings are permanently deleted at launch.
  - Rows are ordered by start time, so the ends of the longest meetings go first.
  - The repro went from 100,010 files to 100,000, and the last chunk now gives `ENOENT`.
  - Recovery also took about 10 s at launch, because it decrypts every chunk row twice.
- **Fix:** Build the valid set from plaintext columns in one SQL query, with no decrypting: `meeting_id` plus `id` = `channel:sequence` gives the path. Never delete after a capped scan.
- **Repro:** `r3-recover-audio-cap.mjs`.

### Medium

#### M1 — Backups fail with about 9 hours of retained audio *(calculation)*
- **Where:** `core/meetings/store.mjs:373-380` puts all audio into one base64 JSON value and seals it in memory. The worker posts the whole buffer, and main writes it (`desktop/meeting-commands.mjs:93-122`).
- **Impact:**
  - The encoder writes 48 kbps per channel, so two channels are 43.2 MB/h, or 57.6 M base64 characters per hour.
  - V8's `MAX_STRING_LENGTH` is 536,870,888 in Node 24.20 and Electron 44.2.0. At about **9.3 hours**, the backup throws and shows "Check the passphrase and available disk space."
  - Before that point, memory use is several times the library size, and there is a 120 s timeout.
- **Fix:** Stream a framed backup file (header, then sealed records and chunk files as frames), or the plan's snapshot-plus-files format. Report the real error.

#### M2 — "Delete all Callwise data" leaves deleted meetings in the running app, and editing one writes it back *(reproduced, including in the real app)*
- **Where:** `desktop/main.mjs:913-954` deletes rows through `meetingStore.deleteMeeting()` but never touches the `MeetingService` caches (`recordCache`, `lastLibrary`, `memory`, `cachedRows`, `selectedId`).
- **Impact:**
  - History keeps listing the meetings, and the open meeting's transcript stays on screen.
  - Search serves the old index until the next `invalidate()`.
  - Editing a listed meeting writes its header back to SQLite. In the repro, title and people were restored.
  - The archive key and backups under `meetings/` survive, as does the MCP audit log at `userData/meeting-access.jsonl` (+ `.previous`).
  - Main refuses only while `running`, not `paused` or `finishing`. The UI disables the button for all three.
- **Fix:** Add `MeetingService.deleteAll()`:
  - Abort jobs, close any finishing recorders and diarizers, clear all caches and ids, and close the search worker.
  - Close the store, remove `meetings/` and the audit logs, then reopen an empty library.
  - Refuse while any meeting is active.
- **Repro:** `r6-service.mjs` §1, `linux-e2e/e2e-delete-all.mjs`.

#### M3 — Meeting MCP: `meeting_search` stops seeing new meetings after its first search *(reproduced)*
- **Where:** `desktop/meeting-mcp.mjs:376` creates `MeetingSearch` once. In the headless process its `revision` never changes, and the worker builds its index on the first search and rebuilds only when the revision changes (`desktop/workers/search-worker.mjs:75`).
- **Impact:** Claude Desktop and Codex keep MCP servers running for their whole session, so meetings saved after the first search never appear. `meeting_list` is current, so the two tools disagree.
- **Fix:** Before each search, compare a cheap change token (`PRAGMA data_version` on the read connection, or a revision the app writes to `meta`) and bump the revision when it changes. The in-app search could use the same token instead of bumping the revision on every transcript update, which forces a full re-decrypt on the next search.
- **Repro:** `r5-mcp.mjs`.

#### M4 — Meeting MCP rejects normal legacy traffic *(reproduced)*
- **Where:** `desktop/meeting-mcp.mjs:238` treats any request with `_meta` as "modern" and then demands modern metadata (`:262-271`). `:248` throws `-32022` for any `initialize` version not on its list.
- **Impact:** A legacy `tools/call` with `params._meta.progressToken`, which is valid since 2024-11-05, gets `-32602 Modern MCP requests require…`. Initializing with `2024-11-05` gets an error instead of the lifecycle negotiation, in which the server answers with a version it supports.
- **Fix:** Classify as modern only when `_meta["io.modelcontextprotocol/protocolVersion"]` is present, and accept `_meta` after a legacy `initialize`. For an unsupported legacy version, reply with `protocolVersion: "2025-11-25"` (plan line 360). Add both cases to `tests/meeting-mcp.test.mjs`.
- **Repro:** `r5-mcp.mjs`.

#### M5 — The participant notice doesn't mention assistant (MCP) access, and meetings aren't bound to it *(code; plan 3.3)*
- **Where:** `core/meetings/notice.mjs:2-13` has no assistant-access field, and the mid-meeting configure guard (`desktop/main.mjs:618-637`) doesn't include `meetingMcpEnabled`.
- **Impact:** Meetings recorded under "Transcription happens on my Mac" become readable by Claude or ChatGPT once the switch is on, and those providers then process the excerpts.
- **Fix:** Add `assistantAccess` to the notice configuration, hash and wording ("I may later ask an AI assistant to search my notes"). Store it per meeting, and have MCP skip meetings recorded without it.

#### M6 — The objection flow only pauses *(code; plan 3.3)*
- **Where:** `core/meetings/service.mjs:891-906` (objection = pause + warning); `ui/views/meetings.mjs:114` ("Someone objected — pause now").
- **Impact:** The plan's "Stop and keep notes only" and "Also delete what was transcribed so far (and audio)" are missing.
- **Fix:** Implement the plan's dialog. I'd also require a fresh notice confirmation before resuming after an objection. That's my recommendation, not plan text; the plan only exempts ordinary Pause/Resume.

#### M7 — A suggested owner is stored as the supporting quote, and "Confirm changes" confirms it *(reproduced)*
- **Where:**
  - `core/meetings/recaps.mjs:73` sets `owner.name = quote("ownerQuote")`, and the UI pre-fills it (`ui/views/meetings.mjs:52`, `actions()`).
  - `ui/meetings.mjs:416-418` sends `confirmOwner: true, confirmDue: true` on any save.
  - Reminders then gets `Owner: <quote>` (`desktop/apple-followthrough.mjs:157`).
- **Impact:** The owner becomes text like `{"name":"I will send the proposal"}`. Saving only an edit to the action text confirms that quote as the owner.
- **Fix:** Take the owner from the cited row's speaker for a first-person commitment, or from a People/speaker name inside the quote, and keep the quote as `owner.evidence`. Confirm owner and due only when the user changes or explicitly confirms those fields.
- **Repro:** `r6-service.mjs` §3.

#### M8 — Renaming a speaker freezes the app and turns every line into a manual override *(reproduced)*
- **Where:** `core/meetings/service.mjs:573-588` calls `editSegment()` once per row (`:584`). Each call writes the row, touches the header and emits a full state, which serializes the whole meeting to both windows. `editSegment` also sets `speakerOverride: true` (`:549`).
- **Impact:** 1,500 lines took 6.7–9.3 s here with 1,501 state emissions. All 1,500 rows become overrides, so later diarization runs can't correct them. `mergeSpeaker` does the same.
- **Fix:** Keep `speakerKey` on rows and resolve names from the speakers table at render and export time. If rows must change, use one transaction and one emit. Set overrides only for explicit per-line reassignment.
- **Repro:** `r11-rename.mjs`.

#### M9 — "Ask your meeting history" runs the local model over every segment of the top five meetings *(reproduced)*
- **Where:** `core/meetings/service.mjs:913-934` passes every segment of each hit to `LocalDocuments.generate()`, with no cancel signal.
- **Impact:** Five hour-long meetings produce 69 chunks and **137 sequential local-model calls**, each spawning `callwise-native llm` (`desktop/native-host.mjs:198-211`), for one question. The renderer waits minutes.
- **Fix:** Answer from the search excerpts (hit rows plus neighbors, at most five meetings, one or two calls), with a timeout and a cancel option.
- **Repro:** `r6-service.mjs` §5.

#### M10 — One channel's speech failure takes down both channels *(code; verify on device)*
- **Where:**
  - `main.swift:168` creates the channels in one loop, so if the second analyzer fails, the whole `start` fails.
  - `main.swift:56`: `ignoresResourceLimits` is only available on macOS 27.
  - `main.swift:64` and `:101` emit channel errors without an id.
  - `providers/apple-speech.mjs:83` restarts the whole helper on any such error.
- **Impact:**
  - On the declared minimum of macOS 26 (only 27.2 was tested), a two-analyzer resource limit means no transcription at all.
  - A recurring error on one channel restarts both channels.
  - The give-up rule is 3 restarts in 60 s (`apple-speech.mjs:149-150`), so an error recurring every 20 s or more restarts forever. Every restart replays up to 15 s and sets up H2.
- **Fix:** Start the channels independently and report a per-channel `failed` status while the other keeps running. Separate fatal errors from channel errors. Test on macOS 26.

### Low

- **L1 — End during a Pause drain is ignored** *(reproduced, `r6-service.mjs` §6)*.
  - `core/controller.mjs:825` returns the pause's `drainJob`, so End leaves the engine `paused`.
  - Resume during a drain closes the helper mid-finish.
  - Fix: queue End behind the pause drain, and make start wait for or cancel it.
- **L2 — Main trusts the `start` payload** *(reproduced, `r6-service.mjs` §4)*.
  - `begin({ preferences: controller.preferences, ...payload })` (`desktop/main.mjs:664`) lets a payload `preferences` replace the ones used for the notice hash and the recorder.
  - `captureMode: "notes-only"` with `source: "audio"` skips the notice while the controller still starts audio (`service.mjs:261`).
  - A resume can switch a row-less manual meeting to `audio`.
  - All three need a modified renderer, since the normal Resume sends the current source (`ui/app.mjs:418-423`). Still, this is the privacy gate.
  - Fix: pick allowed fields explicitly, force `manual` for notes-only, and refuse source changes on resume.
- **L3 — The enhanced-notes textarea never refreshes** *(reproduced, `r10-textarea.mjs`)*.
  - `ui/render.mjs:48` never patches an existing `<textarea>`.
  - After *Use new version* or a regeneration, the box still shows the old text, and *Save edits* writes it back.
  - Fix: key the textarea by document version, or update it when it isn't focused or dirty.
- **L4 — An empty final leaves a phantom line** *(code)*.
  - `main.swift:71` advances the utterance without emitting, so the earlier volatile text keeps its ID and is finalized as "unfinalized" at End.
  - Fix: emit a discard for that ID; `onDiscard` already exists for OpenAI.
- **L5 — Apple Notes export problems** *(code)*.
  - `native/resources/apple-notes.js:12` calls `body()` once per note in the folder, which will hit the 30 s timeout in large folders. Use `folder.notes.whose({ body: { _contains: marker } })()`.
  - *Save* has no in-flight guard, so a double click runs two exports before either marker exists, duplicating notes and reminders.
  - "Saved" is shown when an existing note was found but not updated.
  - The full content travels in argv (ARG_MAX is 1 MB).
- **L6 — The headless MCP server appears in the Dock** *(code; verify on device)*.
  - The `--mcp-server` branch (`desktop/main.mjs:1409`) never calls `app.dock.hide()` or `setActivationPolicy`, which the plan required (line 357).
- **L7 — "Local speech ready" doesn't check language assets** *(code)*.
  - `readiness.core` and the badge use `SpeechTranscriber.isAvailable`.
  - A user who skips setup gets a failed first start, and an empty "interrupted" meeting is left behind (`main.mjs:1056-1074`).
  - Fix: check the chosen locale's assets, and drop the meeting if the start fails before capture.
- **L8 — Storage hardening** *(code)*.
  - AAD is `table:meeting:id` joined with colons, but IDs may contain colons (legacy IDs are `legacy:<hex>`). Use a length-prefixed encoding, with versioned AAD or a migration for existing libraries.
  - `atomicWrite` doesn't fsync, which matters for `archive-key.bin`: losing that file loses the whole library.
- **L9 — Export polish** *(code)*.
  - Reminders notes contain raw segment IDs (`apple-followthrough.mjs:157`).
  - The Notes export shows raw Markdown inside HTML.
- **L10 — Recovered meetings get no gap row and no recap** *(code)*.
  - `store.recover()` (`:269-290`) records the interruption only as an `events` row, not as a transcript gap row.
  - It never queues a recap, so interrupted meetings get none even after H1 is fixed.
  - Fix: queue one in `recover()`.
- **L11 — The first recap arrives as a draft when the user edits anything during generation** *(reproduced, `r6-service.mjs` §2)*.
  - `service.mjs:675-700` treats any notes save, title edit or diarization bump as "changed".
  - The recap then shows as a draft under "A fresh recap is ready. Your edited recap was kept." even though no recap was edited, and the main sections stay empty until *Use new recap*.
  - Adopting sets `editedAt` (`:880`), so every later refresh is also a draft and the auto title never applies.
  - Fix: use a draft only when an existing recap was edited after `basedOn`.
- **L12 — Deleting a recorded meeting right after End can leave its last audio chunk** *(reproduced with forced timing, `r12-delete-race.mjs`)*.
  - The final flush (≤10 s per channel, usually under a second) can land after `delete()`, leaving chunk rows and files that recovery, prune and *Delete all* never remove.
  - It needs Delete plus Confirm inside that window.
  - Fix: finish or discard the meeting's recorder in `delete()`, drop chunks for deleted meetings, and remove orphan chunk rows in `recover()`.

---

## Improvements (not bugs)

- **Main-thread cost late in long calls.** Each transcript update cost 17.4 ms at 3,000 rows here (`r9-perf.mjs`, Linux container; the M5 will be faster).
  - `observe()` hashes every row on every state event.
  - `MeetingService.snapshot()` calls `current()` three times and runs twice per event (controller, then main), so each event builds the meeting six times.
  - The 300-meeting library is resent with every event.
  - Track dirty rows and send the library only when it changes.
- **Diarization memory.** Audio is kept as Float32, about 460 MB at the 2-hour cap; the plan said Int16. Every provisional run reprocesses the whole buffer, and `applyTurns` rewrites every row each run.
- **Search.** Any change triggers a full library re-decrypt on the next search. Use an incremental index or the M3 change token.
- **Playback.**
  - Only 30-second windows, with no continuation and no per-channel modes.
  - Each 10 s chunk has its own LAME priming delay (about 46 ms).
- **MCP.**
  - Active meetings are listed and excerpted, including volatile drafts; exclude or label them.
  - Add `structuredContent`, and use `-32700` for parse errors.
- **Notes export.** Default to recap and actions, with the transcript optional (Notes may sync to iCloud), and pass data on stdin.
- **Enhanced notes** are formatting-only (`evidence: []`). That's fine if intended, but the plan wanted transcript-sourced additions, so label it that way.
- **Restart replay** re-sends up to 15 s of already-final audio, which produces duplicate lines. Replay only from the last final's `endMs`.
- **Language list.** `en-US` and the helper's `en_US` appear as two separate options.

## Real-device checks still pending

Already documented in BUILD_REPORT/VALIDATION: a consented real call on both channels, Notes/Reminders/Calendar permissions and exports, group-speaker quality, real-call accuracy, 45–60 minute stability, device switching, battery and resources, and upgrade continuity.

This review adds:
- **Two analyzers on macOS 26.x**, the declared minimum and untested (M10). Also count helper restarts during a 60-minute call (H2).
- **Local recap on 30- and 60-minute meetings** (plan 8.3 #6 wasn't run; only 15 s was validated). Check that 6.5 KB chunks fit the on-device context, plus total time and number of helper launches.
- **Diarization time on 60 minutes of audio.** The plan's target is ≤20 s per provisional run; only an 11 s clip was measured, at 4.3 s.
- **MCP from the real Claude Desktop and Codex:** which protocol versions they send (M4), the Dock icon (L6), keychain prompts for the headless process, and search freshness (M3).
- **Notes export into a folder with hundreds of notes** (L5).

## Suggested fix order

1. **H1, H2, H3**: losing or corrupting meetings in normal use.
2. **H4, H5, M5, M6, L2**: participant notice and privacy.
3. **H6, H7, M1, M2, L12**: backups and deletion. Remove the silent `all()` cap everywhere.
4. **M3, M4**: MCP.
5. **M7–M10**, then the remaining Lows.

When fixing, please turn the reproductions into tests under `tests/` and report results on PR #5.

## Reproductions

The scripts are in `claude-review-repros/`. Run them from the repository root with Node 24 (`node claude-review-repros/<file>`). They import the real modules and need no network or macOS APIs.

| Script | Shows |
|---|---|
| `r7-library-restart.mjs` | H1: History empty after relaunch; queued recap never runs |
| `r1-epoch-collision.mjs` | H2: restart, then Pause/Resume, overwrites `mic:e2:0` |
| `r4-double-start.mjs` | H3: second start marks the meeting ended; 0 segments saved |
| `r8-cloud-recap.mjs` | H4: all lines sent by the running summary during the call, and again by the recap after Pause → End |
| `r2-backup-cap.mjs` | H6: 100,050 segments backed up, 100,000 restored |
| `r3-recover-audio-cap.mjs` | H7: 100,010 chunks; after relaunch, 100,000 files; last chunk `ENOENT` |
| `r6-service.mjs` | M2 §1, L11 §2, M7 §3, L2 §4, M9 §5, L1 §6; §7 shows a read-only reopen of a closed WAL library works (not an issue) |
| `r5-mcp.mjs` | M3 stale search; M4 `_meta` rejection and no version negotiation |
| `r11-rename.mjs` | M8: 1,500-line rename, 1,501 state emissions, all lines become overrides |
| `r10-textarea.mjs` | L3: stale textarea after adopting a new version |
| `r12-delete-race.mjs` | L12: audio rows and files written after delete (compressed timing) |
| `r9-perf.mjs` | Per-update main-thread cost at 3,000 rows |
| `linux-e2e/` | Real-app runs on Linux with a test-only keychain stand-in (`wrapper/`), for H1 and M2 |

H5, M1, M5, M6, M10 and L4–L10 come from reading the code or from calculation, as marked.
