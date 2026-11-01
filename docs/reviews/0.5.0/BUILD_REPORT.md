# Callwise 0.5.0 build report

This is a local development build ready for independent source review. The app was built from source commit `23201dfb262519fd3906f54b7857f85f7719d70a` on `local-meetings`; later commits in this branch add review documentation and evidence only. Eight local fixes newer than the old GitHub main (`a223f29`) were preserved.

The implementation includes local Apple speech, a participant-notice gate, meeting notebook, encrypted SQLite history/search, optional recording/playback, local speaker separation, source-linked recaps/actions, Apple Notes/Reminders export previews with duplicate prevention, calendar fill, read-only meeting MCP, and optional existing live coaching. Core local transcription needs no API account.

## Verified before this handoff

- 272 automated tests passed. The complete output is [validation/Tests.txt](validation/Tests.txt).
- JavaScript checks, original and new meeting UI checks, and source/packaged Electron smoke passed.
- Packaged encrypted storage, search and audio workers, native helper metadata, and both legacy and newer read-only MCP handshakes passed with synthetic data and temporary profiles.
- All 79 packaged runtime source files matched the source checkout byte for byte.
- A generated 15.6845-second speech file produced five final segments on each channel, one wrong word in 49 reference words, and an 86 ms final drain in the measured dual-channel run. This is a synthetic measurement, not a real-call accuracy estimate.
- Offline speaker inference loaded the pinned local model and processed an 11.076-second single synthetic voice in 4.314 seconds. This does not establish group-call speaker accuracy.
- Search over 300 synthetic meetings / 18,000 segments measured 212.6 ms for first index plus query and 14.2 ms warm median. This is not a library of 300 real hour-long calls.

Full implementation adjustments, environment, and remaining checks are in [VALIDATION.md](VALIDATION.md). Raw synthetic measurements and UI images are under [validation/](validation/).

## App archive identity

File: `Callwise-0.5.0-Apple-Silicon.zip` (280,517,293 bytes).

SHA256: `17127f12b011600338ca28c913323fc3ef2b017a8dd2d04a8a00295c829a5833`.

The archive is an Apple Silicon macOS 26+ development build, with an ad-hoc hardened-runtime signature. It is not notarized and does not have a persistent signing identity. The binary ZIP is supplied separately for inspection; the repository contains reproducible build scripts and pinned dependency/model manifests. No real meeting data or credentials are included.

## Still open

Claude's independent review has not happened. A consented real microphone/system-audio call, actual Notes/Reminders/Calendar permissions and exports, group-speaker quality, real-call accuracy, 45–60 minute stability, device switching, battery/resource behavior, and upgrade behavior remain unverified. Optional live OpenAI/Codex inference was not used in validation.

Participant notice must actually be delivered in the call by the user; copying notice text or checking the local gate does not deliver it. No public release, version tag, or replacement of the installed app is part of this review handoff.
