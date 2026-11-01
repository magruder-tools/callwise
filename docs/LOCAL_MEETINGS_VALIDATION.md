# Callwise 0.5 local build validation — 2026-10-31

Implemented from Claude's complete `callwise/plan@1` (SHA-256 `aedfef140590255311fb2d446bb2e0dc0bd299d577b73d93ceae1cc8c6de56cf`), originally saved in Apple Note p7732. The complete plan was imported verbatim, all sections read and END OF PLAN verified. Source work uses branch `local-meetings` from local commit `60acf70` (0.4.2), retaining eight fixes newer than the GitHub main version Claude audited. The exact review commit is recorded in the shared workspace/source snapshot.

## Observed checks

- **272 automated tests passed** in the final complete suite: existing 244 tests (the old key-required manual-input expectation was updated to the new keyless behavior), plus archive/crypto, notice, speech drain/epochs, native protocol, recaps, speakers, backup/retention, search/recording, Apple export previews/idempotency, disk-full retry and MCP/configuration tests.
- JavaScript syntax/desktop metadata check passed. Runtime dependency audit reported **zero vulnerabilities**. Pinned speaker model files passed size and SHA-256 checks.
- Original renderer layout checks and the Electron native/panel smoke passed, using only synthetic data and a temporary profile.
- The new meeting UI passed participant gate, autosaving original notes during transcript updates, End, source-linked recap/actions, evidence navigation at 640 px, history search, and settings. Screenshots are in `artifacts/meeting-ui`.
- The native executable compiled with Swift 6.4.2 on macOS 27.2 (M5 MacBook Air, 16 GB). Its dynamic-library references are system Apple/Swift libraries. Its embedded bundle identifier and Reminders/Calendar usage descriptions were verified without requesting permission.
- Both speech channels were exercised simultaneously from a generated **15.6845-second WAV**: five final segments per channel, **1 error in 49 reference words (2.0408% WER)**, and **86 ms** final drain in that run. The single-channel run also produced five finals, the same error and a 70 ms drain. These are synthetic file checks, not general accuracy or latency claims.
- Explicitly on-device structured recap generation returned successfully. Its content still needs human quality assessment on real meetings; source references and owner/date suggestions are validated before use.
- Bundled Core ML speaker inference processed an **11.076-second single synthetic voice** in **4.314 seconds** and returned a speaker turn. This verifies offline loading/inference, not multi-speaker accuracy or identity recognition.
- Search over **300 synthetic meetings / 18,000 segments** took **212.6 ms** for first index+query in the measured run; warm query median **14.2 ms**, measured high sample **22.4 ms**. This is a bounded synthetic corpus, not 300 hour-long real calls.
- A signed packaged app launched its synthetic native smoke. Packaged headless MCP passed modern discovery, legacy initialization, four read-only tool declarations and the access-off gate with a temporary profile. No real meeting archive was accessed by these checks. The packaged encrypted store, search worker and audio encoder worker were also exercised from inside app.asar with synthetic data; all passed. All 79 packaged runtime source files were compared byte-for-byte with the working source and matched.

Machine-readable synthetic reports: `artifacts/local-speech-benchmark.json`, `artifacts/local-speech-dual-benchmark.json`, `artifacts/local-diarization-benchmark.json`, and `artifacts/local-history-benchmark.json`. These are local ignored validation outputs; the shared build report preserves the measured summary.

## Build issues resolved

Apple's installed-locale listing was insufficient for the first speech start; preparing the English language assets made the module ready. The initial resampler stamped every converted buffer, causing Apple's audioDisordered error (17). Disabling priming and stamping only first/discontinuous input fixed it; both-channel verification then passed.

An older iCloud-synced node_modules tree stalled packaging on a file read. Packaging now runs in a clean temporary dependency tree. Copying a signed app with ordinary file-copy defaults rewrote framework symlinks; Apple ditto now preserves the app bundle links and the copied artifact passes strict signature verification.

Earlier concurrent test runs intermittently failed to launch the mock-gh fixture through its shell-selected Node. The fixture now pins the exact running Node interpreter; isolated and full verification are recorded with the final build. These tests use a fake gh executable and temporary certificates; no real signing identity, GitHub secret, account credential or release was changed.

## Implementation adjustments

- The actual FluidAudio v0.12.4 manifest has no NemoTextProcessing binary target; dependency revisions and upstream licenses are retained.
- Runtime structured GenerationSchema replaces @Generable macros because the installed Command Line Tools lack the FoundationModels macro plugin.
- Electron 44's actual bundled Node is 24.20.0; the tested development Node is 24.22.1. Native SQLite was verified in Electron itself before implementing the store.
- Sealed generic records implement the archive contracts with fewer plaintext schema columns. Raw meeting content is never written to SQLite/WAL in plaintext.
- Speech processes are recreated on resume to separate capture epochs. The SDK's resource-limit override is guarded for macOS 27. The declared macOS 26 minimum compiles; actual device execution was tested on 27.2.
- Capture/cloud/language choices require a fresh meeting/notice rather than changing an active meeting's participant receipt.
- Final build reports and review source are in the dedicated collaboration workspace, following the newer storage preference, instead of another personal Apple Note.

## Checks requiring a real first run

A consented microphone + system-audio call, actual Calendar/Reminders/Notes permission and export flows, multi-speaker quality, real-call word accuracy, names/glossary comparison, 45–60 minute stability, battery/resource use, device switches, and behavior across an OS/app upgrade remain unverified on real personal data. Synthetic success must not be presented as proof of these results. Optional live OpenAI/Codex inference was not used in validation.

The local app has an ad-hoc hardened-runtime development signature. It is not a persistent-identity or notarized public release. First-run permissions and a short consented test call are the next user-facing checks. No existing Applications install was replaced, and nothing was tagged or published to GitHub.
