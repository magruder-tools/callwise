# Milestone 1: reliability fixes

Candidate: Callwise 0.3.1. Based on `main` at `6c13d2d` and
[Claude's brief](CALLWISE_BRIEF.md). This is the first checkpoint, not completion
of the six-milestone redesign. Stop here for Matthew's Mac validation.

## What changed

- Demo settings cannot become saved real-call defaults, even after End or
  Resume. Previously saved Northstar demo defaults are repaired on load.
  Renderer edits send one field at a time; Start no longer reposts the form.
- New cards appear immediately unless the current card is kept. Typed answers
  and help requests always become current in the main lane and identify their
  origin. Previous cards remain in history. Missing evidence gets a visible
  explanation rather than silently swallowing an explicit request.
- Errors have identifiers, expiry and dismissal. Connection errors clear after
  recovery or successful resume. One banner shows the error; there is no duplicate
  error toast. Upstream response messages and bodies are not echoed.
- Mic and call-audio transcription connect in parallel and recover separately.
  Retry backoff starts at 0.5 seconds and caps at 8 seconds, for at most a minute.
  Up to 15 seconds of unacknowledged or disconnected PCM stays in memory and is
  replayed after reconnection. A larger loss produces a visible transcript gap
  that is also provided to coaching prompts. Abandoned partial transcripts are
  removed before replay; finalized PCM is released.
- Nonfatal Realtime error events are logged without stopping the connection.
  Authentication, permission and depleted-credit errors stop the affected channel
  with a specific error; the other channel and call remain running. Pause, End
  and New cancel retries and release buffered audio.
- Global shortcuts exist only while a call runs. Conflicts are reported.
  Control–Option–Space: help; Control–Option–P: pause; Control–Option–[ / ]:
  previous/next card; Control–Option–H: show/hide. After pausing, bring Callwise
  forward and use Resume or Control–Option–P; the global registration has been
  released as required by the brief.
- Opening Connections no longer starts Codex discovery. Pre-call Fireflies
  history import works. Each selected text file imports independently, with a
  count and reasons for skipped files.
- The clock and audio timestamps count active time. Two active hours produce a
  warning and four active hours end the call. The returned startup snapshot no
  longer leaves the renderer stuck on Connecting.
- Help → Copy diagnostics and the app's More menu copy a redacted settings
  summary plus the latest 200 structured log events. Logs rotate at 1 MiB across
  five files in the app data folder. Version metadata, state, capture, retries,
  request timings and constrained provider error codes are logged. Keys, paths,
  transcript, material, prompts and response text are excluded.

No runtime dependencies were added. Codex, MCP and Fireflies provider code and
their integration policies remain unchanged.

## Verification

- Baseline: all 118 existing tests passed before implementation.
- `npm test`: 138 tests passed, none skipped, using Node 24.19.0 on Linux.
- `npm run check`: 52 JavaScript modules passed syntax and metadata checks.
- `npm audit --omit=dev --audit-level=high`: zero reported vulnerabilities.
- Fake WebSocket integration checks: simultaneous startup, a mid-utterance
  close, replay and final segment delivery, the other channel continuing, a
  20-second loss marker after overflowing the buffer, bounded exponential
  retry, terminal quota errors, stalled segments, and cancellation during
  recovery.
- Real renderer/controller DOM checks: kept versus newly arrived cards,
  explicit answers replacing the main card, single-field edits, preference
  repair, error dismissal/resume, and no unsolicited app discovery.
- The loopback demo server starts successfully. A Playwright visual run could
  not launch: no Chromium binary was installed, and the browser download returned
  an invalid archive. No local browser screenshots or pixel validation are claimed.

The old suggestion-focus test was rewritten deliberately: new arrivals replace
unkept cards; kept cards remain. The provider-error test now asserts structured
HTTP status and safe wording rather than requiring "401" in user-facing text.
The renderer test requests proactive demo advice directly because the help
hotkey now counts as an explicit ask.

## Not verified here

Real macOS capture and permissions; a real Wi-Fi outage; full-screen window
behavior; shortcut availability on Matthew's Mac; OpenAI transcription quality
and response latency with his account. Automated recovery fixtures cannot prove
these. No live API request or credential change was made.

The companion `callwise-ui-reference.html` was not supplied and is absent from
the repository. It will be needed for the later visual redesign. Fireflies live
disconnects still use the existing pause policy: safe gap reporting would require
more than the brief's permitted one-line change, so its provider was left alone.
Device-switch recovery and proactive answer timing remain later milestones.

## Five-minute Mac check

Install the candidate build from this branch's **Mac download** workflow artifact
(`Callwise-Apple-Silicon`). Use a practice call with headphones and participant
consent.

1. Before running the sample, set your own call type and goal. Run the demo,
   End it, change a setup field, then choose New session. Your own goal and call
   type should return. An installation that had Northstar defaults should now
   use the general defaults until you enter your own.
2. During the sample, Keep a card, then type a question. The answer and "You
   asked" line should replace it without clicking New suggestion. Check
   Suggestion history for earlier cards.
3. Start a live practice call, speak, turn Wi-Fi off for ten seconds, keep
   talking, and turn it back on. The call should stay running, show Reconnecting,
   and catch up. If recovery fails, copy diagnostics. Test a longer outage later
   if you want to confirm the visible missed-audio marker.
4. With no call running, use Command–Shift–P in VS Code or another app. It should
   work there. During a sample call try the new Control–Option shortcuts. Pause
   should freeze the clock and release the shortcuts.
5. Choose Help → Copy diagnostics, paste the result somewhere and inspect it.
   It should contain version and event metadata, with no API key, goal, profile,
   transcript or imported text. Trigger an error, dismiss it, and confirm it
   stays gone after a state update; a successful resume clears connection errors.

Do not treat the checkpoint as a live-call reliability guarantee until these
checks have passed on the Mac.

## Implementation references

- [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription):
  24 kHz PCM, explicit append/commit, session acknowledgement and item IDs.
- [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut):
  registration after app readiness, boolean conflict result and unregistering.

Checked against official documentation on October 8, 2026. Synthetic tests use
those interfaces; they do not establish provider entitlement or native behavior.
