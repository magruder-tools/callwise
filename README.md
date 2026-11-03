# Callwise

## Callwise 0.5.2 review fixes

Claude's 0.5.0 review and reproductions are archived with the project. The [0.5.1 response](docs/reviews/0.5.1/REVIEW_RESPONSE.md) maps each finding to its fix, regression checks and remaining device validation. Claude's [follow-up review of 0.5.1](docs/reviews/0.5.1/CLAUDE_FOLLOWUP_REVIEW.md) and the [0.5.2 fixes](docs/reviews/0.5.2/FIXES.md) cover the issues found after that. This is a development build; a consented real call is still required before relying on it.

The local meeting implementation, Claude plan, build report, validation evidence and review instructions are together in [docs/reviews/0.5.0/START_HERE.md](docs/reviews/0.5.0/START_HERE.md). Review the `local-meetings` pull request; `main` stays unchanged until review is complete.

A local meeting notebook for Apple Silicon Macs: your own notes, a live transcript, source-linked recaps, searchable history, and optional live coaching.

Callwise 0.5 requires **macOS 26 or later**. Speech uses Apple SpeechAnalyzer. Recaps and enhanced notes use the explicitly on-device Apple Foundation Models service when available. Core meeting features need no AI account or API key. The retained audio switch defaults to off.

## Your first meeting

1. Open the app and prepare your speech language in Setup. Run the microphone and call-audio checks when you are ready; only those checks listen.
2. Add a title and people. Optionally choose up to three previous meetings or add materials. Start a meeting, share the participant notice aloud or in the call chat, and confirm everyone agreed.
3. Type your own notes beside the transcript. Pause stops capture; End drains the final words, saves the meeting, and prepares a recap. You can also choose **Just take notes** without starting audio capture.
4. Review the source links and proposed follow-ups. Confirm any owner or date before exporting selected actions to Reminders. Choose a Notes folder to save a meeting, or export Markdown/JSON.

The notebook stays visible during meetings. An optional floating coaching panel and a menu-bar control provide help, pause, and end controls. Closing the notebook during a meeting leaves the menu-bar indicator and capture running; quitting asks to end the meeting and flushes your pending notes first. Sleep and screen lock pause capture.

## Participant awareness

Callwise has no meeting bot and cannot automatically create a Zoom/Meet/Teams recording indicator. **You deliver the notice in the call.** Copying text and playing a local sound do not notify remote participants. Each transcribed meeting records the notice wording, confirmation time, delivery method and settings. Changed recording/language/cloud choices require ending the current meeting and confirming a fresh notice in the next meeting. A new participant can be given the notice again; an objection has an immediate pause control.

## Local history and privacy

Titles, people, transcript text, notes, recaps, actions and audio are encrypted on this Mac. The random archive key is protected by the macOS keychain. A locked or missing key is never silently replaced. Search runs in a worker with an in-memory index. Transcripts and notes are retained until you delete them by default; retained audio defaults to 30 days. Review and confirm any retention changes in Privacy.

A retained recording uses encrypted, independently playable MP3 chunks. Playback is a deliberate action and can start from a transcript line. Deleting a meeting deletes its local records and audio; exported copies and previous backups remain where you saved them. An encrypted `.cwbackup` uses a separate passphrase and restores into an empty library. A standard file export is plaintext.

Previously carried Callwise 0.4 recaps are imported once into history; their original encrypted calls file is preserved. They are labelled as imported recaps, without inventing missing transcripts.

See [Privacy](docs/PRIVACY.md), [local meeting architecture](docs/LOCAL_MEETINGS.md), and [validation](docs/LOCAL_MEETINGS_VALIDATION.md).

## Optional extras

- **Group speakers:** bundled, pinned FluidAudio Community-1 Core ML models identify voice clusters locally. Labels are provisional and can be renamed, reassigned or merged. They are not guaranteed real identities. Your microphone remains “You”; normal remote audio remains “Them” when group processing is unavailable. Group PCM stays in memory, bounded to the first two active hours.
- **Live coaching:** existing OpenAI and ChatGPT/Codex connections remain available, off by default. Relevant supplied materials and conversation excerpts may go to that provider when enabled. OpenAI transcription remains an explicit Advanced option with its own saved key; there is no automatic cloud fallback. A sample conversation requires no credentials or recording.
- **Apple apps:** Notes and Reminders exports require a reviewed destination and preview. Stable markers prevent duplicate saves/retries. Calendar access is requested only when you choose to use an event.
- **Assistants:** enable saved meeting access in Settings → Assistants and review the separate Claude Desktop or Codex connection. It exposes only read-only `meeting_list`, `meeting_search`, `meeting_get` and `meeting_excerpt` tools. Turning access off takes effect on the next request. It does not change `personal_mac` or synchronize either assistant's raw chat history. Requested meeting excerpts may be processed by the requesting assistant's provider.

## Development

Use Node 24.15 or later, an Apple Silicon Mac with macOS 26+, and Apple Command Line Tools containing the Speech and Foundation Models SDKs. The tested local environment uses Node 24.22.1, Swift 6.4.2 and macOS 27.2. The native helper uses a runtime generation schema, so building it does not require the FoundationModels macro plugin absent from Command Line Tools.

```sh
npm ci
npm run models:fetch
npm run build:native
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm run test:meetings
```

`npm run models:fetch` downloads only the supported Community-1 files at the immutable revision in `native/resources/diarization-models.json`, checks their sizes and SHA-256 values, and retains the model license/provenance. The app loads these files directly and has no runtime model-download fallback.

`./script/build_and_run.sh` is the project Run action: it verifies assets, builds the native helper, packages and launches the local app. `npm run dist:mac` prepares assets, builds the helper, bundles the existing pinned optional Codex runtime, and creates an Apple Silicon DMG/ZIP without publishing. `CALLWISE_NPM_CLI` can name a working npm CLI when the developer's Node runtime does not bundle npm.

Synthetic-only device checks:

```sh
npm run bench:local
npm run bench:local -- --dual
node scripts/bench-diarization.mjs
npm start -- --smoke
```

These generate file audio and temporary test data. They never open a microphone, capture an actual call, use API inference, or send messages. They do not replace a real consented call test, speaker-quality review, battery measurement or notarization.

The existing GitHub publishing workflows remain explicit release actions; local builds do not tag or publish a release. Public distribution should use a persistent signing identity and separate notarization validation. A development signature can require fresh permissions and is not a notarized release.

## License

GPL-3.0-or-later. See [third-party notices](THIRD_PARTY_NOTICES.md), including LGPL MP3 encoding, Apache-2.0 FluidAudio and CC-BY-4.0 Community-1 model attribution. The optional bundled Codex executable retains its own license and notice files.
