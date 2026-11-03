# Callwise 0.5.3 user guide

Callwise is a meeting notebook for an Apple Silicon Mac running macOS 26 or later. It combines your own notes, local transcription, searchable meeting history, and follow-ups. Live cloud coaching and assistant access are optional.

## Download and install

The current preview is [Callwise 0.5.3](https://github.com/magruder-tools/callwise/releases/tag/callwise-0.5.3-preview). Use the **Callwise-0.5.3-Apple-Silicon.zip** attachment under Assets. GitHub's automatically generated Source code ZIP is for developers and does not contain an installable app.

1. Quit the previous Callwise app if it is running.
2. Download the app ZIP and double-click it to extract **Callwise.app**.
3. Drag Callwise.app into Applications. Replace the previous app there if asked. Keep one installed copy so shortcuts and assistant connections point to the same location.
4. Open Callwise from Applications. This personal preview is signed with a reusable Callwise certificate; it is not Apple-notarized. If macOS blocks the first launch, open System Settings → Privacy & Security and use Open Anyway after checking that the download came from this release.
5. In Setup, prepare the speech language, allow the microphone and Screen & System Audio Recording, and run both sound checks. Permissions for Notes, Reminders and Calendar are requested when you use those features.

Replacing the app does not delete its separate local meeting library. Do not use Delete all as an upgrade step.

## Keychain approval

Callwise uses macOS Keychain to protect the encryption key for saved meetings and connection settings. That protection remains enabled.

Earlier downloads had ad-hoc development signatures tied to the contents of each particular build. The 0.5.3 personal preview uses a reusable signing certificate so future builds signed with the same certificate retain the same app identity. Moving from the old app can still require one approval for **Callwise Safe Storage**. If the genuine macOS dialog offers Always Allow for this installed Callwise app, that saves the approval for that identity. A locked login Keychain may still require unlocking it.

The app also shares one secure-storage gate across its settings, archive, autosaves and assistant requests. A denied or unavailable unlock is not retried in that process. Existing encrypted files are preserved. Unlock Keychain, quit Callwise and reopen it when you want to retry. A corrupt saved file does not prevent other readable files from opening.

This prevents retry loops and addresses app identity changes; it does not promise that macOS will never request approval or a password. Real approval/relaunch behavior on the user's existing Keychain remains an acceptance check.

## How Callwise hears a call

There are two separate audio channels:

- **Microphone:** your selected input device, normally labelled You.
- **Call audio:** the Mac's system audio loopback, normally labelled Them. It captures a copy of sound being played by meeting apps or the browser, including when you use headphones.

The current implementation captures system audio rather than selecting just one meeting app. Music, videos and notification sounds playing on the Mac may also be captured while listening is active. Pause other audio during a call.

macOS calls the permission Screen & System Audio Recording because its capture API supplies a display track too. Callwise does not read, save or send video frames. It does not join the meeting as a bot or create a Zoom/Meet/Teams recording indicator. You share the participant notice aloud or in chat and confirm agreement before transcription starts.

Listening starts only when you start a transcribed meeting or deliberately run an audio check. Pause stops capture, End drains the last words, and sleep or screen lock pauses capture. Closing the notebook window during a meeting leaves capture running through the menu-bar control; quit asks to end and save the meeting first.

## Local and cloud processing

| Feature | Processing |
|---|---|
| Default transcription | Apple SpeechAnalyzer, on the Mac; prepare the selected language's assets first |
| Group speaker clustering | Bundled Core ML models, on the Mac |
| Enhanced notes, recaps and meeting-history questions | Apple Foundation Models on the Mac when Apple Intelligence is enabled and the model is ready |
| Saved history search | On the Mac, with an in-memory search index |
| Optional live coaching | Configured OpenAI or ChatGPT/Codex provider; relevant materials and conversation excerpts may leave the Mac |
| Optional OpenAI transcription | Audio goes to OpenAI using the API key you explicitly save and the speech engine you explicitly select in Advanced |
| Optional Claude/Codex saved-meeting access | Read-only local tools return selected information to the requesting assistant; its provider may process that information |
| Optional Fireflies input/import | Uses the separately configured Fireflies service and key |

There is no automatic fallback from local speech to cloud transcription. The core local workflow requires no AI account or API key. Initial speech assets and app/model downloads can require internet access. When on-device generative AI is unavailable, notes and transcription still work and recap output falls back to labelled source excerpts rather than cloud generation.

## Features

### Prepare a meeting

- Title, people, expected language, goal and optional group speaker identification.
- Bring up to three previous meetings as context. Optional cloud coaching receives selected recaps, decisions and confirmed actions from those meetings.
- Add PDF, Word .docx, Markdown, text, CSV, JSON, VTT or SRT materials, or paste notes.
- Fill title and people from a calendar event you choose.
- Run separate microphone and call-audio checks; choose an input device.
- Try a synthetic sample conversation without a call or AI credentials.

### During the meeting

- Type original notes alongside a live, timestamped transcript; queued notes autosave with version checks.
- Pause, resume and end with notebook controls, menu-bar controls or configurable shortcuts.
- Work in notes-only mode without audio capture. If the library is locked, explicitly start without saving and export the result before closing.
- Correct transcript text and speaker assignments. Rename and merge provisional group speaker labels. Group labels represent voice clusters, not verified identities; the microphone remains You.
- View audio meters and warnings, retry a failed channel, and see reported gaps or unfinished final words.
- Use the immediate objection control to stop capture. Keep the transcript or delete captured transcript/audio, then continue in notes-only mode. Pending notes are saved before the transition; deletion preserves your typed notes and user actions.
- If enabled and configured, open a floating live coaching panel for short answers, bigger-picture advice and on-demand help. Supplied materials and selected read-only connected sources can inform that optional coaching.

### Review and follow through

- Prepare local recaps with summaries, decisions, open questions and proposed actions linked to supporting transcript segments.
- Enhance notes into a separate editable version while preserving originals. Edited notes/recaps are preserved when newer generated drafts arrive.
- Review action owners and suggested dates against quoted evidence. Edit, confirm, dismiss, reopen or mark actions complete.
- Optionally retain encrypted audio and play it from the start or from a transcript line. Retained recording defaults to off.
- Save a reviewed meeting to an Apple Notes folder or selected actions to a Reminders list. Preview the content and destination first; stable markers prevent duplicate retries.
- Export Markdown or JSON. These ordinary exported files are plaintext; an encrypted backup is a separate feature.

### Find and reuse prior work

- Browse encrypted meeting history and search titles, people, original/enhanced notes, recaps, actions and transcript text.
- Filter by person, date and open follow-ups.
- Ask a question across saved meetings using bounded local evidence and source links; cancel a running question.
- Enable separate read-only saved-meeting tools for Claude Desktop or Codex after reviewing the connection. Available tools list meetings, search, retrieve a meeting and retrieve bounded excerpts. Only completed meetings with participant consent for assistant access are available. The connection does not copy raw assistant chat histories or change personal_mac.
- Import earlier Callwise recap history once; older records without transcripts are labelled as imported recaps.
- Advanced connections retain pasted conversation and Fireflies input options, and optional read-only Codex/custom-MCP context sources for coaching.

### Storage and controls

- Meeting content and optional audio are encrypted locally. Search indexes and working speaker audio remain in memory.
- Set separate retention periods for notes/transcripts and retained audio. Default notes/transcripts stay until deleted; retained audio defaults to 30 days.
- Create a passphrase-encrypted .cwbackup and restore into an empty library. Keep its passphrase separately; Callwise does not save it.
- Delete individual meetings or all local Callwise data with confirmation. Previous exports and backups remain wherever you saved them.
- Settings include language, input device, notice wording, panel behavior, hotkeys, optional providers/models, diagnostics and cloud usage estimates.

## What still needs hands-on validation

Automated and synthetic checks do not measure real-call transcription quality, simultaneous-channel stability, speaker accuracy, long-call battery use, Apple app permission/export behavior or existing-Keychain approval persistence. Try a short consented call and review both sides of its transcript, notes, playback and recap before relying on Callwise for important calls.

Large backup restores still run in the main process and can temporarily block the interface. Group speaker processing is bounded to the first two active hours and may switch to end-of-meeting processing if it falls behind. Local AI features depend on Apple Intelligence readiness and language support.
