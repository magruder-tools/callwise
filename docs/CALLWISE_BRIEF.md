# Callwise: make it just work

A brief for Codex. Written 8 October 2026 against `main` at `6c13d2d` (v0.3.0).
Put this file at `docs/CALLWISE_BRIEF.md` and the companion `callwise-ui-reference.html` at `docs/callwise-ui-reference.html`.
To start: ask Codex to read this file, do Milestone 1 only, and stop at Checkpoint 1.

---

## Read this first

You are improving Callwise, Matt's personal live-call copilot for macOS (Electron 44, vanilla JS modules, OpenAI).

The engine underneath is in good shape and worth keeping: the session state machine, cancellation, the consent gate, encrypted storage, two-channel capture, and 118 passing tests. What needs work is everything the user touches: when help appears, what it says, how much attention it costs during a call, and how hard it is to get started.

The work is six milestones. Do them in order, one per branch and pull request.

| # | Milestone | What Matt gets |
|---|---|---|
| 1 | Fix what's broken | The confirmed bugs are gone, a dropped connection no longer pauses the call, and failures leave a trail you can debug from |
| 2 | Speak at the right moment | Answers start within about two seconds of the other person's question, and nothing appears when there is nothing to add |
| 3 | One calm window | A single home screen, a glanceable live panel, no dialogs during a call |
| 4 | Setup that tests itself | Three first-run steps with live checks, permissions that survive updates, one README |
| 5 | Before and after the call | A prep sheet from his materials, an automatic recap and follow-up, context carried to the next call |
| 6 | Long calls and rough edges | Calls past an hour, device switches, speakers instead of headphones, better transcription of names |

### How to work

1. **Stop at every checkpoint.** At the end of each milestone, post: what changed, what you verified and how, what you could not verify, and a five-minute test script Matt can run on his Mac. Then wait.
2. **`docs/callwise-ui-reference.html` is the visual target.** Open it in a browser. Match its layout, spacing, type sizes and wording. Where this brief and the reference disagree, the reference wins on looks and this brief wins on behavior.
3. **Keep `npm test` and `npm run check` green.** Some tests encode behavior this brief changes on purpose. Each milestone lists them. Rewrite those tests to the new behavior and say so in the pull request.
4. **Say what you ran.** CI cannot hear audio or see macOS prompts. Anything touching capture, permissions, windows or hotkeys needs the manual script. The repo's existing validation notes are careful about this; keep that habit.
5. **Prefer deleting to adding.** The app has too many surfaces. Each milestone should end with fewer controls, dialogs and documents than it started with.
6. **No new runtime dependency without a sentence in the pull request saying why.** Text extraction for PDF and Word files is already approved (Milestone 3).
7. **Check API details against current documentation before relying on them.** Model names, Responses streaming, Realtime transcription options and Electron window APIs are cited in Appendix E as they stood on 8 October 2026. Items marked **[verify]** were read in documentation and not exercised.

---

## What Callwise is for

During a live call on Matt's Mac, Callwise listens to both sides. When the other person asks him something, or when his own notes can help, it shows one short thing to say or ask. Before the call it turns whatever he drops in (a résumé, a job post, a proposal, last call's notes) into a prep sheet. After the call it writes the recap and the follow-up.

He uses it for job interviews, sales and discovery calls, client meetings and negotiations. He runs calls conversationally, without a rigid agenda. So the most valuable help is quiet structure in the background: the question he was just asked, the number he half-remembers, the commitment someone just made, the point he meant to raise and hasn't.

Callwise is for calls where transcription and AI assistance are permitted. The per-call confirmation stays.

## The bar

Use these as the acceptance test for every decision.

- **A first call takes one screen.** Open the app, confirm consent, press Start. Everything else has a sensible default.
- **Answers are on time.** First words appear within 2 seconds of the other person finishing a question (median), 4 seconds at the 90th percentile, on a normal connection.
- **One glance is enough.** The live panel shows one line to say and at most three short supports.
- **Zero clicks during a call.** Everything updates by itself. Hotkeys are optional.
- **Silence is the default.** Callwise says nothing when it has nothing useful to add. Help that arrives too late is noise and gets dropped.
- **It keeps going.** A network hiccup, a device switch or a long call never stops the session unless recovery has already been tried.
- **Failures are specific.** Any error says what happened and the one thing to do.
- **The recap is waiting.** When the call ends, the summary and follow-up are already there.

## Keep these

Do not weaken any of the following. They are right as they are.

- No capture before an explicit Start. Consent is confirmed for each new live call and is never saved.
- No raw audio is written to disk. No video frame is read or sent.
- A key saved in the app is encrypted at rest and stays in the main process. It is never sent back to the renderer, logged or exported. (A plaintext `.env.local` is still read today; 3.6 retires it as a user path.)
- Transcript text and imported material are untrusted data in every prompt.
- A card may cite only source IDs it was given. A card presented as a fact needs a source.
- Pause, End and New invalidate in-flight work; a late result never produces a card.
- The Codex context bridge keeps its read-only, default-deny policy and its evidence verification.
- The browser demo never loads credentials or contacts a provider.

## Leave these alone

`providers/codex.mjs`, `providers/codex-context.mjs`, `providers/mcp.mjs`, `providers/fireflies.mjs` and their tests. They move behind Settings › Advanced (Milestone 3) and are used for pre-call research (Milestone 5). Do not refactor or extend them otherwise.

---

## Why it doesn't feel right yet

Five findings shape the plan. The first four were measured by running the offline demo and the real controller; details are in Appendix A.

1. **Help arrives late.** A suggestion is scheduled 2.5 seconds after *any* finished sentence from *either* speaker, then held by an 18-second cooldown (`core/engine.mjs:13-16`, `:210-233`). The user's own speech starts the timer. In the app's own scripted demo the client asks four questions, and the request for help does not even start until 2.5, 7.5, 12.5 and 15 seconds after each one. The fast lane fires at 3, 21, 39 and 57 seconds: an 18-second metronome that ignores when questions are asked. A real model's response time comes on top. The cooldown was lengthened from 7 to 18 seconds in version 0.2, and the confidence threshold raised from 0.58 to 0.7, to make the app quieter (`docs/CALL_MODE.md`, commit `c997496`). That reduces noise by reducing help. Relevance should do that job.
2. **The advice is hidden.** The card shows a suggested line and a reason. The actual advice (`body`) sits inside a "Details" disclosure (`ui/app.mjs:114-115`). At the default window size the opened content starts below the visible part of the card, so clicking Details appears to do nothing. When the suggestion runs to three lines, or at the minimum window size, the Details control itself is out of view.
3. **Staying current takes clicks.** A new card never replaces the one on screen; it waits behind a "1 new" button (`ui/suggestion-focus.mjs:14`). That includes the answer to a question the user just typed. Deeper insights open in a modal dialog that covers the card. So does the transcript. There are nine dialogs.
4. **Setup shows the plumbing.** The Connections dialog is 1,913 px tall inside a 480 px window, with three separate save buttons, three model-name text fields, four providers, and controls for a Codex feature most calls don't need. The consent checkbox lives in a different dialog; pressing Start without it bounces the user there on every call. The default "conversation source" is the demo. There are five onboarding documents, and they give different instructions for where the key goes.
5. **One hiccup stops the call.** Any close or error on a transcription socket pauses the whole session (`providers/transcription.mjs:61-62`, `:92-94`; `core/controller.mjs:403-415`). Nothing reconnects. OpenAI documents a 60-minute maximum for Realtime sessions, and the app's own limit is two hours.

---

## Milestone 1: Fix what's broken

Small, safe changes that survive the later redesign.

### 1.1 Demo values overwrite saved defaults

**What happens.** Run the demo, press End, open Call setup, change any field (for example Conversation source), press New session. The goal now reads "Help the client make a defensible budget decision and agree on a focused first engagement.", the call type is Strategy and the Context scope is "Northstar". In the desktop app these are written to `preferences.bin` and become the defaults for real calls. Pausing and resuming the demo is enough to cause it.

**Why.** `configure()` in `ui/app.mjs:384-396` posts the entire form whenever one field changes. After a demo start the form holds the demo's settings, because `CallController.start()` writes them to the engine (`core/controller.mjs:428-437`). `configureContext()` then saves whatever it receives (`core/controller.mjs:152`). Three paths post the form: a change to any Call setup field, Save preferences (`ui/app.mjs:474-476`), and Start or Resume, which calls `configure()` first (`ui/app.mjs:413`).

**Fix.**
- The renderer sends only the field that changed.
- The controller refuses to persist `mode`, `goal` or `project` once a demo has been started in the current session, until New session. (Checking `mode === "demo"` alone is not enough: that is also the idle default.)
- On load, repair preferences already damaged: if the saved goal equals the demo goal and the saved project is "Northstar", reset `mode`, `goal` and `project` to defaults. Compare against the constant at `core/controller.mjs:434`, not a retyped string. Matt's Mac may be in this state now.
- Fix it in the controller, so all three paths are covered.
- Test: after a demo start and end, a `configure` call carrying the demo's values plus `preferredSource: "audio"` leaves the saved goal, mode and project untouched.

### 1.2 New cards and typed answers wait behind a button

**Fix.** In `ui/suggestion-focus.mjs`, the newest card in a lane becomes the current card as soon as it arrives, unless the current card is kept (kept means pinned until Milestone 3 renames it). A card produced by a typed question or the hotkey always becomes current. Earlier cards stay in history.

The engine tags each card with `origin` (`auto`, `asked` or `hotkey`) and, for asked cards, the question text, so the renderer can show what a card is answering.

Rewrite `tests/suggestion-focus.test.mjs` ("reading survives expiry, new arrivals, and ordinary snapshots") to the new rule.

### 1.3 Errors never leave, and show twice

**What happens.** After any engine error, the red box returns on every state update for the rest of the session, including after a successful resume (`ui/app.mjs:350-353`; `engine.errors` is cleared only by `reset()`). Errors raised through `showError()` (`ui/app.mjs:57-61`) appear in the box and in a toast that sits on top of it with the same words.

**Fix.** Give each error an id and a lifetime. Show it once, in one place. It clears when the user dismisses it or when the condition ends (for example, a successful resume clears a connection error). Test: error, resume, error not visible.

### 1.4 A dropped transcription socket pauses the call

Pausing is deliberate. `docs/ARCHITECTURE.md:78-79` says failures pause or visibly report a gap and never silently fabricate continuity. Keep that intent and drop the pause.

**Fix.** `LiveTranscriber` recovers by itself.
- On close, a transport error, or a stalled segment: reconnect with backoff from 0.5 s up to 8 s, for up to 60 s.
- Keep the last 15 seconds of PCM per channel in memory while disconnected and send it after reconnecting, so words spoken during the gap are transcribed.
- If more audio was lost than the buffer holds, insert a visible marker in the transcript ("about 20 seconds missed") and tell the model about the gap. Never present a transcript with a hole as continuous.
- Report a `reconnecting` state. The UI shows a small indicator. The session stays running and the other channel is unaffected.
- Treat a Realtime `error` event as fatal only if the socket then closes or the code is an authentication or quota error. Log the rest.
- Only when the retry window is exhausted, or on 401, 403 or an out-of-credit 429, stop that channel and raise one specific error.

Test with a fake WebSocket: a close mid-utterance leads to a reconnect, the buffered audio is replayed, segments are emitted, and the controller status stays `running`. A second test: a gap longer than the buffer produces the marker.

No existing test asserts the pause. Update the sentence in `docs/ARCHITECTURE.md` under "Current constraints" that describes it.

The Fireflies source has the same shape: socket.io is set to reconnect (`providers/fireflies.mjs:87-88`), but the controller pauses on the first disconnect (`core/controller.mjs:375-387`), so it never gets the chance. Note it; fix it only if it is a one-line change.

### 1.5 Global shortcuts take over other apps

`desktop/main.mjs:306-314` registers ⌘⇧Space and ⌘⇧P system-wide when the app launches and keeps them until it quits, even with no call running. The return value of `globalShortcut.register` is ignored. ⌘⇧P is the command palette in VS Code and Chrome DevTools. ⌘⇧Space is 1Password's default Quick Access shortcut.

**Fix.** Register shortcuts only while a session is running. Unregister on pause and end. Check the result and tell the user when a shortcut could not be registered. New defaults, configurable in Milestone 3: ⌃⌥Space (help me now), ⌃⌥P (pause or resume), ⌃⌥[ and ⌃⌥] (previous and next card), ⌃⌥H (show or hide the panel). **[verify]** that these register on Matt's Mac.

### 1.6 Importing a past Fireflies transcript fails before a call

`importFireflies()` in `core/controller.mjs:535` rejects when `this.mode === "demo"`, and the mode is "demo" until a live session starts. So pre-call import always answers "External context import is disabled in Demo mode." The two sibling functions use `mode === "demo" && status !== "idle"` (`:179`, `:504`). Use the same guard and add a test.

### 1.7 Opening settings runs Codex discovery

In the desktop app, when no call is running, `ui/app.mjs:468-473` clicks "Find my apps" automatically whenever Connections opens without an app list. For anyone not signed in to Codex this spawns the helper and shows a red error about a feature they did not ask for. Remove the automatic click. Discovery runs only when the user presses the button.

### 1.8 Smaller fixes

- **File import** (`desktop/main.mjs:249-277`): one oversized file throws after earlier files were already added, with no count. Handle each file independently and report, for example, "3 added, 1 skipped: too large".
- **Start-up time** (`core/controller.mjs:395-425`): the two transcription sockets connect one after the other. Connect them in parallel.
- **Clock** (`core/engine.mjs:119`, `:204`; `ui/app.mjs:575-581`): the call timer and transcript timestamps include paused time. Track active time.
- **Two-hour stop** (`core/engine.mjs:21`, `:122-128`): the session pauses itself mid-call with "Session time limit reached" and cannot be resumed. The two hours count from the first Start, pauses included. Warn at two hours of active time, stop at four.
- **The help hotkey can do nothing** (`core/controller.mjs:278-281`, `core/engine.mjs:379`): `nudge` passes no question, so a card the model rates under 0.7 is discarded without a word. Treat the hotkey as an explicit ask.
- **Stale "Connecting…"** (`core/controller.mjs:440`, `:446-450`): `start()` returns a snapshot taken before `connecting` is cleared, and the renderer draws that snapshot last. Clear first, then snapshot.
- **Ask routing** (`core/controller.mjs:263-277`): a typed question can be routed to the strategy lane, whose cards live in a separate dialog, so the answer appears somewhere the user is not looking. Until Milestone 3 removes that dialog, always show the answer to a typed question in the main card.

### 1.9 Leave a trail

Today a failure leaves one vague sentence and nothing else. Codex cannot see Matt's Mac, so every bug report starts from zero.

- Write a rotating log in the app data folder (`logs/callwise.log`, five files of 1 MB): timestamps, state changes, capture status, reconnect attempts, latency marks, provider HTTP status with the provider's `error.code` and `error.type`, and app, OS and Electron versions.
- Never log keys, transcript text, imported material, prompts or response text.
- The existing test "provider errors never echo arbitrary upstream bodies" (`tests/providers.test.mjs:49`) checks two things: nothing from the upstream body leaks, and the message contains "401". Keep the first. Move the status to structured fields on the error (`status`, `code`) and have the test check those, so messages can be written for people.
- Add "Copy diagnostics" to the menu. It copies the last 200 log lines and a settings summary without secrets.
- Make provider errors specific. Map status and code to one sentence and one action (Appendix B has the list).

### Checkpoint 1

Automated: new tests for 1.1 to 1.6 pass; all others pass.

Matt's five-minute script:
1. Run the sample call, end it, change a setup field, start a new call. The goal field still shows his own text.
2. During the sample call, type a question. The answer replaces the card without a click.
3. Start a real practice call, turn Wi-Fi off for ten seconds, turn it on. The call keeps running and shows a brief "reconnecting".
4. With Callwise open and no call running, press ⌘⇧P in another app. It works there.
5. Choose Copy diagnostics and paste it somewhere. It contains no key and no transcript.

---

## Milestone 2: Speak at the right moment

This is the milestone that decides whether Callwise is useful.

### 2.1 Measure first

- Record, per card: `turnEndedAt`, `requestedAt`, `firstTokenAt`, `firstPaintAt`, `doneAt`. Keep them in metrics, write them to the log, and show the last and median "turn end to first words" in a debug overlay (off by default).
- Add `scripts/replay.mjs`. It feeds a timestamped transcript fixture into a real `CoachEngine`. By default it uses a stub provider that returns one fixed card for every request after a set delay, so the run measures the trigger rules and the plumbing. With an explicit flag and a key it uses the real provider. It prints, for each turn that should get help, the delay to first words, whether a card appeared, and its lead.
- Ship three fixtures in `fixtures/replay/`: an interview, a discovery call and a client check-in. Each turn is labelled with what should happen: `say`, `ask`, `fact`, `heads_up` or `silent`. Mark which `silent` turns the trigger rules alone must skip (backchannels, the user's own speech, repeats) and which need the model to decline. Include partial-transcript events so speculative start can be tested.
- Add a unit test with fake timers and an instant provider: in the existing demo fixture, every client question gets a card within one second of the turn ending.

### 2.2 Trigger on the other person's turn

Remove the blanket delay and cooldown scheduling in `CoachEngine.ingest()` and `schedule()`. Put the rules in a new pure module, `core/triggers.mjs`, with unit tests.

**When to ask the model**
- The other person's turn has ended (a final segment on a channel that is not the user's), it has at least four words, and it is not a backchannel ("yeah", "right", "okay", "got it", "mm-hm"). Only the audio source has a channel per side (`mic`, `system`). Pasted text and the demo are all `other`, and Fireflies rows are all `meeting` with participant names, so use the speaker label there; for Fireflies that means asking which name is his.
- Classify with patterns first; no model call is needed for this step:
  - *Question or request.* Ends with a question mark, or opens with who, what, when, where, why, how, can, could, would, do, does, did, is, are, have, "tell me", "walk me through", "talk about", "describe", "give me". Always ask the model.
  - *Objection or concern.* "too expensive", "not sure", "concerned", "already have", "last agency", "we tried".
  - *Number, date or money.*
  - *Commitment.* "I'll send", "we'll", "by Friday", "let's".
  - *Decision.* "so we agreed", "let's go with".
  - Whether the non-question classes trigger depends on the call type's playbook (Appendix C).
- Anything else: no call. One low-priority background check may run at most once per 45 seconds of new conversation, instructed to stay silent unless something is clearly valuable.

**What never triggers proactive help.** The user's own speech. It updates state (what has been covered, what was promised) and nothing more.

**Limits.**
- One request per turn of theirs. Do not answer again a question whose normalized text matches one answered in the last three minutes.
- A token bucket of 8 proactive requests per rolling minute with a burst of 3, on top of the existing per-session caps.

**Start early.** When the partial text of their current turn already looks like a complete question (pattern match, at least six words, 250 ms with no new text), start the request. When the final text arrives, keep the request if the text is the same after normalization or within 15% edit distance. Otherwise abort and restart.

**Asked always wins.** A typed question or the help hotkey skips all gating, cancels proactive work in flight, and always produces something visible: an answer, or a card saying what is missing.

### 2.3 Stream the answer

- Add streaming to `providers/openai.mjs` (Responses API with `stream: true`). The engine emits card updates as text arrives and the renderer paints the lead while it is still being written.
- The first tokens must be the words the user reads. Schema v2 (Appendix C) orders the fields `speak`, `kind`, `lead`, `points`, then the rest. Read the stream with a small tolerant partial-JSON reader for those string fields, or use a line format if that proves more reliable. Your choice; the acceptance test is time to first paint.
- If `speak` is false, cancel the stream and show nothing.
- Fast lane settings: the lowest reasoning effort the model supports (`none` where available, otherwise `low`), low verbosity where supported, about 350 output tokens, six seconds to first token or drop, one retry on a network or 5xx failure if time allows. **[verify]**
- Compare `gpt-6-luna` with the current default `gpt-5.6-luna` for the fast lane using the replay script. OpenAI's model guide calls `gpt-6-luna` the fastest and most cost-effective GPT-6 model. Choose on measured first-token time and answer quality. **[verify]**
- Late help is dropped. If first paint would come more than six seconds after their turn ended and the user has already been talking for three seconds, do not show it as the main card. File it in history, marked late. This applies to proactive cards only. (On speakers, the microphone also hears the other person, which can look like the user talking. Milestone 6 handles that; until then, headphones.)

### 2.4 Cards shaped for the job

Replace the single card shape (`title`, `body`, `say`, `kind`, `confidence`, `sourceIds`, `reason`) with schema v2 in Appendix C.

- Kinds: `say` (an answer to their question), `ask` (his next question), `fact` (from his material), `heads_up` (a contradiction, a risk, an unanswered question, a commitment), `bigger_picture` (the slow lane).
- `lead` is at most 16 words and is written as words he can say aloud, in the first person.
- `points`: zero to three, each a one or two word label plus at most 12 words.
- `trigger` is set by the engine, never by the model: the verbatim words being responded to and who said them.
- Remove the self-rated confidence gate (`core/engine.mjs:379` silently discards proactive cards rated under 0.7). Gating is now: trigger rules, `speak`, citations for facts, duplicate checks, lateness.
- Keep citation checks, the fact-needs-source rule, duplicate suppression and the dismissed list.

In this milestone, adapt the existing card just enough to show the new shape: trigger line, lead, points, all visible without a disclosure. The full redesign is Milestone 3.

### 2.5 Give the model everything, in a cacheable order

Rebuild `makePrompt()` in `core/prompts.mjs:51` as a stable prefix followed by a volatile tail.

1. Instructions and the playbook for this call type
2. About the user (the saved profile)
3. This call: who it is with and what he wants
4. Materials: the full text of every document while the total stays within a budget. Start with about 20,000 tokens for the fast lane and 60,000 for the slow lane, and tune both against first-token time in the replay. Over budget, use retrieved excerpts, plus the prep digest once Milestone 5 exists.
5. The call so far: summary and commitments (Milestone 6 adds the rolling summary; until then, keep the current early-highlights logic)
6. Recent turns, verbatim, with speaker and time
7. The trigger, or the typed question
8. Leads of recent cards, so it does not repeat itself

Items 1 to 4 do not change during a call, so OpenAI's automatic prompt caching can reuse them. Keep reasoning effort constant per lane; OpenAI's guide notes that changing it breaks the cached prefix. **[verify]**

Related changes:
- `ContextStore.search()` remains only as the fallback for oversized material.
- Remove the goal text from the search query (`core/engine.mjs:281`). It biases every search toward documents that share words with the goal.
- "Context scope" stops being something the user sees or types (Milestone 3 removes the field). Internally, material belongs to a call sheet.

### 2.6 The slow lane gets quieter

The strategy lane keeps its depth. It runs when asked, or at a topic shift or decision point found by the trigger rules, and at most once every two minutes. It never replaces the main card. It appears as one line under it.

### Tests this milestone changes on purpose

No existing test asserts the delay or the cooldown directly. What will move:
- The helpers at `tests/engine.test.mjs:29` and `tests/hardening.test.mjs:8` pass `fastDelay: 100000` as the way to keep automatic requests off. They need a new off switch.
- "quiet mode does not schedule automatic calls" asserts on `e.timers` (`tests/engine.test.mjs:155`).
- "dismissal prevents repetition, and low-confidence proactive cards are withheld" loses its confidence half.
- `tests/providers.test.mjs:45` asserts `max_output_tokens` of 1800 and a non-streamed response body.
- `tests/hardening.test.mjs`, "typed question preempts an automatic request instead of being dropped", stays true. Keep it.

### Checkpoint 2

Automated:
- Replay with the stub provider on all three fixtures: a request is made for every turn labelled `say`, `ask`, `fact` or `heads_up`, and for no turn the rules must skip; median turn end to first paint under 300 ms.
- No request is triggered by a segment on the user's channel.
- A typed question always produces a visible card that replaces the current one.

Matt runs the replay with his key and reports the numbers: timing, and how many labelled turns got the right kind of card or the right silence. Target: median 2.0 s or less, 90th percentile 4.0 s or less. If the numbers miss, the checkpoint note says where the time goes (transcription, first token, or paint).

---

## Milestone 3: One calm window

Four screens replace nine dialogs: **Ready** (home), **Live** (a floating panel), **Recap**, **Settings**. The reference file shows each one, plus every live state.

### 3.1 Design system

- One token file from the reference (`ui/tokens.css`): colors, a four-step type scale (12, 13, 15 and 22 px), a 4 px spacing grid, radii, one motion duration.
- Delete `ui/styles.css`, `ui/focus.css` and `ui/context.css`. The second overrides the first's variables, and several selectors match nothing (`.call-toolbar`, `.view-buttons`, `.prepare-summary`, `.ask-footer`, `.card-reason`).
- No text under 12 px. Today some is 9 px.
- Inline SVG icons from the reference. No Unicode glyphs standing in for icons (today: •••, Ⅱ, ■, ▶, ＋, ↗, ×, ↑, ✓, ✦, ⌘, ≈, ▤).
- Sentence case everywhere. No all-caps labels above headings. No arrows appended to button text.
- Mint means live or primary. Amber means heads-up or waiting. Coral means end or error. Nothing else is colored.
- System font. Dark only for now.

### 3.2 Renderer structure

`ui/app.mjs` is 588 lines with one `render()` that handles every part of the screen, and it reads form fields back to decide what to send, which is the root of 1.1. Split it:

- `ui/state.mjs`: holds the latest snapshot, lets views subscribe.
- `ui/views/ready.mjs`, `live.mjs`, `recap.mjs`, `settings.mjs`, `welcome.mjs` (Milestone 4).
- `ui/components/`: card, meters, chips, segmented control, banner.

Keep vanilla JavaScript and ES modules. No framework is needed. Views render from state. Edits are sent as single-field patches.

### 3.3 Ready

- **What kind of call is it?** Interview, Sales, Client, Negotiation, Something else. Sets `mode`. `client` replaces today's `strategy` and `general` becomes Something else; migrate saved values.
- **Who is it with, and what do you want out of it?** One line of free text. Sets `goal`. Placeholder examples change with the call type.
- **Give it something to work from.** Drag and drop, paste, or a file picker. Accept PDF, Word (.docx), Markdown, text, CSV, VTT, SRT and JSON. Extract text in the main process (`pdfjs-dist` for PDF, `mammoth` for Word). Limits: 10 MB per file, 2 MB of extracted text per call. One chip per item, removable. If a file has no extractable text (a scanned PDF), say so and offer "Paste the text instead". "Add a link" is optional for this milestone; if included: https only, 10-second timeout, 2 MB cap, HTML to text in the main process.
- **Consent, then Start.** The checkbox sits directly above the button. It is unchecked for every new call. Start is disabled until it is checked, and the reason is visible. ⌘↩ starts.
- **Readiness lights** in the title bar: AI, Mic, Call audio. A light that is not green explains itself when clicked and offers the fix. In this milestone: AI means a key is saved; Mic and Call audio come from `desktop.permissions` (the IPC handler exists at `desktop/main.mjs:236`; nothing calls it today). Milestone 4 makes them real tests.
- **Recent.** The last five calls. Choosing one restores its type, line and materials. Milestone 5 adds history.
- **Practice with a sample call** runs the existing demo. The demo is no longer the default.
- The input is always microphone plus call audio. "Paste conversation text" and "Fireflies live transcript" move to Settings › Advanced.

### 3.4 Live

**The window.** On Start the main window hides and the panel opens. On End the panel closes and the main window returns showing the recap.
- Create it with `type: 'panel'`. Electron documents that a panel floats above full-screen apps, appears on all Spaces, and does not activate the app. If full-screen Zoom, Meet or FaceTime still hides it, add `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`. **[verify on the Mac]** Today it is an ordinary window unless "Float above other apps" is switched on, and then it is always-on-top at the floating level and nothing more (`desktop/main.mjs:115-117`, `:227`). Nothing asks macOS to show it over a full-screen app.
- 440 × 320 by default, resizable from 340 to 640 wide. Remember size and position per display.
- It must not take keyboard focus from the meeting unless the user clicks into "Ask anything".

**Top to bottom.**
1. Status bar: state (Listening, Reconnecting, Waiting, Paused), call time, level meters for You and Them, Pause, End.
2. The card.
3. Caption: the other person's latest words, updating live from partial transcripts. This is how he knows it is hearing correctly.
4. Ask row: a text field and "Help me now".

**The card.**
- Trigger line ("They asked", "They said", "You asked") with the quoted words.
- Kind label: Say, Ask, From your notes, Heads-up.
- Lead at 22 px.
- Up to three points.
- Footer: sources, position ("3 of 7"), pin.

**Behavior.**
- The newest card shows immediately. A pinned card stays until unpinned.
- Previous and next with the chevrons or ⌃⌥[ and ⌃⌥].
- No expiry labels. When the conversation has moved on (five or more of their turns since the trigger), the card dims to 70%.
- *Nothing to add:* the quiet state from the reference.
- *Thinking:* the trigger line appears at once with a small progress mark where the lead will be, then the streamed text replaces it.
- *Bigger picture:* one muted line under the points. It expands in place.
- *Transcript:* clicking the caption extends the panel downward. No modal. Typing a transcript line by hand moves to Advanced.
- *Sources:* clicking a source expands its excerpt in place.
- *Feedback:* Keep and Dismiss become Pin and a small "Not useful". Not useful hides the card and feeds the duplicate filter, as Dismiss does today.

Everything that is a `<dialog>` today, other than Settings and confirmations, is removed: more, insights, setup, transcript, history, context, source, search.

**Accessibility.** The lead is an `aria-live="polite"` region. Every control is reachable with Tab and has a visible focus ring. Card changes use a 160 ms fade and 4 px rise, disabled under reduced motion.

### 3.5 Recap, for now

Milestone 5 writes the real recap. Until then, ending a call shows the Recap screen with the call's cards and transcript, plus Copy and Save as a file (the existing Markdown export). After a call ends the screen should never be a stale card and a "New session" button, which is what it is today.

### 3.6 Settings

A normal window with five sections.

- **General.** Hotkeys with a recorder and a clear message when a shortcut is taken. Whether the panel floats above other apps.
- **Audio.** Microphone picker, sound check (Milestone 4).
- **AI.** The key, the test results (Milestone 4).
- **Privacy.** What is stored, and "Delete everything".
- **Advanced**, collapsed by default. Model names with "Reset to recommended". Connected apps through ChatGPT (today's Codex block). Fireflies. Custom context server (today's MCP). Alternative transcript sources. Debug overlay. Diagnostics.

Changes apply as they are made. There are no Save buttons, except "Save and test" on the key. Today's dialog has three.

`.env.local` stops being a user-facing way to configure anything. Keep environment overrides for development only.

### 3.7 Words

Appendix B has every string. Retire these terms from the interface: Context scope, strategy engine, Astra via API, Astra via Codex, MCP, lookup, Connections, session, conversation source, Deeper insights.

### Tests this milestone changes on purpose

`tests/ui.test.mjs` and `tests/connections-ui.test.mjs` are rewritten for the new structure. `tests/demo-server.test.mjs` and the allow-list in `scripts/demo-server.mjs:80-92` update their lists of served files.

### Checkpoint 3

Automated:
- No `<dialog>` can be opened while a session is running.
- Playwright screenshots of the panel at 340 × 240, 440 × 320 and 640 × 480 and the main window at 720 × 560. No clipped or overlapping text. A 16-word lead and three 12-word points are fully visible at 440 × 320 without scrolling.
- The pull request shows each screen beside its reference.

Matt's script:
1. Open the app. Start a sample call in two actions.
2. Put a video call in full screen. The panel is still visible.
3. Type in the meeting's chat, glance at the panel, keep typing. Focus never left the meeting.
4. Use each hotkey while the meeting app is in front.

---

## Milestone 4: Setup that tests itself

### 4.1 First run

Shown when no key is saved or a permission is missing, and reachable later from Settings. The reference shows the screen.

**Step 1: Connect OpenAI.** Paste the key. Saving it runs four checks, each with its own result line and its own fix:
1. The key is accepted.
2. A real one-line completion on the fast model. Show the time it took.
3. A real small request on the deeper model.
4. The transcription model accepts a session (open the Realtime socket and wait for `session.updated`).

Say in the interface that this sends a few tiny real requests. This replaces "Check model access" (`core/connections.mjs:52`), which reads model metadata only and, as its own help text says, proves nothing about inference or billing.

**Step 2: Let Callwise hear the call.**
- *Your voice.* Request microphone access with `systemPreferences.askForMediaAccess('microphone')`. Offer a device picker and remember the choice (today the default device is used with no choice, `ui/capture.mjs:18`). Show a live meter. "Say a few words" transcribes his own speech and shows the text, which proves microphone to transcript end to end.
- *Call audio.* Starting capture for the sound check triggers the system audio permission. Then "Play test sound" speaks a short phrase through the default output using `/usr/bin/say` (argument array, no shell) and confirms the loopback meter moves and the phrase is transcribed. If nothing is heard, say which of these it is: permission not granted (with a button that opens the exact Privacy & Security pane; **[verify]** the pane identifiers on macOS 14 and 15), or a development launch (see 4.4).
- The permission handlers in `desktop/main.mjs:134-157` allow media only while a live session is running. Extend them to allow capture during a sound check the user started. Nothing from a sound check leaves the Mac except the two short transcription tests above.

**Step 3: Tell it about you.** Drop a résumé or type a paragraph. It becomes the saved profile. This replaces the "What should your copilot know about you?" box at the bottom of Connections.

**Readiness lights** on Ready now mean: AI (the last self-test passed for the current key), Mic (permission granted and the chosen device is present), Call audio (permission granted and the last sound check passed).

### 4.2 Avoid Screen Recording permission if possible

Capture currently requests a screen video source plus loopback audio (`desktop/display-capture.mjs:13`, `ui/capture.mjs:31`). That needs Screen Recording permission and turns on macOS's recording indicator, although no video is used. Electron 39 and later capture system audio through Core Audio taps, which need only the audio-capture permission and the `NSAudioCaptureUsageDescription` key already in `package.json`.

Investigate, in this order, for no more than a day:
1. Whether the display-media handler can grant loopback audio with no real screen source.
2. A small native helper that uses a Core Audio process tap and writes PCM to stdout.

If neither is clean, keep the current path and make Step 2 explain why macOS says "screen recording" for an audio-only feature.

### 4.3 A stable signature

`package.json:65` sets `"identity": "-"`, an ad-hoc signature that changes with every build. macOS ties permissions to the signature. The repo's own notes record the result. For 0.2.1, a stale screen-capture approval "tied to the previous ad-hoc code signature" had to be reset and re-added, and the microphone permission refreshed (`docs/AUDIO_CHECK.md:9`). For 0.2.2 the approvals were refreshed again because "its ad-hoc signature differs from 0.2.1" (`docs/PREFERENCES.md:9`).

Sign every build with one identity that does not change:
- Developer ID plus notarization if Matt gets an Apple Developer account (Decision 4), or
- a persistent self-signed certificate, stored as an Actions secret and used by `electron-builder`.

Also: build a DMG, and publish builds as GitHub Releases. Today they are Actions artifacts that expire after seven days.

Acceptance: install build N, grant permissions, install build N+1 over it. The permissions are still granted.

### 4.4 Real calls use the installed app

Electron's documentation says that when Electron is launched from a terminal or an IDE, the parent program must carry `NSAudioCaptureUsageDescription`, and that without it the audio stream is created but silent, with no error. `docs/CODEX_CONTEXT.md` currently tells Matt to run `npm start` to get the latest features.

Make the installed app the only supported way to take a call. In a source launch, show a banner: "Development run. Call audio may be silent. Install the app for real calls." The sound check in 4.1 catches a silent stream either way.

### 4.5 One README

Replace `START_HERE.md`, `RUN_CALLWISE.md`, `NEXT_SESSION.md`, `docs/INSTALL_MAC.md`, `docs/CALL_MODE.md`, `docs/AUDIO_CHECK.md`, `docs/FLOATING_FOCUS.md` and `docs/PREFERENCES.md` with:

- `README.md`: what it is, how to install, first run in five lines, a privacy summary.
- `docs/ARCHITECTURE.md` and `docs/PRIVACY.md`, updated.
- `CHANGELOG.md`, holding the per-version notes.

The current documents contradict each other and the code. `START_HERE.md` puts the key in `.env.local`; `RUN_CALLWISE.md` and `docs/INSTALL_MAC.md` put it in Connections; `docs/PRIVACY.md:50` still says keys live in `.env.local`. `docs/CODEX_CONTEXT.md` says to install the Codex CLI with npm; `docs/INSTALL_MAC.md` says that is not needed. `docs/VALIDATION.md` reports 31 tests; there are 118. `docs/ARCHITECTURE.md:64` says the native picker is preferred; the code sets `useSystemPicker: false`. `START_HERE.md`, `NEXT_SESSION.md` and `docs/VALIDATION.md` call the repository private; it can be cloned without credentials today.

Three of the files being removed are referenced elsewhere. Update these: `package.json:72-75` bundles `docs/INSTALL_MAC.md` into the Mac build and `.github/workflows/mac-download.yml:10` triggers on it; an error message in `core/connections.mjs:36` says "See RUN_CALLWISE.md for recovery"; `scripts/doctor.mjs:32` says "See START_HERE.md".

### Checkpoint 4

Matt's script, on a fresh macOS user account:
1. Install from the DMG and open. No Terminal.
2. Finish the three steps. Each permission has a button that opens the right place.
3. Break things on purpose and confirm the self-test names each one: a wrong key, a revoked microphone permission, the output muted during the call-audio test.
4. Install the next build over this one. Permissions hold.

---

## Milestone 5: Before and after the call

### 5.1 Call sheets

A call sheet is the saved setup for a call: `{ id, name, type, line, materials[], history[] }`. Store it with the same encrypted mechanism as preferences. "Recent" on Ready lists call sheets. The interface never needs the word; it just shows names.

Default for what is saved: the setup and the extracted text of materials. A recap is saved only when "Bring this recap into the next call" is ticked. Transcripts are never saved unless exported. (Decision 3.)

### 5.2 Prep sheet

When the line or the materials change, the deeper model reads everything and returns a digest:

- `people`: who is on the call and what is known about them
- `facts`: each with a source id
- `likelyQuestions`: each with an answer outline built only from the materials
- `myPoints`: what he wants to land or cover
- `watchFor`: risks, sensitivities, traps
- `glossary`: names, companies and terms (Milestone 6 feeds these to transcription)

"View" on Ready opens it. It becomes part of the stable prompt prefix and is rebuilt only when inputs change.

By call type:
- *Interview:* likely questions with his best real example for each; three messages to land; questions to ask them.
- *Sales:* what is unknown about budget, authority, need and timing; objections to expect; proof points.
- *Client:* open items from the last recap; the numbers to have ready.

### 5.3 Quiet structure during the call

- **To cover.** `myPoints` becomes a list that ticks itself as each point comes up. The status bar shows "3 of 5 covered"; clicking expands the list. On a wrap-up cue ("anything else", "we're at time") a heads-up card lists what is left.
- **Who owes what.** On commitment cues from either side, record who promised what by when. This feeds the recap.

### 5.4 Recap

When the call ends, the deeper model writes the recap from the transcript, the cards and the commitments. No button. The reference shows the screen.

- What happened (three to five lines)
- Who owes what
- Still open
- A follow-up email in his voice
- *Interview variant:* each question asked, the gist of his answer, a stronger version, and a thank-you note.

Actions: Copy email, Copy recap, Save as a file (the existing Markdown export), and the checkbox to carry the recap into the next call.

### 5.5 Connected apps become pre-call research

The existing Codex bridge takes up to 45 seconds per lookup. That is too slow during a call and fine before one. On Ready, when connected apps are configured in Advanced, offer "Find related notes in my apps". It runs the existing lookup and adds the verified excerpts as materials. During a call, lookups run only when asked. The bridge's safety model does not change.

### Checkpoint 5

- End a ten-minute sample call. The recap is on screen within 20 seconds without a click.
- Reuse a call sheet. Its prep sheet shows the open items from the previous recap.
- Every fact in a prep sheet carries a source. Spot-check the three fixtures for invented facts and report what you found.

---

## Milestone 6: Long calls and rough edges

1. **Past an hour.** OpenAI documents a 60-minute maximum for Realtime sessions. Open a fresh transcription socket at 50 minutes, switch during the next silence of 1.5 seconds or more, then close the old one. **[verify]** that the limit applies to transcription sessions; Milestone 1's reconnect already covers a forced close.
2. **Device changes.** On `devicechange` or a track ending (`ui/capture.mjs:51` currently pauses the call), acquire the stream again from the saved or default device and continue. Ask the user only if that fails.
3. **Speakers instead of headphones.** When a microphone segment and a call-audio segment overlap in time and their text is at least 70% similar, keep the call-audio one and drop the microphone copy.
4. **Names and jargon.** The transcription session sets the audio format, turns server turn detection off, and passes only the model in its `transcription` object (`providers/transcription.mjs:56-59`). OpenAI's guide lists optional `keywords`, `languages`, `prompt` and `delay`. Send the call sheet's glossary as keywords and set the language. Tune `delay` with the replay script. **[verify]**
5. **Voice detection.** Replace the fixed loudness threshold of 0.007 (`providers/transcription.mjs:134`, `ui/capture.mjs:97`) with a noise floor measured in the first second and updated slowly. Replace the hard cut at 8 seconds of speech (`:148`) with "cut at the next 200 ms dip after 8 seconds, hard cut at 14".
6. **Long-call memory.** Every three minutes of new transcript, a cheap model updates a running summary. It replaces the keyword-based "historical highlights" (`core/prompts.mjs:76-84`) in the prompt.
7. **Cost.** Show an estimate in the recap footer from token counts and audio minutes, using a small editable price table. Label it an estimate.
8. **Updates.** Check GitHub Releases on launch and offer the new build.

---

## Not now

Windows. Local transcription. Telling apart several remote speakers. Starting from the calendar. A practice mode with a simulated interviewer. Reading the screen. Other AI providers. A content-protection mode (see Decision 1).

---

## Decisions for Matt

Each has a default so work is not blocked. Change any before handing off.

1. **Should the panel be hidden from screen sharing?** Default: no. Under Defaults, `docs/PRIVACY.md` says "No raw audio files, analytics, background microphone, stealth mode, or hidden screen-share features are implemented", and this brief stays consistent with that. The consequence: if he shares his whole screen, the panel is visible to everyone on the call. Sharing a single window avoids that.
2. **Codex strategy, Fireflies and the custom context server.** Default: keep them, move them to Settings › Advanced, invest nothing further. Alternative: remove them from the build.
3. **What is saved to disk.** Today the transcript, cards and materials are gone when the app closes, and one set of setup defaults is kept, encrypted. Default: each call's setup and material text are saved encrypted; recaps only when he ticks the box; transcripts never, unless exported.
4. **Signing.** Default: a free, persistent self-signed identity now. An Apple Developer account ($99 a year) adds notarization and removes the "unidentified developer" prompt.
5. **Fast model.** Default: whichever of `gpt-5.6-luna` and `gpt-6-luna` wins on the replay numbers in Milestone 2.
6. **Window during a call.** Default: the main window hides and the small panel takes over. Alternative: keep one resizable window.

---

## Appendix A: What was measured, and how

All runs were on Linux against commit `6c13d2d` using the offline demo server (`npm run demo`) in headless Chromium, and the real `CallController` and `CoachEngine` in Node 22. The Electron app, macOS audio capture, permissions, hotkeys and live OpenAI calls were **not** run. Pixel measurements will shift by a few pixels with macOS fonts.

| Finding | Method | Result |
|---|---|---|
| Suggestion timing in the scripted demo | Started the demo through the controller; logged when each line was ingested, when each model request started and when each card appeared | Client questions at 0.5, 13.5, 26.5 and 42.0 s. Fast requests started at 3.0, 21.0, 39.0 and 57.0 s. Cards appeared at 3.5, 39.5 and 57.5 s (the scripted model takes 0.45 s). The scripted reply to the 21.0 s request duplicated the first card and was dropped. One strategy request in the first minute, at 14.5 s. |
| Typed answers queue | `SuggestionFocus.sync()` with one card showing, then a second arriving; and typing a question in the running demo | The first card stays on screen. The button reads "1 new". |
| Demo values become defaults | In the demo UI: set a goal, run the demo, End, change Conversation source, New session | Goal, call type and Context scope show the demo's values |
| Errors persist | Fed the renderer a paused state with an error, then a running state | The error box is visible while running |
| Error shown twice | Pressed Start with a live source in the browser demo | The same sentence in the error box and in a toast on top of it |
| Details opens out of view | Opened the disclosure at 740 × 480 and 600 × 420 and measured positions inside the card's scroll area | Default size: 204 px visible, opened content starts at 207 px. With a three-line suggestion (the demo's third card) the Details control starts at 208 px. Minimum size: 144 px visible, the control starts at 154 px. |
| Fireflies import before a call | `command("context.fireflies")` on a fresh controller with a key | "External context import is disabled in Demo mode. Start a live session to connect it." |
| Dialog sizes | Measured each open dialog with a tall viewport | Connections 1,913 px tall with 16 visible controls and three save buttons; Call setup 931 to 998 px depending on the source selected; nine dialogs in total |
| Smallest text | Computed font sizes of visible text | 9 px |
| Secrets in the repository | Searched all 28 commits for key patterns and credential files | None found |

Read in the code and not run by the author: 1.4, 1.5, 1.7, 1.8, the window behavior in 3.4, and everything in Milestones 4 and 6.

A second, independent pass then re-checked every file and line reference in this brief and reproduced the findings above. It also exercised 1.4, 1.5, 1.7 and 1.8 with a fake WebSocket and a stub of the Electron API, and its corrections are folded in. Neither pass ran the app on a Mac.

## Appendix B: Words

**Ready**
- What kind of call is it? · Interview, Sales, Client, Negotiation, Something else
- Who is it with, and what do you want out of it?
  - Interview placeholder: "Second interview at Brightline for Head of Growth. Show I can run paid media end to end."
  - Sales placeholder: "Discovery call with Harbor Dental. Find out why leads dropped and book the audit."
  - Client placeholder: "Monthly check-in with Northwind. Agree the Q4 budget."
- Give it something to work from · Optional · Drop files, paste text or add a link. PDF, Word, notes, past transcripts.
- Everyone on this call is fine with transcription and AI notes
- Start listening
- Recent · Practice with a sample call

**Live**
- States: Listening, Reconnecting, Waiting, Paused
- Trigger labels: They asked, They said, You asked
- Kind labels: Say, Ask, From your notes, Heads-up, Bigger picture
- Quiet: "Nothing to add right now." / "You'll see something here when they ask you a question or when your notes can help."
- Ask anything · Help me now

**Errors: what happened, then the one action**

| Situation | Message | Action |
|---|---|---|
| Key rejected (401) | OpenAI didn't accept this key. | Replace key |
| Out of credit (429, insufficient quota) | Your OpenAI account is out of credit. | Open billing |
| Model not available (403, 404) | This key can't use the quick-answer model. | Use recommended models |
| Rate limited (429) | OpenAI is limiting requests. Suggestions will be slower for a minute. | none; clears itself |
| Slow or timed out | OpenAI is slow right now. Suggestions may lag. | none; clears itself |
| Connection lost | Connection dropped. Catching up, nothing is lost. | none; clears itself |
| Microphone denied | Callwise can't use the microphone. | Open System Settings |
| Call audio denied or silent | Callwise can't hear the call audio. | Open System Settings, or Run sound check |
| Device changed | Switched to MacBook Pro Microphone. | none; brief notice |
| File has no text | Couldn't read text from Proposal.pdf. It may be a scan. | Paste the text instead |
| Shortcut taken | Another app is using ⌃⌥Space. | Choose another |

## Appendix C: Card shape, prompt, playbooks

**Fast lane output**

```json
{
  "speak": true,
  "kind": "say",
  "lead": "Start with the dental group you rebuilt. Cost per lead fell 38% in one quarter.",
  "points": [
    { "label": "Found", "text": "60% of spend going to branded search" },
    { "label": "Rebuilt", "text": "the account around three service lines" },
    { "label": "Result", "text": "$212 down to $131 a lead, held two quarters" }
  ],
  "sourceIds": ["resume", "case-notes"],
  "covers": []
}
```

`kind` is one of `say`, `ask`, `fact`, `heads_up`. When `speak` is false every other field is empty and the stream is cancelled.

**Slow lane output**

```json
{ "speak": true, "kind": "bigger_picture", "lead": "…18 words or fewer…", "more": "…90 words or fewer…", "sourceIds": [] }
```

**Fields the engine adds** (never the model): `id`, `lane`, `origin` (`auto`, `asked`, `hotkey`), `trigger: { speaker, text, segmentId, endedAtMs }`, `createdAt`, `latency: { requestedAt, firstTokenAt, firstPaintAt, doneAt }`, `sources`, `status`, `late`.

**Rules for every call type**
- Write `lead` as words he can say aloud as they are, in the first person. No preamble.
- Never invent experience, numbers, names or commitments. When the materials don't support an answer, give a structure for answering and say what is missing.
- A fact needs a source id. A suggestion does not.
- If he has already said it, stay silent.
- Three points at most. Fewer is better.

**Playbooks**

*Interview* (he is the candidate)
- Triggers: any interviewer question; "do you have questions for us?"
- A good card: `say`. The lead is the thesis of the answer. Points are situation, action and result from one real example in his materials, with numbers.
- Also: when they hand over for questions, an `ask` card with his best prepared question. A `heads_up` if a strength the job post asks for hasn't come up after 15 minutes.
- Never: a made-up example. If nothing in the materials fits, give the structure and one clarifying question he can ask.

*Sales and discovery*
- Triggers: questions, objections, statements of pain, any mention of budget, timing or who decides.
- Good cards: `ask` to deepen or quantify a pain; `say` to answer with one of his proof points; `heads_up` when budget, authority, need or timing is still unknown near the end.
- Never: a product claim that isn't in the materials. Pressure tactics.

*Client*
- Triggers: questions and requests; a number, date or scope that conflicts with the materials or last recap; a commitment from either side.
- Good cards: `fact` with its source; `heads_up` for a conflict or a promise; `say` for direct questions.
- Never: correct the client on a detail that doesn't matter to the decision.

*Negotiation*
- Triggers: offers, anchors, deadlines, concessions, "final" language.
- Good cards: `ask` to surface interests; `heads_up` when he is about to concede without a trade; `fact` for his stated limits.

*Something else*
- Triggers: direct questions to him; decisions; commitments.
- Good cards: `say` for questions; `heads_up` for commitments.

## Appendix D: Tests to add

| Area | Test |
|---|---|
| Triggers | Table-driven unit tests for `core/triggers.mjs`: questions, backchannels, objections, the user's own speech, duplicates, the rate limit |
| Timing | Fake timers and an instant stub provider: every turn labelled for help in each fixture gets a card within one second; no request on turns the rules must skip |
| Speculative start | A partial question followed by an identical final keeps one request; a different final aborts and restarts |
| Streaming | A chunked fake response paints the lead before the response completes; `speak: false` cancels and shows nothing |
| Asked wins | A typed question during a proactive request cancels it and yields a visible card |
| Reconnect | A fake socket closes mid-utterance; audio is buffered and replayed; the status stays running |
| Preferences | Demo values never reach saved defaults; damaged defaults are repaired on load |
| Errors | An error clears when its condition ends; it is never shown twice |
| Shortcuts | Registered on start, unregistered on pause and end; a failed registration is reported |
| Import | PDF and Word extraction; a scanned PDF; one oversized file among several |
| Layout | Playwright screenshots at the listed sizes; no text clipped or overlapping |
| Recap | A fixture call produces a recap with all sections; commitments match the transcript |

## Appendix E: References

Checked on 8 October 2026.

- OpenAI model list: https://developers.openai.com/api/docs/models/all
- OpenAI GPT-6 guide (reasoning effort, prompt caching, streaming): https://developers.openai.com/api/docs/guides/latest-model
- OpenAI Realtime transcription (`gpt-live-transcribe`, no server turn detection, optional `keywords`, `languages`, `prompt`, `delay`): https://developers.openai.com/api/docs/guides/realtime-transcription
- OpenAI Realtime conversations ("The maximum duration of a Realtime session is 60 minutes"): https://developers.openai.com/api/docs/guides/realtime-conversations
- Electron `desktopCapturer` (Core Audio taps from v39, `NSAudioCaptureUsageDescription`, silent stream when launched from a terminal): https://www.electronjs.org/docs/latest/api/desktop-capturer
- Electron `BaseWindow` (`type: 'panel'`, `setVisibleOnAllWorkspaces`, `setAlwaysOnTop`, `setContentProtection`): https://www.electronjs.org/docs/latest/api/base-window
- Electron `systemPreferences` (`askForMediaAccess`, `getMediaAccessStatus`): https://www.electronjs.org/docs/latest/api/system-preferences
- Final Round AI, for comparison (goal per job, preflight, question detection, streamed short answer, automatic debrief): https://www.finalroundai.com
