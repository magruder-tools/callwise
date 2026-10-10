# Round 2 validation

Implemented the five groups in `CALLWISE_ROUND_2.md` against main at `f2f243e` (v0.4.0). The uploaded Markdown is preserved in this directory. The referenced `callwise-ui-reference.html` was not attached, so visual work follows the written dimensions and typography; a reference comparison remains unavailable.

The requested implementation covers all five groups. The document's checkpoint pauses were treated as review guidance, not as separate instructions to stop the work.

## Automated results

| Check                   | Result                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`              | 209 passed, zero failures                                                                                                                                     |
| `npm run check`         | 86 JavaScript modules checked; desktop metadata and secret exclusions present                                                                                 |
| `npm run replay`        | Four offline fixtures passed; all 11 help turns in the six-minute interview requested help immediately, including wrap-up; 65 trigger examples, zero failures |
| `npm run test:ui`       | Eight browser layouts passed, including crowded Ready at 720 × 560 and 580 × 480, Live at three widths, and two recap states                                  |
| Real Electron `--smoke` | Native panel and Ready acceptance passed with synthetic providers and native mouse input                                                                      |

Linux checks used Node 24.19, Chromium 151 and Electron 44.2.0 on a 1280 × 1400 virtual display. No live transcription or paid model requests were made. Offline replay timing measures stub execution, not OpenAI latency.

## What was verified

**A — Stable live panel.** The card remains the same node under partial transcript updates at 8 Hz. All 40 native Pin presses lasting 90 ms registered. Input selection survived 500 ms, the transcript retained its scroll position, and opacity remained 1 during streaming. The quiet panel opens at 232 px. A full card, three points, a bigger-picture line and two sources fit at widths 340, 440 and 640. Twenty updates with a notice caused one height increase; dismissal and transcript closure returned to the preceding height within 2 px, keeping the top edge fixed. A five-second notice disappeared without other activity. A 1.5-second silent automatic check left card-region HTML unchanged. Command errors appeared once, without Electron's wrapper. Saved panel bounds exclude height.

**B — Questions and timing.** Appendix A is a table-driven classification fixture; Appendix B contains all 45 segments. Short questions, fillers, requests inside a sentence, split turns and wrap-up questions are covered. Questions bypass the automatic token bucket, while the session cap remains. Long logistics cannot schedule background help. Background checks wait 1.2 seconds after the turn, require eight words and are spaced by 20 seconds. Leads accept 24 words and points accept 16, with boundary-aware truncation.

**C — Starting and preparation.** Failed starts emit `connecting: false`; a hung initial Realtime connection times out after ten seconds and can be cancelled. Capture failures reach the live panel with a privacy-settings action. Fifteen seconds of silent call audio with microphone signal produces a warning that clears when audio returns. Network self-tests use a plain connection message. Crowded Ready keeps consent and Start visible. Draft setup survives Practice and Another call. Preparation can finish after Start, updates transcription hints once, and cannot replace notes or show stale failures beyond the two-minute adoption window.

**D — Recap and sample.** The model chooses promises, and every evidence ID must reference a final, non-gap transcript segment. Model owner, action and deadline are displayed with expandable source words. The Appendix B stub recap contains the two concrete promises; the optional conditional introduction is left open. Prep and recap both accept a simulated 25-second result and support retry after fallback. Local prep invents no coverage points; fallback recap has no invented email. The sample streams structured cards with sources, coverage and a bigger-picture line, then produces two promises and an email.

**E — Polish.** Native screenshots show the revised spacing, wrapping, source chips, four-bar meters, labelled End and visible Help shortcut. Shortcut recording uses physical key codes, including Option-modified letters and arrows. Help, pause/resume and show/hide remain registered while paused. Slow coaching uses a four-minute/six-substantial-turn cadence and lower reasoning effort. Tests cover echo cleanup, transcript deltas, safe diagnostics and signing-secret inputs. Signing was exercised with a fake `gh` executable; no real repository secrets were written.

## Screenshots

Generated images are ignored by Git, as before. After running the checks, open [the screenshot review](../artifacts/round2/review.html). It includes real Electron screenshots from the original commit and the implementation, plus quiet, arriving, checking, notice, transcript, startup recovery, Practice restoration and recap evidence. The Appendix B recap uses the shipped renderer with a stub model.

To reproduce the native checks on Linux with Electron installed:

```sh
CALLWISE_SMOKE_DIR=artifacts/round2/after xvfb-run -a npm start -- --smoke --no-sandbox
```

## Five-minute checks on a Mac

Each check below requires the actual device or account. They remain unverified in this Linux environment.

1. **Focus and full screen:** start a consented call, make Zoom/Meet/FaceTime full screen, show the panel and type in the meeting. Confirm typing stays there, the panel remains available, and notices grow then shrink without moving its top edge.
2. **Hotkeys:** try Control–Option–Space, P, [, ], and H while running. Pause with P, resume with P, then pause and use Help to resume/request help. Check H while paused. If macOS reserves Space for switching keyboard layouts, record another physical shortcut in Settings and retry.
3. **Capture and muted output:** run microphone and call-audio checks in setup, then start a call with both people talking. Check both meters. Mute meeting output for at least 15 seconds while the microphone has signal; check the warning and sound-check action. Unmute and confirm recovery.
4. **Headphones:** while a call is active, unplug headphones, reconnect them and switch output once. Confirm call audio recovers without duplicate or stuck transcript rows and that any failure offers a working action.
5. **Response timing:** enable Settings → Advanced → Show response timing overlay. Ask three short and three substantive questions and record end-of-turn to first readable words. For the billed benchmark, use a private key with `npm run replay -- --live --compare` and compare answer quality as well as timing. The automatic deep lane uses lower effort; real latency is still unmeasured.
6. **Long recap:** after a consented 30-minute call, end it and time the recap. It has 60 seconds. If it falls back, use Try again; verify promise sources and the email against the actual conversation. Preparing the 30-minute call is outside this five-minute review.
7. **Upgrade permissions:** on the Mac, configure the persistent signing identity and build two versions with that same certificate. Install the first, grant capture permissions, then install the second and repeat both sound checks. Check that permissions survive. No signed release was published during this implementation.
