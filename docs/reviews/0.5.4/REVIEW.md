# Callwise 0.5.4: explicit recovery and visible processing

November 3, 2026. Continues draft PR #6 and the signed 0.5.3 personal preview. No native speech or speaker-model source changes.

## Implemented

- **Explicit unlock:** a failed Keychain gate stays latched until the user chooses Unlock saved data. Recovery is refused during capture or a restore, reopens the existing encrypted library without replacing its key, and reloads readable settings/connections. The open draft and in-memory meetings survive; a meeting started without saving remains unsaved. No automatic unlock timer or plaintext fallback was added. A separately running assistant process needs its connection reloaded after its own denied unlock.
- **Actual processing choices:** labels derive from the meeting's confirmed snapshot rather than later preferences. The notebook, live panel and tray distinguish local/cloud transcription, audio on/off/paused or retained, and cloud coaching. Assistant access appears separately when allowed.
- **Preview notifications:** the updater recognizes the repository's `callwise-X.Y.Z-preview` tags, filters drafts and unsafe release links, orders releases by version and respects the saved update-channel choice. Preview builds default to previews enabled; stable packaging overrides the channel to stable. Installation remains deliberate.
- **Background restore:** a worker decrypts and imports records/audio into an isolated staging library with progress. It supports current streamed backups and legacy 0.5.0 backups. Wrong passphrases, truncated files, worker failure/timeouts and conflicting draft IDs leave the original library intact. Publication preserves the Keychain-wrapped key, auxiliary files and shared store object identity. A small recovery journal handles an interrupted directory swap before the next library open. Capture, library mutations, backup conflicts, deletion and quit are blocked during restoration.
- **Hosted installers:** the existing review branch can publish an immutable signed preview only after the source, renderer and Mac jobs pass. It uses the already authorized reusable signing secrets. Tag releases retain stable-channel metadata. Published assets are never overwritten by the script.

## Validation

- 341 automated tests passed locally, including 12 new regression tests covering version selection, processing labels, deliberate unlock, unsaved-note preservation, unreadable keys, responsive worker restores, audio/key/auxiliary-file preservation, wrong passphrases, truncation, timeout, legacy backups, operation conflicts, interrupted publication and rollback.
- Both headless browser suites passed with synthetic data. The meeting suite covers the new processing labels, progress display, disabled restore controls, preview checkbox and explicit unlock action as well as notes autosave, participant gate, history and evidence navigation. An initial test-server import failure was corrected by sending processing labels in the existing snapshot instead of importing server code into the browser.
- GitHub Mac validation must pass before publication: syntax, full tests, production dependency audit, pinned assets, native build, Electron and packaged-app smoke checks, strict signature verification, bundled Codex contract, and an additional test that invokes the actual packaged background-restore worker using synthetic data.

## Remaining acceptance

Existing-Keychain approval/relaunch behavior, a consented real call, speech accuracy, real device permissions/Apple exports and long-session battery/performance checks remain device acceptance work. No user desktop automation, real capture, personal-library reads or installed-app replacement was used for this implementation. The installer is a personal self-signed preview, not Apple Developer ID/notarized distribution.
