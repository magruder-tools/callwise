# Callwise 0.5.2 — independent review and Mac build

Reviewed November 3, 2026 by Codex. Baseline: Claude's `3d00c2d615b734f74fd53208c74d6c788edcdc63`, based on `84e1a49d395ff61ca7e1c0704c624ea309e2837a`.

## Result

Claude's 12 follow-up fixes are present, and all 317 supplied automated tests pass on this Mac. Independent review found one remaining notes-loss path in the objection continuation. The additional fix below is included in this reviewed build. All 323 tests pass after that fix.

The build is ready for supervised acceptance testing. It is not yet validated for routine real calls. Packaging and synthetic tests do not establish microphone/system capture quality, two-analyzer stability, actual Apple app permissions, or real assistant-client behavior.

## Additional finding and fix

**Medium: the objection continuation could lose the latest typed notes.** In `ui/meetings.mjs`, the keep/delete handlers resolved the objection and started a new meeting without waiting for the renderer's 600 ms note autosave. When Delete was selected quickly, the continuation copied the previously saved text and removed the original meeting; the pending note save then failed against the deleted ID. The same transition needed to wait for a save already in flight and preserve recoverability when saving failed.

The fix calls `flushNotes()` before resolving either objection choice. Capture has already paused, so waiting for notes does not delay stopping recording. If saving fails, the deletion and continuation are refused and the existing notes-save error directs the user to preserve the text.

Six regression cases in `tests/objection-note-handoff.test.mjs` exercise the production renderer handler, controller and meeting service:

- Queued edits survive both Keep and Delete, with a saved meeting and with Start without saving.
- An in-flight save finishes before the continuation copies notes.
- A failed save leaves the original meeting paused and recoverable instead of deleting it.

The reproduction before the fix kept only `Previously saved note`; it lost the newly typed addition and left the UI in a saving state. The same reproduction after the fix preserves the entire text and clears that state. All fixtures are synthetic temporary libraries.

## Verification completed on this Mac

| Check | Result |
|---|---|
| Packet integrity | Bundle and patch SHA256 match HANDOFF.md; standalone and archived HANDOFF.md match |
| Base | GitHub PR #5 remains draft at `84e1a49`; no rebase was needed |
| Imported source | Bundle commit and tree match Claude's specified identities |
| Supplied suite | 317/317 pass with Node 24.22.1 |
| Reviewed suite | 323/323 pass after the additional fix |
| JavaScript check | 131 modules pass |
| Meeting and shared renderer checks | Pass using installed Chrome with temporary synthetic test profiles |
| Native Swift helper | Release build succeeds; no Swift source changes |
| Apple Silicon archive | Extracted to a fresh temporary directory; strict deep codesign verification passes |
| Packaged source | All 81 files under core, desktop, providers and ui match byte-for-byte; package metadata matches after the builder's standard removal of development fields |
| Packaged runtime | Claude's 21 follow-up regressions plus the 6 added regressions pass: 27/27 |

Mac logs are under [validation/mac](validation/mac). The first restricted test run could not open a local test server; rerunning with local-loopback access passed. The default Playwright browser was absent; both renderer checks passed using the installed Chrome executable in isolated test profiles. These were environment limitations, not application test failures.

The archive is version **0.5.2**, requires **macOS 26.0 or later**, is **ad-hoc development signed**, and is **not notarized**. It is 280,531,537 bytes. SHA256: `cf432ca33158da5b8337bd091800efd11196ca210c319523f7f186a86d9fbb74`.

## Still open

- A consented real call on both channels, including menu-bar/shortcut objection behavior and the notes-only continuation.
- Actual overload/restart observations with two Apple Speech analyzers on macOS 26 and 27.
- Real 30/60-minute Foundation Models recaps and action retention with the new evidence aliases.
- Delete all while real Claude Desktop/Codex clients remain connected, and the keychain-denied deletion/relaunch scenario. Synthetic MCP replacement checks pass; they are not a real-client acceptance test.
- Apple Notes, Reminders and Calendar permission/export flows; group speaker accuracy, device changes, long-call resources and battery behavior.
- Large restores still execute on the main process. Claude reports roughly 15 seconds of blocking for the synthetic 11-hour library; this performance improvement is not implemented or independently re-measured here.

The installed app has not been replaced. No real recordings, personal notes or exports were opened. No real call was captured. Nothing has been merged or released.

## GitHub provenance

The GitHub connector imports Claude's exact tree (`26a9a5f9589edaee5f6bedfdf535730b680d85c9`) as an API-created commit, followed by this small independent fix and Mac validation records. The imported commit has a different commit ID from Claude's signed original. The original signed commit remains in the local bundle and the source-and-review archive. The new draft targets `local-meetings`; it does not merge PR #5 or change main.
