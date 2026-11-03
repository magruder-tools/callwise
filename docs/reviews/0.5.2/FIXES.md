# Callwise 0.5.2 — fixes for Claude's 0.5.1 follow-up review

Date: November 2, 2026. Base: `84e1a49` (0.5.1). Implemented by Claude on branch `claude/followup-fixes`.

The findings come from [CLAUDE_FOLLOWUP_REVIEW.md](../0.5.1/CLAUDE_FOLLOWUP_REVIEW.md); its line numbers refer to `84e1a49`. Every fix has a regression test in `tests/claude-followup-regressions.test.mjs` (21 tests), and all 21 pass here.

On `84e1a49`, 19 of them fail. The other 2 pass on both versions, because they check that the fixes don't go too far:

- a helper restart that fails keeps the old run's partial line;
- launch doesn't decrypt audio rows whose files are gone.

The log is [validation/new-tests-on-0.5.1.txt](validation/new-tests-on-0.5.1.txt).

**No Swift code changed.** The speech fixes are all on the JavaScript side. The native helper source is the same as 0.5.1, but the app must be packaged and signed again as 0.5.2.

## Fixes

| Finding | Change | Where | Tests |
|---|---|---|---|
| **N1** Resume after an objection from the menu bar or shortcuts | **The guard:** `CallController.start()` refuses to resume while the active meeting has an unresolved objection. That covers the window, the menu bar, Control+Alt+P, Control+Alt+Space and *Retry audio*.<br>**Timing:** the objection is recorded *before* the pause drains final words, and `start()` checks again after waiting for any drain. So nothing can resume during the up-to-3 s drain.<br>**Menu bar:** the *Resume* item is disabled. | `core/controller.mjs` (`start()`), `core/meetings/service.mjs` (`resumeBlocked()`, `meeting.notice`), `desktop/main.mjs` (tray menu) | N1 (2 tests) |
| **N4** "Delete transcript and audio" deleted the user's notes | **What is deleted:** captured content only:<br>• transcript;<br>• audio chunks and files;<br>• speaker names;<br>• jobs;<br>• AI documents (recap, enhanced-notes drafts, coaching);<br>• AI-suggested actions.<br>**What stays:** the header, the user's original notes, user-created actions, exports and events.<br>**The continuation:** the notes-only continuation gets the title and people. After "delete", it also gets the notes, the user's actions and the audit events (notice receipt, objection), and the emptied meeting is removed. One meeting then holds everything kept. After "keep", it is titled "… (continued)".<br>**Without saving:** a meeting started without saving keeps its continuation unsaved too.<br>**Other:** no recap is generated for deleted capture, the objection notice clears when the next meeting starts, and the dialog says the user's notes and actions are kept either way. | `core/meetings/service.mjs` (`meeting.objection.resolve`, `deleteCapture()`, `purgeCapture()`, `continueAfterObjection()`, `generate()`, `begin()`), `core/meetings/store.mjs` (`deleteCapturedContent()`), `desktop/meeting-start.mjs` (`continueFrom`), `ui/meetings.mjs`, `ui/views/meetings.mjs` | N4 (3 tests); M6 test updated; real-app run `linux-e2e/e2e-objection.mjs` |
| **N2** After Delete all, unset live help turned coaching on | One `DEFAULT_PREFERENCES` constant (live help off) is used at launch and after Delete all.<br>With the meeting notebook attached, the controller's cloud gates require `liveHelp === true` (`liveHelpOn()`), matching the notice. The legacy coaching flow keeps its old default.<br>Delete all recreates `codex-work`, so Codex sign-in and coaching keep working. | `desktop/main.mjs`, `core/controller.mjs` (`liveHelpOn()`, `setProviders()`, `prepare()`) | N2 |
| **N3** The MCP server served a deleted library | **Reopening:** the server records the identity (device and inode) of `library.db` and `archive-key.bin` when it opens the library, re-checks it before each call, and reopens if it changed. It also drops the open library whenever assistant access is off.<br>**Running meetings:** they get "still in progress" instead of the consent message. | `desktop/meeting-mcp.mjs` (`runMeetingMcp()`, `MeetingMcp`) | N3 |
| **N9** MCP search applied consent after a top-100 cut | The MCP search worker indexes only ended meetings whose notice allowed assistant access, and filters before cutting. The in-app search is unchanged. | `desktop/meeting-search.mjs`, `desktop/workers/search-worker.mjs`, `desktop/meeting-mcp.mjs` | N9 |
| **N12** Delete all left a locked library in place | When no store could be opened at launch, Delete all removes `meetings/` itself, then tries to open a new empty library. Otherwise the next launch creates one. | `desktop/meeting-start.mjs` (`removeUnopenedLibrary()`), `desktop/main.mjs` | N12 |
| **N5** One overload line stopped a channel; Retry audio did nothing | **Overload is a warning:** after `speech_input_overloaded`, the channel keeps being fed. One gap row is added per burst, at most every 10 s, stamped near the dropped audio. The channel is failed only if more than 10 s of its audio is dropped within a minute.<br>**Retry audio:** now pauses and resumes Apple speech when a speech channel failed or its session stopped. A failed capture device still goes to the renderer as before. | `providers/apple-speech.mjs` (`overloaded()`), `desktop/meeting-start.mjs` (`speechNeedsRestart()`), `desktop/main.mjs` | N5, Retry audio |
| **N8** Helper restarts capped at 3 per capture | The cap is now 3 restarts within 10 minutes, as a sliding window. | `providers/apple-speech.mjs` (`recover()`) | N8 |
| **N11** A partial line from a crashed run stayed as a duplicate | Non-final rows of the current helper run are tracked. After a restart, those whose audio was replayed are discarded, but only once the new helper has received the replay and only on channels that started. A restart that fails keeps them. | `providers/apple-speech.mjs` (`discardReplayedPartials()`) | N11 (2 tests) |
| **N6** One missing audio file failed every backup | **Missing files:** rows whose audio file is gone are handled when used. Playback says "This recording is no longer available." instead of a raw `ENOENT`. Backups save such rows as missing and report the count ("Backup saved. N audio pieces … couldn't be included").<br>**Launch:** it doesn't decrypt or rewrite these rows. A library with many missing files opens as fast as before, and an unreadable row can't lock it.<br>**Deletes during a backup:** they run a PASSIVE WAL checkpoint and truncate the WAL when the backup ends, so the window doesn't stall for the 5 s busy timeout. Delete all is refused while a backup is running.<br>**Timeouts:** a timed-out backup removes its partial file after the worker stops. | `core/meetings/store.mjs` (`readAudio()`, `backupRecords()`, `backupToFile()`, `checkpoint()`, `backupStarted()`/`backupFinished()`, `close()`, `recover()`), `desktop/meeting-commands.mjs`, `desktop/workers/archive-worker.mjs`, `desktop/main.mjs`, `ui/meetings.mjs` | N6 (3 tests) |
| **N7** A 0.5.0 backup with an orphan audio chunk restored part-way | The CWBACKUP1 path restores records and audio in one transaction, and skips audio whose meeting isn't in the backup. A failure leaves the library empty, with the audio folder removed, so a retry works. | `core/meetings/store.mjs` (`restore()`) | N7 |
| **N10** Long run-scoped IDs in local-model prompts | **Aliases:** the on-device model sees short aliases (`s1`, `s2`, …), and results are mapped back before validation. Chunks are sized with the aliases, and merges pass aliases and the owner quote. A model that echoes real IDs is still accepted.<br>**Effect:** a 700-row recap goes from 18 chunks and 35 local-model calls (0.5.1) to 13 chunks and 25 calls, with 30% fewer prompt bytes. | `core/meetings/recaps.mjs` (`evidenceAliases()`, `LocalDocuments.generate()`) | N10 (2 tests) |
| Improvements | An unexpected audio-index row no longer locks the library: recovery keeps every file and opens.<br>"Them", "Other" and "Speaker N" aren't suggested as action owners; "You" still is. | `core/meetings/store.mjs` (`recover()`), `core/meetings/recaps.mjs` (`namedSpeaker`) | Improvements |

**Not done:** moving the restore into a worker instead of the main process (a review improvement). The 11-hour library restore still runs synchronously for about 15 s.

## Independent review of this change

A separate agent reviewed the diff before it was committed. It found 2 Medium and 3 Low problems in the first version of these fixes; all are fixed and covered above:

- **Medium:** an objection raised during a pause's drain could still be resumed.
- **Medium:** a meeting started without saving had its continuation saved to disk.
- **Low:** the N11 discard dropped text when the restart failed.
- **Low:** recovery decrypted every missing-file row at each launch (8.3 s for 20,000 rows; now under 0.1 s).
- **Low:** Delete all during a running backup let the backup finish writing the deleted library.

It confirmed the rest: the controller guard can't block legitimate starts, the MCP reopen logic is sound, and the aliases survive merges and the "answer" task.

## Compatibility

- Libraries and backups keep the same format.
  - 0.5.1 and 0.5.2 read each other's libraries and CWBACKUP2 files.
  - 0.5.0 libraries and CWBACKUP1 files still open (`check-upgrade-050-library`).
- A CWBACKUP2 end frame now also carries a `missingAudio` count. 0.5.1's restore ignores it.
- New meeting-header fields (`objectionResolution`, `captureDeleted`) are ignored by 0.5.1.
- The MCP server reports version 0.5.2.

## Verification

All of this ran on Linux with Node 24.20.0 (Electron 44.2.0's Node), using synthetic data only. Logs are in [validation](validation).

| Check | Result |
|---|---|
| `npm test` | 317/317 pass: the 296 existing tests (the M6 test updated for the new objection behaviour) plus 21 new ones |
| The 21 new tests on `84e1a49` | 19 fail; the 2 guard tests pass (see the top of this file) |
| `npm run check` | pass |
| Both browser renderer checks | pass |
| Electron desktop smoke | pass |
| Real Electron app on Linux, with a test-only keychain stand-in | History after restart, Delete all, and the new objection run (`e2e-objection.mjs`) all pass. The objection run: notes kept, one notes-only meeting left in History, no transcript rows. |
| Every follow-up repro | re-run on 0.5.2: [validation/followup-repros-on-0.5.2](validation/followup-repros-on-0.5.2). The 0.5.1 outputs that show the bugs are in [../0.5.1/claude-followup-repros/outputs](../0.5.1/claude-followup-repros/outputs). |

## Still required on the Mac

None of this was done here:

1. Package 0.5.2 and verify the signature, as for 0.5.1.
2. Run a consented real call on both channels, including an objection:
   - the menu bar shows *Resume* disabled;
   - Control+Alt+P and Control+Alt+Space are refused, including during the pause's drain;
   - "Delete transcript and audio" continues with the notes;
   - try it once with "Start without saving".
3. Count `speech_input_overloaded` occurrences with two analyzers on macOS 26 and 27, especially right after a helper restart.
4. Run 30- and 60-minute local recaps with the new evidence aliases, and check that recap items and actions are kept.
5. Run Delete all while Claude Desktop or Codex keeps the MCP server running, then re-enable access: only the new library should be visible.
6. Run Delete all with the keychain prompt denied, then relaunch: there should be no old meetings.
7. Finish everything already pending in `../0.5.1/REVIEW_RESPONSE.md`: permissions and exports, group speakers, diarization and resources, device switching, real MCP clients.
