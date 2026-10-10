# Callwise round 2: make the live call hold still

A punch list for Codex. Written 9 October 2026 against `main` at `f2f243e` (v0.4.0), the merge of pull request #4.
Put this file at `docs/CALLWISE_ROUND_2.md` and the attached `callwise-ui-reference.html` at `docs/callwise-ui-reference.html`.
The first brief (`docs/CALLWISE_BRIEF.md`) still holds. This file lists what the merge got right, what is still wrong, and what to change.

---

## Read this first

The merge did all six milestones in one pass. Most of it works. `npm test` (183 tests), `npm run check`, `npm run replay` and `npm run test:ui` pass, and the app runs end to end.

What is not right yet is the part Matt looks at during a call. The live panel flickers, loses clicks, hides the answer while it streams, blanks the card every time Callwise checks something, and grows down the screen whenever a notice appears. The rules that decide when to help miss common ways people ask questions. The recap lists figures of speech as promises.

Two things about how the last round was run caused some of this, so change them:

1. **The UI reference was never in the repository.** `docs/CHECKPOINT_1.md` and `docs/VALIDATION.md` both say so. It is attached again, with one new state ("Checking quietly") and a corrected sizing rule. Open it in a browser before touching `ui/`. Where the first brief's "440 × 320" and the reference disagree, the reference wins: the panel's height follows its content.
2. **The work was not stopped at checkpoints.** This round is five groups. Do group A, post what changed with before-and-after screenshots from the real app, and wait. Then B, and so on.

How this list was produced: the real app (Electron 44, Linux build, virtual display, driven with Playwright), the real renderer in headless Chromium wired to a real `CallController`, and the real engine in Node 22 with stub providers. A second, independent pass re-ran every item and its corrections are folded in. Nothing here ran on macOS or against OpenAI. Items that need a Mac or a key are in "Only Matt can check" at the end.

You can run the real app in CI on Linux the same way: `xvfb-run -a electron . --smoke --no-sandbox`. Use that to add the assertions below to `--smoke`, so the panel's behavior is tested in the real windows and not only in a browser page.

---

## Keep these

They were checked and they work. Do not regress them.

- The sample call no longer overwrites saved goal, call type or project, and damaged preferences are repaired on load.
- Help is requested the moment their question lands. In the sample call: questions at 0.5, 13.5, 26.5 and 42.0 s, requests at the same instants (they were at 3.0, 21.0, 39.0 and 57.0 s).
- A typed question's answer replaces the card without a click.
- A transcription socket that drops mid-sentence reconnects, replays the buffered audio, and the call stays running.
- Global shortcuts exist only while a call is running.
- Call time counts active time. Warning at two hours, stop at four.
- Importing a Fireflies transcript before a call works. File import handles each file by itself (PDF and Word extraction work in the real main process).
- Nine dialogs are now one confirmation. One README. No text under 12 px. The log and Copy diagnostics contain no key and no transcript. No key or token reaches a renderer.
- The price table matches OpenAI's model pages as of today.

---

## Group A: the live panel must hold still

One cause sits behind most of this group: `render()` in `ui/app.mjs:144-215` replaces the whole page (`root.innerHTML`, line 195) on every state update. Fix that first and several symptoms go with it.

### A1. Render by region, not the whole page

**What happens.** With the other person talking (the partial transcript updating 8 times a second) and the card unchanged:
- the card element is destroyed and rebuilt on every update, so its arrival animation (`ui/app.css:451-459`) restarts each time. In 3 seconds it restarted 24 times, and the card was fully visible in 11 of 183 frames. At 2 updates a second it is still mid-fade in about a fifth of frames.
- clicks are lost, because the button under the pointer is replaced between mouse-down and mouse-up. With a 90 ms press, 10 of 30 clicks on Pin registered here; the second pass got 20 of 80 in Chromium and 16 of 40 with native input in the real app. With no updates, all register. Pause, End, Pin, Not useful, the chevrons and Help me now are all affected.
- a text selection in "Ask anything" collapses within 300 ms, and buttons lose keyboard focus.
- the open transcript jumps back to the top on every update (scrollTop 2544 to 0), and rebuilding it costs about 37 ms per update at 60 minutes and 75 ms at 120 minutes on the test machine.
- **a streamed answer cannot be read while it streams.** Each token rebuilds the card and restarts the fade. Over a 1.3 second stream the card's opacity had a median of 0.17. It became fully visible about 150 ms after the stream ended. The streaming work from Milestone 2 is invisible.

**Fix.**
- Split each view into regions and give every region its own render function that returns a string. Keep the last string per region. Touch the DOM only when a region's string changes. Live has five: notice strip, status bar, card, caption and transcript, ask row.
- The ask row is created once and never replaced. The status bar changes only when state, lights or buttons change (the clock already updates its own text node).
- The card is replaced only when the card id changes. While a lead streams, set the lead node's `textContent`; when points arrive, append them.
- The transcript appends rows. Render at most the last 40, keep it pinned to the bottom unless the user has scrolled up.
- Apply the arrival animation by adding a class when the card id changes. Never during streaming, never on a transcript update.
- Do the same for Ready and Settings, so typing in the goal field does not rebuild the form. Then delete the focus, selection, value and `<details>` restoring in `ui/app.mjs:147-210`; it will not be needed.

**Accept when** (Playwright, real renderer, real controller, a talker that updates a partial 8 times a second):
- over 3 s the `.coach-card` node is the same object, no `animationstart` fires on it, and its opacity is 1 in every sampled frame;
- 40 presses of 90 ms on Pin produce 40 `card.pin` commands;
- select-all in `#question` is intact after 500 ms;
- with the transcript open and scrolled up, the next update leaves `scrollTop` unchanged;
- while a lead streams at 60 tokens a second, the card's opacity is 1 from the first painted token.

### A2. The panel's height follows its content, and comes back

**What happens.** `.live-view` has `min-height: 100vh` (`ui/app.css:377-383`). Notices are drawn above it (`ui/app.mjs:175-195`). `fitPanel()` (`ui/app.mjs:216-226`) asks for the page's scroll height after every render and `desktop.panel.fit` (`desktop/main.mjs:526-543`) applies it. With any notice showing, the content is always one notice taller than the window, so the panel grows by that amount on every update.

In the real app, with no development banner: one `capture.error` during the sample call took the panel from 440 × 320 to 440 × 908 in 50 seconds. At four updates a second a five-second notice took it to the 976 px cap in 3.5 seconds. Dismissing the notice does not bring it back. Opening and closing the transcript leaves it at 571. The height is saved (`desktop/main.mjs:225-240`), so the next launch opened at 810. The update banner and the development banner do the same. While a notice shows, the ask row sits below the bottom edge.

**Fix.** This is what the reference shows: live windows from 232 px (nothing to add) to 404 px (a full card).
- Width belongs to the user: 340 to 640, remembered per display. Height is automatic. Stop saving it (`desktop/main.mjs:225-240`, `core/preferences.mjs:96-112`).
- Remove `min-height: 100vh` from the live view. Measure the natural height of a wrapper around the five regions.
- Ask for a new height only when that number changes by more than 2 px, clamp it between 232 and 70% of the work area, and let it shrink as well as grow. The floor of 320 is written in four places: `ui/app.mjs:222`, `desktop/main.mjs:193`, `:206`, `:530`.
- Keep the top edge where it is. Animate over one motion duration at most.
- Past the cap, the card region scrolls. Nothing else does.

**Accept when** (real app, in `--smoke`): quiet state is 240 px or less; a full card with three points, a bigger-picture line and two sources fits with nothing cut off at 340, 440 and 640 wide; after a notice and 20 state updates the height is the earlier height plus the notice's height and no more; dismissing it returns to the earlier height within 2 px; opening then closing the transcript returns to the earlier height; a relaunch opens at the default.

### A3. Notices live inside the panel, one at a time, and leave on time

- In the panel a notice is one strip between the status bar and the card: one sentence, at most one action, dismiss. The reference shows it ("Reconnecting", "Needs you"). Never above the status bar, which is the drag handle. One at a time: an error beats a warning.
- The update banner and the development-run banner belong on Ready, not in the panel.
- A timed notice does not leave when its time is up. Errors are filtered when a snapshot is taken (`core/engine.mjs:953-955`) and nothing emits at expiry. A five-second notice was still showing 18 seconds later. Emit a state update at the next expiry.
- In the desktop app every command error is shown with Electron's wrapper: "Error invoking remote method 'callwise:command': Error: Open Settings and save your OpenAI API key." Strip it in `desktop/preload.cjs:11-12` (catch, rethrow the clean message). That also removes the duplicate banner: the engine's error and the local notice no longer match in `ui/app.mjs:192` because of the prefix.

**Accept when:** a 5 s notice is out of the DOM by 6 s with no other activity; a command that throws in `--smoke` shows exactly its message, once.

### A4. Keep the card while Callwise checks quietly

**What happens.** While any fast request is in flight, `ui/components/card.mjs:25-31` replaces the card on screen with a placeholder: "They asked <their words>" and "Finding useful words…". That includes the background check and every non-question trigger, most of which end with the model saying nothing, after which the old card comes back. In a constructed six-minute interview (Appendix B) the card was blanked 13 times, 9 of them for remarks that needed no help, each labelled "They asked", for example: They asked "Ha, that's a familiar story."

**Fix.** See "Checking quietly" in the reference.
- A request Callwise started by itself never removes the current card. Show activity as a ring on the status light. When the first streamed words arrive, the new card takes over.
- The placeholder is for two cases only: there is no card yet, or the user asked (typed, or Help me now).
- "They asked" is for triggers classified as questions. Everything else is "They said".
- Help me now shows "You asked for help" as its trigger line, not the internal sentence at `core/controller.mjs:365-370`.
- When an explicit ask fails because the provider failed, do not show the "I need more verified context" card (`core/engine.mjs:751-756`, `:783-812`). That card is for a model that answered with nothing. For a failure, show the error and keep the previous card.

**Accept when:** with a card on screen, a background check that returns `speak: false` after 1.5 s never changes the card region's HTML.

### Checkpoint A

Post: the five acceptance results, and screenshots from the real app of quiet, arriving, full card, checking quietly, a notice, and transcript open, each beside its reference.

---

## Group B: hear the question

### B1. Classify by sentence, strip fillers, allow short questions

**What happens.** `classifyTurn` (`core/triggers.mjs:21-73`) calls a turn a question only if the whole turn starts with a listed word or ends with "?" (`:33-39`), and drops anything under four words (`:32`). That rule came from the first brief and it was too narrow. On 50 realistic lines that need help (Appendix A) the rules caught 27 (31 if transcription always writes question marks and digits). The second pass wrote its own 45 and the rules caught 30. Missed: "So, tell me a little bit about yourself.", "Okay, great. Walk me through your résumé.", "I'm curious how you think about attribution.", "Explain how you'd handle…", "Help me understand…", "Why us?", "Salary expectations?".

It also fires on lines that need nothing: "Give me one second.", "Can you hear me okay?", "I may have to jump off early." ("may" is in the month list, `:65-71`), "We'll see how it goes." and "Let's see, where was I." (both count as commitments, `:52-57`). In Appendix B, 11 of 16 lines that should stay quiet caused a model request.

**Fix.**
- Split their turn into sentences. Strip up to three leading fillers from each: so, okay, ok, right, well, and, but, great, alright, now, then, um, uh, yeah.
- The turn is a question if any sentence ends with "?" or, after stripping, starts with an interrogative or auxiliary (today's list plus will, should, was, were, has, had, which, whose, any) or a request stem: tell me/us, walk me/us through, talk me/us through, talk to me/us about, talk about, describe, give me/us, explain, help me understand, remind me, show me, I'd love to hear/know, I'd like to hear/know/understand, I'm curious, I'm wondering, I wonder, my question is, the question is, what about, how about.
- A sentence ending in "?" with two or more words counts. Keep the four-word floor for the other classes only.
- Skip logistics before any model call: can you hear me, can you see my screen, is this thing on, give me a/one second/sec/minute, hold on, bear with me, one moment.
- "may" is a month only next to a day number or after in, by, of, next, last, this.
- A commitment cue needs a first-person subject and a doing verb (send, share, get, email, schedule, set up, introduce, connect, check, confirm, look into, follow up, circle back, put together, draft, book), or a deadline next to a verb. Bare "let's", "we'll see" and "I'll be honest" are not commitments.
- Which classes trigger a request follows the playbooks in the first brief's Appendix C. In an interview only questions do.
- Classify the joined text of their consecutive segments as well as the newest segment. Segments are cut at 600 ms pauses and at 8 to 14 seconds (`providers/transcription.mjs:447-452`), so one question often arrives as two. One request per turn.

### B2. A wrap-up cue must not replace the answer

"We're at time, so do you have any questions for us?" is tested for wrap-up words before it is tested as a question (`core/triggers.mjs:26-31`), and the engine returns after pushing a local card (`core/engine.mjs:381-385`, `:429-463`): "Before we finish, I want to cover the remaining points." The most predictable moment in an interview gets a canned heads-up and no model call.

**Fix.** Question first. If the turn is both, ask the model with `triggerKind: "wrap_up"`; the uncovered points are already in the prompt. Keep the local card for a wrap-up cue with no question and real uncovered points.

### B3. Do not spend the background check on small talk, and never drop a question at the limiter

- The 45-second background check (`core/engine.mjs:386-395`) goes to the first unclassified sentence of four words or more, which is usually an acknowledgement ("That makes sense to me."). The missed question that follows a few seconds later finds the slot used. In Appendix B, 5 of 11 turns that needed help got no request at all. Replace it: when their turn has ended (1.2 s with no new segment from them), was not classified, and has eight words or more, check once on the whole turn. At most one such check per 20 s.
- The limiter (`core/engine.mjs:397-401`) refuses a trigger for good. Three throwaway lines two seconds apart, then "What did we agree the monthly budget would be?": the question got no request and was never retried. Questions and explicit asks bypass the bucket (the per-session cap still applies). Only the other classes are limited.

### B4. Do not cut a lead mid-sentence

`core/prompts.mjs:165-168` cuts every lead at 16 words (18 for the bigger picture) and every point at 12; `:200` does the same to the sample call's cards. A 20-word lead from a model is shown as its first 16 words. The sample call's second card reads: "In two weeks, we can give you a decision memo and a small test plan. Can".

**Fix.** Keep asking for 16. Accept up to 24 without cutting. Past that, cut at the last sentence or clause boundary. Points: ask for 12, accept 16.

### Checkpoint B

Add Appendix A as a table-driven test and Appendix B as `fixtures/replay/interview-long.json`.
- Every "needs help" line in Appendix A classifies as a question or request. Every "stay quiet" line makes no request.
- In Appendix B every turn marked help gets a model request in the same tick, including the wrap-up turn. No request for the seven short remarks that are not questions (9, 63, 97, 120, 158, 195 and 271 s). Longer statements may get the one quiet check; with A4 in place that check never changes the card.
- `npm run replay` reports both.

---

## Group C: starting a call cannot strand you

1. **Start stays on "Connecting…" after any failed start.** `core/controller.mjs:629-639`: the catch calls `stopInputs()`, which bumps the generation, so the `finally` never emits. The last state the window receives has `connecting: true`. With a rejected key the screen shows the error and a dead button. Emit after clearing. Test: a start that rejects leaves `connecting: false` in the last emitted state.
2. **No internet: a minute of "Connecting…".** The first connection uses the 60-second recovery window (`providers/transcription.mjs:32`); 72 seconds if the connection hangs. For the first connection give up after 10 seconds with "Couldn't reach OpenAI. Check your internet connection." and Try again. Put Cancel beside "Connecting…". The messages in `recover()` (`providers/transcription.mjs:560-607`) say "pause and resume", which is wrong before a call has started.
3. **A capture failure pauses the call and says nothing.** `ui/app.mjs:104-122` pauses and writes the reason to the main window's local notice. The main window is hidden during a call (`desktop/main.mjs:370-374`). The panel shows "Paused" with no reason, and Resume repeats it. A refused permission takes this path. Send it through `capture.error` (`core/controller.mjs:371-379`) so the panel shows it, with the action from the first brief's Appendix B.
4. **Silent call audio gives no warning.** `ui/capture.mjs:102-105` reports "No signal yet" after 12 seconds and nothing draws it (`ui/views/live.mjs:14-23`). When the microphone has signal and call audio has had none for 15 seconds, show "Callwise can't hear the call audio." with Run sound check. Clear it when signal arrives.
5. **The key test says "fetch failed" with no internet** (`desktop/self-test.mjs:38-45`). Map network failures to the connection message.
6. **Start goes below the fold.** At 720 × 560, three short file names plus the prep row clip the bottom of the Start button; names that wrap to a second row hide it, and the error banner that follows a failed start is scrolled out of view at the top. Make consent, Start and its reason a bar fixed to the bottom of the window. Put chips inside the drop zone as in the reference, two rows at most, then "+3 more". Accept when `#consent` and `#start` are fully visible with 8 materials and 5 recent calls at 720 × 560 and at 580 × 480.
7. **The goal field is pre-filled with a stock sentence** (`core/defaults.mjs:3`, `ui/views/ready.mjs:39`), so the per-type examples never show and Recent fills with "Have a useful conversation…". Default to empty. Name a call sheet with no line by type and date. Migrate a saved goal equal to the old default to empty.
8. **Start throws the prep away.** `core/controller.mjs:506-513` cancels a prep in flight and substitutes `localPrep`. Start pressed 1.2 seconds after the last edit: no likely questions, no glossary, no keywords to transcription. Start should never wait and never cancel: begin with what exists, and adopt the prep once if it lands in the first two minutes. Apply the glossary at the next reconnect or rotation. On Ready say "Preparing your notes. You can start now."
9. **Practice deletes the setup.** `ui/app.mjs:364-367` sends `new` with `clearContext: true`. A call sheet is only saved at a real start (`core/controller.mjs:624`, `:806`). Add a note, run the sample, press Another call: the note is gone. Save a draft call sheet whenever the line or materials change, and restore it after the sample.

### Checkpoint C

Each of the nine has a test. Post a screen recording or frame sequence of: wrong key, no internet, and Practice then Another call.

---

## Group D: prep, structure and recap you can trust

1. **Who owes what lists figures of speech.** `core/engine.mjs:352-364` records any sentence with I'll, we'll, let's, I will, we will, "I can send" or "by <weekday>". In Appendix B it recorded ten; two are promises and one is conditional. The other seven: "I'll give you a quick overview", "so I'll start there", "I'll be honest", "Let's switch gears a little", "we'll see", "We'll come back to that", "Let's see, I think that's everything". `validateRecap` (`core/preparation.mjs:133-142`) then builds the list from every recorded sentence, verbatim; the model's wording is kept as `summary` and never shown (`ui/views/recap.mjs:10`, `recapMarkdown`), and a promise the pattern missed cannot appear even when the model reports it.
   **Fix.** The model decides, the transcript proves. Accept the model's items when every segment id is a final transcript row (that check exists at `:123-125`). Show the model's owner, what and due. Keep the verbatim sentence as the expandable source. Record in-call candidates only with the tighter cue from B1. Say "Them", not "Other".
   **Accept when** Appendix B yields exactly: they reply by Friday after talking to the team; he sends the case study by tomorrow; optionally the conditional introduction to the ops lead.
2. **Recap gives up at 19 seconds and cannot be retried.** `core/controller.mjs:946`. There is no retry command. Prep gives up at 20 seconds (`:842`); `prep.refresh` (`:436-438`) makes no request after a fallback because `prepare()` returns early (`:812`), and no control sends it. Allow 60 seconds. Add `recap.retry` and a Try again button whenever the fallback is on screen and a key exists. Same for prep.
3. **Fallbacks that do not pretend.** `localPrep` (`core/preparation.mjs:64-81`) makes the call line the one point to cover (`:77`), so the panel shows "0 of 1 covered" and the wrap-up card says to cover "First interview at Brightline for Head of Growth." With no real prep there is no to-cover row. `localRecap` (`:82-121`) writes a "follow-up email" made of five transcript quotes. Leave the email empty, and label the lines "Last lines of the call".
4. **The sample call should show the product.** `providers/demo.mjs` returns the old card shape: no points, no streaming, the second client question gets no card (a duplicate of the first), the second lead is cut mid-sentence, any typed question gets the same line, and the recap is the fallback. Script it: cards with points, streamed in chunks; one From your notes card with its source; one Heads-up; a bigger-picture line; a to-cover list that ticks; a recap with two promises and an email. It is the first thing a new user sees and the only call CI can screenshot.

### Checkpoint D

Recap screenshots for the sample call and for Appendix B through a stub model. Report what a slow model (25 s) now looks like.

---

## Group E: polish against the reference

1. **One visual pass on Live, Ready and Welcome with the reference open.** The panel was squeezed to fit 320 px, and it shows. From the reference: lead at line-height 1.22 (it is 1.1). Points 15 px at 1.35 with 6 px between them (they are 13 px at 1.15 with 2 px). Card padding 16 px 18 px 12 px (it is 4 px 12 px). The trigger line is 13 px and wraps (it is 12 px on one line, cut with an ellipsis, so the question cannot be read). Point labels bold and bright, their text lighter (it is the other way round). Source chips, not disclosure triangles. Meters with four bars. End as a labelled button. Help me now shows its shortcut. Start listening is full width.
2. **Hotkeys.** Keep help, pause and show/hide registered while paused as well as running (`desktop/shortcuts.mjs:28-32`), and make pause toggle (`desktop/main.mjs:346`). The first brief asked for both "unregister on pause" and "pause or resume"; the second wins. The recorder builds the shortcut from `e.key` (`ui/app.mjs:749`): arrow keys become "ARROWRIGHT" and are rejected by `core/preferences.mjs:83`. On a Mac, Option changes the character (Option+P is "π"), which would be rejected too. Build it from `e.code`. Same for the in-window resume at `ui/app.mjs:763-771`.
3. **The bigger picture almost never runs.** It needs one of seven phrases from the other person (`core/triggers.mjs:46-51`), and "Let's switch gears" is classed as a commitment first. Either run it on a cadence (every four to five minutes of new conversation with six or more of their turns) or take the line out. Its provider uses `effort: "high"` (`core/controller.mjs:119`) with a 20-second first-token limit (`providers/openai.mjs:56`); measure that with a key before keeping it.
4. **Signing in one command.** Today: generate a certificate, base64 it, paste two secrets, tag, run a workflow. `npm run signing:setup` should set both secrets itself when `gh` is signed in and print the one next step.
5. **Small.**
   - "matt" and "matthew" are hard-coded (`core/triggers.mjs:12`, `ui/views/live.mjs:9-10`), and the recap prompt says "Matt's" (`core/controller.mjs:949`). Use the saved name.
   - Echo removal leaves a stuck unfinished microphone row (`core/engine.mjs:263-272`). Delete the row with the same id when its final is dropped.
   - Every engine error is logged as `provider.error` with no condition (`core/engine.mjs:902`); log the condition. `floatingPanel` reads the wrong preference (`desktop/diagnostics.mjs:135`).
   - Error strings still say session, Connections and Demo mode (`core/controller.mjs`, `core/engine.mjs`).
   - A note to developers is shown in Settings (`ui/views/settings.mjs:54`: "The fast model remains…").
   - The import message does not say which file was skipped for which reason.
   - Prep is re-requested 750 ms after each pause in typing the line (`core/controller.mjs:804`, `ui/app.mjs:665-677`) with all materials. Wait 2.5 s and cap what prep is sent.
   - Every state update sends the whole transcript to both windows (about 240 KB at an hour, and one streamed answer is about 85 updates). It measured cheap with the transcript closed. Send new rows only when you rework rendering.
   - Unused: `ui/suggestion-focus.mjs` (tests only), `checkModelAccess` (`core/connections.mjs:139`), `describeAudioCapture` (`ui/capture.mjs:197`), `desktop.compact` (`desktop/main.mjs:682`).

---

## Only Matt can check

None of this could be run without a Mac and a key. Give him a five-minute script for each at the relevant checkpoint.

- The panel over a full-screen Zoom, Meet or FaceTime window, and whether typing in the meeting keeps focus there.
- Whether ⌃⌥Space, ⌃⌥P, ⌃⌥[, ⌃⌥] and ⌃⌥H register. ⌃⌥Space is macOS's "next input source" when more than one keyboard layout is enabled.
- Real capture: both meters move, the microphone and call-audio sound checks pass, and what the check says when output is muted.
- Unplugging headphones mid-call. On every `devicechange` the call-audio stream is re-acquired (`ui/capture.mjs:8-10`, `:123-162`).
- Time from the end of their question to first words, with Settings › Advanced › "Show response timing overlay", and `npm run replay -- --live --compare` for the two fast models.
- Whether the deep model returns a recap inside the limit after a 30-minute call.
- Permissions surviving an update. This needs the signing identity set up first. There are no GitHub Releases yet, so the README's install link is empty and builds are still ad-hoc signed.

---

## Appendix A: lines for the trigger test

Each line is the other person speaking. Mode in brackets.

**Needs help (a question or request to the user).** Marked ✓ if `f2f243e` catches it, ✗ if not.

| | Mode | Line |
|---|---|---|
| ✗ | interview | So, tell me a little bit about yourself. |
| ✗ | interview | Okay, great. Walk me through your résumé. |
| ✗ | interview | I'd love to hear about a time you turned around an underperforming account. |
| ✓ | interview | What's your biggest weakness? |
| ✗ | interview | Why us? |
| ✓ | interview | Why do you want this role? |
| ✓ | interview | And how did you measure that? |
| ✗ | interview | Great. So how would you approach the first ninety days here. |
| ✗ | interview | I'm curious how you think about attribution. |
| ✗ | interview | Talk to me about your management style. |
| ✓ | interview | Can you give me an example? |
| ✓ | interview | Any questions for us? |
| ✗ | interview | Any questions? |
| ✗ | interview | Salary expectations? |
| ✓ | interview | That's interesting. What did the team look like, and what was your role in it? |
| ✓ | interview | What was the outcome? I ask because we've had mixed results with agencies. |
| ✗ | interview | We've had mixed results with agencies before. What would you do differently? Just so I understand your approach. |
| ✓ | interview | Right, so, um, could you walk me through how you'd structure the account? |
| ✗ | interview | Explain how you'd handle a client who wants to cut the budget in half. |
| ✓ | interview | Give me a sense of the scale you were working at. |
| ✗ | interview | Help me understand why you left your last role. |
| ✗ | interview | I'd like to understand your experience with paid social. |
| ✓ | interview | Where do you see yourself in five years? |
| ✓ | interview | You mentioned a dental group. What were the numbers there? |
| ✗ | interview | So what would you say is your greatest strength. |
| ✓ | interview | Describe a conflict you had with a stakeholder and how you resolved it. |
| ✗ | interview | Tell me more. |
| ✓ | interview | Let's talk about compensation. (caught, but as a commitment) |
| ✓ | sales | How much does this cost? |
| ✗ | sales | And what does onboarding look like. |
| ✓ | sales | Do you work with other dental groups? |
| ✗ | sales | I guess my question is whether you can guarantee results. |
| ✓ | sales | We're paying about $12,000 a month right now. |
| ✓ | sales | Honestly it feels too expensive for what we get. |
| ✓ | sales | What kind of results have you gotten for practices like ours? |
| ✓ | sales | Who else have you worked with in our space. |
| ✓ | sales | Send me a proposal and we'll take a look. |
| ✗ | sales | The other thing I wanted to ask about is reporting. |
| ✗ | sales | What about pricing? |
| ✓ | client | Can you remind me what we agreed on for the Q4 budget? |
| ✗ | client | Remind me what the monthly retainer is. |
| ✗ | client | I thought we said twelve thousand a month. |
| ✓ | client | What's the status on the landing pages? |
| ✓ | client | Where are we on the tracking fix. |
| ✓ | client | I need the report by Friday. |
| ✓ | client | So are we still on track for the launch? |
| ✗ | client | Walk us through the numbers. |
| ✓ | client | Talk us through what changed in September. (caught, but as a number) |
| ✓ | client | Why did leads drop last month? |
| ✗ | client | And the invoice? |

**Stay quiet (no request).** Marked ✓ if `f2f243e` stays quiet, ✗ if it makes a request.

| | Mode | Line |
|---|---|---|
| ✓ | interview | Yeah. |
| ✓ | interview | Right, okay. |
| ✓ | interview | Got it, thanks. |
| ✓ | interview | Mm-hm. |
| ✓ | interview | That makes sense to me. |
| ✓ | interview | Okay, cool, that's really helpful. |
| ✓ | interview | Sorry, my dog is barking in the background. |
| ✗ | interview | Give me one second. |
| ✗ | interview | Can you hear me okay? |
| ✓ | interview | Let me share my screen. |
| ✗ | client | I may have to jump off a few minutes early. |
| ✗ | client | We'll see how it goes. |
| ✓ | interview | I'll be honest, I wasn't sure what to expect today. |
| ✗ | client | Let's see, where was I. |
| ✗ | sales | Is this thing on? |

These lines were written for the test; they are not from a recorded call. Treat the counts as a guide to the kinds of miss, not as a rate.

## Appendix B: a six-minute interview for the replay

T is the other person (call audio). Y is the user (microphone). The number is seconds from the start. "help" marks the turns where the user wants words on screen.

| Who | At | Line | |
|---|---|---|---|
| T | 2 | Hi Matt, thanks for making the time today. | |
| Y | 5 | Thanks for having me, I'm glad we could make it work. | |
| T | 9 | Can you hear me okay? | |
| Y | 11 | Yes, loud and clear. | |
| T | 14 | Great. So I'll give you a quick overview of the role, and then we'll get into your background. | |
| T | 24 | We're a dental services group with about forty locations, and paid media has been mostly agency-run until now. | |
| T | 36 | So, tell me a little bit about yourself. | help |
| Y | 41 | Sure. I've spent about ten years in performance marketing, most recently running paid media for multi-location healthcare brands. | |
| Y | 55 | The work I'm proudest of is rebuilding a dental group's paid search account. | |
| T | 63 | Okay, interesting. | |
| T | 66 | Walk me through that rebuild. What did you actually change? | help |
| Y | 72 | When I came in, about sixty percent of spend was going to branded search, so I'll start there. | |
| Y | 84 | We restructured the account around three service lines and cut cost per lead from two hundred twelve dollars to one thirty one. | |
| T | 97 | That makes sense to me. | |
| T | 101 | And how did you measure whether that actually worked? | help |
| Y | 106 | We tracked booked appointments, not just form fills, and I'll be honest, that took a quarter to get right. | |
| T | 120 | Right, okay, got it. | |
| T | 125 | I'm curious how you think about attribution when the reports disagree. | help |
| Y | 131 | I usually start by lining up the attribution windows, because that explains most disagreements. | |
| T | 144 | Yeah, we've been burned by that. Our last agency reported on a thirty day window and finance used seven. | |
| T | 158 | Let's switch gears a little. | |
| T | 162 | Tell me about a time you disagreed with a stakeholder. How did you handle it? | help |
| Y | 170 | A founder wanted to double the social budget after one good week. I asked for two more weeks of data and we'll see, I said, whether it holds. | |
| Y | 186 | It didn't hold, and we kept the budget where it was. | |
| T | 195 | Ha, that's a familiar story. | |
| T | 199 | Okay, great. So how would you approach the first ninety days here. | help |
| Y | 205 | First month I'd audit the account and tracking. Second month I'd rebuild campaign structure. Third month I'd start testing. | |
| T | 222 | And what would you need from us to make that work? | help |
| Y | 228 | Access to the booking data, and one person on your side who can make decisions quickly. | |
| T | 240 | That should be fine. I'll connect you with our ops lead if we move forward. | |
| T | 251 | Explain how you'd handle it if we asked you to cut the budget in half. | help |
| Y | 258 | I'd protect the campaigns that book appointments and pause the rest, then show you what we lose. | |
| T | 271 | Makes sense. | |
| T | 274 | What's your biggest weakness? | help |
| Y | 279 | I can stay in the details too long, so I've learned to set a deadline for the analysis and then decide. | |
| T | 293 | Salary expectations? | help |
| Y | 297 | I'm looking for something in line with a head of growth role, and I'm flexible on structure. | |
| T | 310 | Okay. We'll come back to that later in the process. | |
| T | 318 | I think that's most of what I had. We're at time, so do you have any questions for us? | help |
| Y | 326 | Yes. What would make someone successful in this role in the first year? | |
| T | 334 | Honestly, getting the tracking fixed and making the board trust the numbers. | |
| Y | 345 | That's helpful. And what are the next steps? | |
| T | 350 | I'll talk to the team this week and we'll get back to you by Friday. | |
| T | 358 | Let's see, I think that's everything. Thanks again, Matt. | |
| Y | 363 | Thank you, I'll send over the case study I mentioned by tomorrow. | |

At `f2f243e`: of the 11 help turns, 5 get a model answer (66, 101, 162, 222 and 274 s), 5 get no request (36, 125, 199, 251 and 293 s), and the wrap-up turn at 318 s gets the canned heads-up. Of the 16 other turns from T, 11 cause a model request. Ten commitments are recorded; the real ones are at 350 and 363 s, and 240 s is conditional.
