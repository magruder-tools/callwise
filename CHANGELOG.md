# Changelog

## 0.5.2 — 2026-11-02

Fixes from Claude's follow-up review of 0.5.1 ([review](docs/reviews/0.5.1/CLAUDE_FOLLOWUP_REVIEW.md), [fixes](docs/reviews/0.5.2/FIXES.md)).

- After an objection, capture can't resume from the menu bar or the global shortcuts either, even while the pause is still saving final words; "Delete transcript and audio" keeps the user's notes and actions and continues them in a notes-only meeting with the same title and people (unsaved if the meeting was started without saving).
- One "speech fell behind" signal no longer stops a channel; Retry audio restarts Apple speech; occasional helper restarts in a long call keep transcribing; a restart no longer leaves a duplicate partial line.
- Delete all resets to the launch defaults (live help off), removes a library that couldn't be opened, is refused while a backup is running, and keeps Codex working; the assistant (MCP) server reopens a replaced library instead of serving deleted meetings, and indexes only meetings whose notice allowed assistant access.
- Backups skip audio files that are already gone instead of failing (and say how many), and meeting deletes no longer stall during a backup; 0.5.0 backups with an orphan audio chunk restore fully; a library with an unexpected audio index row still opens.
- The on-device model sees short evidence IDs; generic speaker labels aren't suggested as action owners.

The app version is 0.5.2. The 0.5.1 archive verified in docs/reviews/0.5.1 is not this build; package and verify 0.5.2 on the Mac before real-call checks.

## 0.5.1 — 2026-11-02

- Restore saved History and queued local documents after restart; prevent duplicate starts and transcript ID collisions after speech-helper recovery.
- Bind assistant access to each meeting's participant notice; name OpenAI in live-help notices, remove legacy cloud summaries/recaps, and reuse only selected recaps, decisions and confirmed actions.
- Stream authenticated encrypted backups without the 100,000-row cap or a single giant audio JSON string; retain recordings during large-library recovery.
- Clear decrypted caches, archive keys and local backups on Delete all; prevent late recording chunks from surviving a meeting deletion.
- Refresh long-lived assistant search, negotiate legacy MCP traffic, separate speech-channel failures, and bound/cancel meeting-history questions.
- Preserve speaker-diarization eligibility on rename, separate action-owner evidence from names and confirmations, refresh adopted enhanced notes, and complete objection handling with notes-only continuation.
- Serialize Apple exports, send Notes content over stdin, improve export formatting, durably save keys, and authenticate record identity with unambiguous versioned AAD.

Existing 0.5.0 libraries and backups remain readable. New records and backups require 0.5.1; do not downgrade after writing with this version. The app is an ad-hoc signed development build, not a notarized release. Real-call, permissions/export, macOS 26 dual-channel, and long-session validation remain separate checks.

## 0.5.0 — 2026-10-31

- Local Apple speech and on-device recaps with no required AI account; optional existing coaching remains separate.
- Participant-notice gate, meeting notebook, final-word draining, encrypted searchable history and recovery.
- Optional encrypted audio/playback, local group speaker labels, evidence-linked recaps and reviewed actions.
- Notes/Reminders export previews with duplicate prevention, calendar fill and read-only saved-meeting MCP connections.
- Retention, encrypted backup/restore, native helper/model packaging, and synthetic-only device validation.
- Preserves the newer local 0.4.2 draft, audio and connected-context fixes.

This is a local test build. Real-call accuracy, permission/export flows, long-call performance, battery use, and public-distribution trust remain separate checks.


## 0.4.2 — Upgrade and quit repair

- Stop audio and providers once before windows close; ignore events for destroyed window contents during shutdown.
- Recover legacy connection settings from the app's own user-data file into encrypted storage, preserving newer saved choices and unreadable files.
- Isolate native acceptance checks from the user's running app and saved data.
- Use Electron 44's documented ScreenCaptureKit loopback backend with the existing macOS screen/audio grant; reject denied capture requests cleanly.
- Report a context connection failure when no selected-app read actually completes, instead of showing a false empty search result.
- Bundle Codex's matching native tool host and enable selected-app tool discovery without enabling shell, browser, writes, or unselected apps.
- Supply exact runtime connector identifiers for source verification instead of relying on the model to infer them from tool names.
- Give connection setup its existing discovery deadline, then start the bounded source-lookup timer after the connection is ready.
- Accept the transcriber's observed “Calwise” spelling of the sound-check phrase while still requiring actual signal and the expected phrase.
- Allow 30 seconds for the microphone phrase, retain separate transcription segments without duplicating revisions, and offer a visible Finish check control.

## 0.4.1 — Round 2

- Preserve live controls, selections, transcript scroll and streamed card visibility; size the panel to its content and shrink after notices close.
- Keep the previous answer during automatic checks; place one expiring notice below the status bar and clean desktop command errors.
- Recognize sentence-level and short questions, join split turns, skip audio logistics, prioritize questions and tighten commitment candidates.
- Recover failed starts, offer Cancel, warn about silent call audio, keep Start visible and restore setup after Practice.
- Adopt preparation completed early in a call; allow 60 seconds and retry for prep and recap. Validate model-selected promises against final transcript evidence.
- Show a streamed sample call with sources, coverage, bigger-picture advice and a recap with two promises and an email.
- Improve panel typography and meters, use physical keys for shortcuts, retain pause/resume shortcuts while paused and send transcript deltas.
- Configure signing secrets automatically when GitHub CLI is authenticated. Add native desktop acceptance checks and the six-minute interview replay.
- Publish version-tagged personal Mac builds as GitHub Releases with verified installers, checksums, signing status and an exact build commit. Native checks account for capped display height and wait for command results in packaged builds.

## 0.4.0 — Complete call workflow

- Turn-based proactive help, speculative questions, streamed short cards, direct help priority, bounded requests and per-card response timing.
- Ready, floating Live panel, automatic Recap, Settings and three-step setup replace the old dialogs; accessible text, focus rings and reduced motion.
- PDF/DOCX and text materials, encrypted recent calls, preparation, coverage, verbatim commitments and opt-in carried recaps.
- Real API setup tests, microphone checks and loopback test speech; development-run warning.
- Independent recovery and preventive session rotation, microphone fallback, echo removal, adaptive voice detection, glossary/language hints and rolling memory.
- Editable estimated cost and stable GitHub Release update offers.
- DMG and ZIP packaging, persistent identity support and guarded release publishing; installation documentation consolidated.
- Completion audit: cancel interrupted streamed drafts; keep pin/dismissal through streaming; retain timely answers when completion is slow; surface typed deeper answers immediately.
- Reuse unchanged preparation, refresh it after every import, reject late preparation after Start, and show uncovered points on wrap-up cues. Backchannels remain silent when a background check is due.
- Let the existing Fireflies transport recover with visible transcript gaps; retain its meeting ID for pause/resume and report exhausted recovery.
- Packaged builds use encrypted credentials only. Custom read-only server settings are available in Advanced and encrypted; reusable materials retain connector provenance. Setup failures offer their specific fix, microphone permission has its own settings action, and first-run results show measured timings.

The live fast-model benchmark, real Mac capture/full-screen behavior and permission continuity across signed upgrades still require a real account/device. Development preview builds remain ad-hoc until persistent signing secrets are configured.

## 0.3.1 — Reliability milestone

Prevent demo setup from becoming real defaults; foreground asked/hotkey answers; rotate private diagnostics; independent bounded transcription recovery with visible gaps; correct active-time clocks; conditional, conflict-aware shortcuts; expiring/dismissible errors; independent file import; pre-call Fireflies import.

## 0.3.0

Read-only Codex app research with verified source provenance and explicit source selection.

## 0.2.x

Personal Mac downloads, microphone/system-audio capture, floating advice, encrypted connection settings and bundled Codex setup. Ad-hoc identity changes required refreshed macOS permissions between some builds.
