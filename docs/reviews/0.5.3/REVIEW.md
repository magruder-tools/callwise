# Callwise 0.5.3: Keychain and installation follow-up

November 3, 2026. Continues the reviewed 0.5.2 source in draft PR #6. No Swift or transcription-engine source changed.

## Problem and changes

The user reported repeated Callwise Safe Storage password prompts. The earlier 0.4.1 release and 0.5.2 preview both used ad-hoc signatures whose designated requirements were tied to build-specific code hashes. Electron documents that an inconsistent signature can cause renewed Keychain approval after updates: https://www.electronjs.org/docs/latest/api/safe-storage.

- `desktop/secure-storage.mjs` provides one lazy gate per process. A denied/unavailable initialization or failed encryption stops further attempts until the app reopens, preserving existing encrypted files. Successful availability is reused; a corrupt ciphertext does not block other readable files. There is no plaintext fallback.
- `desktop/main.mjs` uses Electron's default import and defers construction of safeStorage until a real storage operation needs it. Smoke and MCP discovery avoid explicit secure-storage initialization. Main-process and headless-assistant operations use the same gate implementation.
- Version-tagged Mac publishing sets CALLWISE_RELEASE=1, so its existing signing guards refuse to publish ad-hoc builds when the reusable certificate is absent.
- The owner explicitly authorized creating an isolated signing Keychain, private signing backups and encrypted GitHub Actions signing secrets. Private keys/passwords are excluded from source, archives, logs and documentation. Future builds must reuse the same certificate.

This addresses two prompt causes: repeated failed attempts and changed app identity. It does not establish that the user's existing login Keychain will never ask again. Moving from an old ad-hoc build, a locked Keychain, changed trust settings or a new certificate can still need approval. The existing-Keychain first-approval/relaunch check remains pending.

## Validation

- 329/329 automated tests pass on the Mac; 133 JavaScript modules pass syntax/metadata checks.
- Six new regressions cover lazy assistant discovery, denied startup/read/write/assistant requests, initialization failure, successful reuse with a corrupt file, encryption failure and rejection of plaintext storage.
- The private signing identity was tested using an isolated build Keychain without changing the login Keychain or system trust roots. A synthetic signed executable passes strict verification; its requirement uses the certificate hash rather than a code hash.
- The signed 0.5.3 app's requirement is `identifier "local.callwise.desktop" and certificate leaf = H"90c6d640f5f3a1b9ccba5c979132199be1d8fbaf"`.

The final archive verification, packaged regression and GitHub build results are recorded with this review's validation evidence. Real-call and Apple-permission acceptance checks listed in the 0.5.2 Mac review remain open. This is a personal, self-signed preview, not an Apple Developer ID or notarized distribution.

## Verified installer

The final ZIP was extracted into a fresh temporary directory. Deep, strict signature validation passes with access to macOS's certificate verification service. All 82 runtime files and the bundled README match the source, package metadata matches after standard build pruning, and all 33 follow-up/objection/Keychain regressions pass inside the packaged Electron runtime.

The signed app also completes its synthetic desktop acceptance check: both pages load; panel sizing, 40/40 native button presses, selection stability, wrong-key/offline recovery and sample recap rendering pass. Intentional wrong-key and offline fixtures produce error lines in the successful smoke log; they are not real provider requests. An initial native selection check overlapped browser work and failed; with an uninterrupted test window it passed without a renderer change. This does not replace a real call.

A restricted signing check initially reported an invalid certificate signature because it could not reach macOS verification services. The extracted and original bundles are byte-identical; both pass strict verification when the service is accessible. No signature was bypassed or certificate trust root changed on the user's Mac.

Archive: **Callwise-0.5.3-Apple-Silicon.zip**, **281,784,004 bytes**. SHA256: `9918729234aa67a01d628ecfa657f95c9aae9c86ac5153f902e6055112c14d43`.

[Validation evidence](validation) contains the full source test run, packaged acceptance and regression runs, package log and archive comparison report. The private signing backup is outside the repository.
