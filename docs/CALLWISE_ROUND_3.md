# Callwise round 3: instant cards, surprises handled, the Stage screen

A brief for Codex. Written 12 November 2026 against branch `codex/fix-meeting-setup-scrolling` at `cf0ef1b` (v0.5.8, pull request #7).
Put this file at `docs/CALLWISE_ROUND_3.md`. Earlier briefs (`docs/CALLWISE_BRIEF.md`, `docs/CALLWISE_ROUND_2.md`) still hold where this one is silent.

**Work from that branch, not `main`.** `main` is still v0.4.1 from October. The last outside test report tested `main` by mistake.

---

## Read this first

### What Matt wants

Callwise should "just work" during a live call. He glances at the screen, says something true and specific, and looks present. He tested 0.5.8 in interview mode on 12 November and found it close, with four problems:

1. Cards arrive too late.
2. Some cards told him to recall things, hedged in his own voice, or changed story between tries.
3. The screen has too much header, small questions, and silent cues that look like the line to say.
4. Nothing useful happens when a question was not in the prep material.

This round fixes those four, adds prep packs that an assistant can build for him, and closes the open findings from the outside test report.

### Who builds what

Matt does not want Codex designing screens. The split is strict.

| Area | Owner |
|---|---|
| `core/`, `providers/`, `desktop/`, `native/`, `scripts/`, `tests/`, `fixtures/`, `docs/` | Codex |
| `ui/views/`, `ui/components/`, every `.css` file, `ui/render.mjs`, `ui/index.html` | Claude |
| `ui/app.mjs`, `ui/meetings.mjs`, `ui/state.mjs`, `ui/shortcuts.mjs`, `ui/capture.mjs` | Shared. Codex may add command handlers, draft state and data plumbing. No markup, no styling, no layout. |

Rules for Codex:

- Do not add, restyle or rearrange anything Matt sees. Where a feature needs a screen, ship the state and commands in "The UI contract" below, plus a fixture, and stop.
- Until Claude's screens land, map new card data onto the existing coaching feed (`ui/components/coaching-feed.mjs` reads `lead` and `points`): set `lead` from `say` and `points` from `cues`. That keeps the app usable without new design.
- Claude builds on branch `claude/stage-ui`, based on your branch after each checkpoint, and opens its own pull request. If Claude needs a field you did not provide, add the field; Claude will not reach into engine internals.
- Add the ownership guard in A11 so this split is enforced by CI.

### Checkpoints

Five groups, A to E. Finish a group, post what changed with test output, and wait for Matt before starting the next. Round 2 went wrong when everything landed in one pass.

### How this brief was produced

A read of the 0.5.8 source, `npm audit` run against its lockfile, one reproduction on the 0.5.8 engine in Node 22, Matt's screenshots from a live interview-mode test on 12 November, and ChatGPT's install and test report on v0.4.1. Nothing here ran on macOS or against OpenAI. Items that need a Mac or a key are under "Only Matt can check".

---

## Keep these

Checked in the 0.5.8 source. Do not regress them.

- The participant-notice gate before any transcribed meeting, and the objection flow.
- On-device Apple speech as the default engine, with no automatic cloud fallback.
- Encrypted library, encrypted settings, fail-closed storage.
- "Never invent experience, numbers, names or commitments." Factual cards must cite supplied material, and citation ids are validated.
- All materials, transcripts and imported content are untrusted data to the model, never instructions.
- End drains final words: `drainInputs` in `core/controller.mjs` waits up to 8 s and `LiveTranscriber.finish` commits pending audio.
- Reading position in the coaching history is preserved when a card is appended.
- Models stay fixed for the length of a call. Fast processing remains an explicit setting.
- Explicit help (`Help me now`, the Ask box, `Deeper advice`) stays immediate.

---

## What 0.5.8 does today

These are the behaviors this round replaces. All verified in the source.

| Behavior | Where |
|---|---|
| Automatic help waits for a final transcript, then a fixed 1.4 s of quiet, then asks the model, which writes from scratch. | `core/controller.mjs:88` (`turnPauseMs: 1400`), `queueTurn` in `core/engine.mjs` |
| Starting on a question's first words exists but is off. | `speculatePartials: false`, same line; `completePartial` in `core/triggers.mjs` |
| While a reply streams, only the lead is painted. Cue bullets appear when the whole reply has arrived. | `onPartial` in `CoachEngine.run` (`points: []`) |
| Above about 80,000 characters of material, the fast lane stops receiving the files and gets one excerpt of up to 1,800 characters per file, chosen by keyword overlap. | `makePrompt` in `core/prompts.mjs`, `ContextStore.search` in `core/context.mjs` |
| Prep reads only the first `60000 / fileCount` characters of each file. | `prepPrompt` in `core/preparation.mjs` |
| Prep predicts up to 15 likely questions with an outline. They are only passed to the model as notes. No finished card is made. | `PREP_SCHEMA`, `validatePrep` |
| The fast-lane prompt asks for first-person words to say aloud and also says "name the missing detail". Missing details therefore come out as things for Matt to say. | `instructions` in `makePrompt` |
| Long cue bullets are cut at 16 words and trimmed back to the last punctuation mark, which can be a semicolon or comma. | `concise` and `validateAdvice` in `core/prompts.mjs` |
| The card shows the whole raw turn as the question, filler and mishearings included. | `triggerFor` in `core/engine.mjs` |
| What counts as a question is decided by keyword rules. In interview mode anything else waits for a background check that runs at most every 20 s. | `classifyTurn`, `consider` |
| No provider sets `confidence` on transcript rows. The engine stores the field and never reads it. | `ingest` in `core/engine.mjs` |
| If the model has not started within 6 s there is an error notice and no card. An explicit ask with no usable answer shows "I need more verified context to help with that." | `OpenAIProvider.generate`, `fallback` in `core/engine.mjs` |
| The newest card is appended at the bottom of a scrolling list. | `ui/components/coaching-feed.mjs` |
| Settings has a way back to the call, but it is a "Done" item at the end of the tab list. | `ui/views/meetings.mjs` (`localSettings`) |

---

## Group A: quick fixes

Small, safe, no new design. This group also closes every finding from the v0.4.1 test report that still applies to 0.5.8.

| Report finding | Status in 0.5.8 | Item |
|---|---|---|
| F1 End drops the final spoken turn | Appears fixed by the drain step. Not re-run. | A6 |
| F2 Electron 44.2.0 has published advisories | Still open. `npm audit` on the 0.5.8 lockfile flags `electron` (affected through 44.9.0) and suggests 44.11.3. | A5 |
| F3 Retried recap keeps a stale "carry" state | Old recap screen, not reached from the notebook flow. | A7 |
| F4 Saved call near 2 MB fails to reopen | Old saved-call path, same. | A7 |
| F5 Corrected transcript keeps the old promise | Still open. Reproduced: after replacing a final segment, `engine.commitments` still held the first text. | A3 |
| F6 Unsent input lost in four situations | Still open by code read. | A4 |

**A1. Stop cutting cues mid-thought.** `concise()` must never end on `;`, `,` or `:`. If the text is over the limit, cut at the last sentence end inside the limit; failing that, at a word boundary with no trailing punctuation and no ellipsis. Apply to leads too. Test with: "I'd surface conflicts early and agree on tradeoffs before committing; then I'd keep a weekly check-in with each owner so nothing drifts."

**A2. A clean question line.** Add `trigger.question`: only the question or request sentence(s) from the turn, with leading filler removed ("All right", "Okay", "um", "That's great."). Keep the raw turn in `trigger.text`. `classifyTurn` already walks sentences; reuse that. Test: "All right, 12nd. Okay, um. Tell me about a client result that you're proud of." gives "Tell me about a client result that you're proud of."

**A3. Clear stale promises (F5).** When a final segment replaces an earlier final with different text, drop every commitment derived from that segment id and derive again from the new text. Do the same for any other per-segment derived state. Tests: a promise becoming a refusal, a changed deadline, a promise becoming non-committal.

**A4. Keep unsent text (F6).** Hold these in view state and restore them after any screen change, re-render or failed command: the pasted-notes title and body, the Ask box text, the material name. Clear a draft only after its command succeeds or the user cancels. In the Ask handler (`ui/app.mjs`, case `ask-form`) do not clear the field before `command("ask")` resolves; on failure put the text back. This is logic in shared files and is yours.

**A5. Update Electron (F2).** Move from 44.2.0 to the newest patched 44.x that `npm audit` reports clean (44.11.3 at the time of writing). Stay on major 44. Do not run a blanket `npm audit fix`. Rerun the Linux smoke (`xvfb-run -a electron . --smoke --no-sandbox`), unit tests and UI checks. List any advisories that remain in build-only tooling in the checkpoint note with a one-line reason each.

**A6. Prove F1 is closed.** Add two tests against the 0.5.8 drain: (a) five seconds of voiced audio, then End with no trailing silence; (b) End while a committed segment is still waiting for its final transcript. In both, the last turn must be in the transcript, or a visible gap marker must say final words may be missing. If the drain times out today without a marker, add one.

**A7. Old screens (F3, F4).** `ui/views/ready.mjs`, `ui/views/recap.mjs`, the recap "carry" control and `sheet.load` are not reached from the notebook flow outside the sample call. Confirm that. If true, remove the dead paths and keep the sample call working. If any path is still reachable, fix it instead: one stable identity for a call's recap across retries, and a size check on a saved call before the current draft is cleared.

**A8. Settings while a call is finishing.** `close-settings` sends the user to Ready when status is `finishing`. It must return to the meeting for `running`, `paused` and `finishing`.

**A9. Where meetings live.** Add a command that returns the library folder path and one that reveals it in Finder. Claude will add a Settings row that explains the files are encrypted and that Export gives readable copies.

**A10. One version for every tester.** At checkpoint A, ask Matt to approve merging 0.5.x into `main`, then merge and update the README's version line, so reviewers stop testing October's build. Do not publish a public release; that stays Matt's call.

**A11. Ownership guard.** Add `scripts/check-ui-ownership.mjs` and run it in `.github/workflows/checks.yml` on pull requests. It fails when a branch whose name does not start with `claude/` changes `ui/views/**`, `ui/components/**`, `ui/index.html`, `ui/render.mjs` or any `.css` file. Print the offending paths.

Checkpoint A: post the test counts, the audit summary before and after, and the list from A7.

---

## Group B: an answer bank, and cards that appear on time

### B1. One format: the pack

Prep's output becomes a **pack**: the same structure whether Callwise builds it from Matt's files or an assistant hands it over (Group D). Schema in Appendix B. A pack holds the meeting, the points to land, stories, cards, facts, questions for them, gaps and optional tiles.

Store packs encrypted in the library with the same guarantees as other meeting content. A call uses one or more packs.

### B2. Prep reads everything

Replace the truncation in `prepPrompt`. Read every page of every file once, in bounded chunks, with the cheaper model extracting stories and facts with their source spans, then one merge step that writes cards. Show the existing cost estimate before a prep that exceeds a threshold you choose, and say so in the checkpoint.

Rules for card writing:

- `say` is one complete first-person sentence of at most 24 words. No hedges, no notes to self, no "I'd want to", no "I need to recall".
- `cues` are at most three, five words or fewer each, facts or names. Never instructions.
- Every card gets five to eight other phrasings of its question, used for matching.
- A missing detail never appears in a card. It becomes an entry in `gaps` with a question for Matt. A card with an open gap is still usable; the cue that depends on it is simply absent.
- One question maps to one story, with an optional backup story. Asking the same question again returns the same card.
- Never invent. Every story and fact carries its source.

### B3. Gaps and approval

Imported and freshly built cards start as `needs_review`. Commands (names in the contract): answer a gap, edit a card, approve a card, approve all. A gap answer is saved as Matt's own note with user provenance, and the affected card is rebuilt. Only approved cards are shown as prepared cards during a call, and one command approves them all. If a call starts with cards still waiting, do not show them as prepared; their stories and facts may still feed live cards (C1), which carry the `live` source. Expose the waiting count so the Ready screen can say so.

### B4. Matching by meaning, locally

On every partial and final row from the other speaker, match the last question-like sentence against the approved cards.

- Run locally. No network call per partial. Budget: 15 ms for 100 cards on Matt's Mac.
- Combine a lexical score (MiniSearch is already a dependency) over the card's phrasings with a sentence-similarity score. For sentence similarity, try an on-device option through the existing native helper first; if it does not meet the bar below, bundle a small local model. Record which you chose and why.
- Output per update: `{ cardId, score, margin, stableMs, questionComplete }`.
- Only when the turn has ended and the result sits in the middle band may you ask the fast model to choose among the top five candidates or "none". Budget 1.5 s. Cancel if the user starts talking.

Add `fixtures/match/eval.json`: at least 30 cards with six phrasings each, 40 off-bank questions and 20 near misses. Bar: correct card for at least 90% of on-bank phrasings, and no card for at least 95% of off-bank questions.

### B5. When the card appears

Matt is happy for a card to show while the other person is still talking, provided the app is fairly sure it is answering the real question. It must feel calm.

Confidence bands (starting values; tune on the eval set and record the final numbers in `docs/`):

- **High:** score at or above 0.80, margin over the runner-up at or above 0.15, same top card for 600 ms, and either a detected question sentence or five content words heard.
- **Middle:** score at or above 0.60.
- **None:** below that.

Rules:

1. **High, any time after the first second of their turn:** show the card now, marked `early`.
2. **Middle:** hold the card. Show it the moment the turn ends (final row received), with no extra wait. If the tie-break in B4 says "none", go to the surprise path in Group C.
3. **None at turn end:** surprise path.
4. An early card stays for at least 2.5 s before any change. At most one change per turn.
5. If the finished question matches a different card at High, swap once. If it only adds a second part ("and what would you do differently?"), keep the card and put the second card in `readyNext`.
6. Never swap the current card automatically while Matt is speaking (`userSpeechAt` is set). Queue it in `readyNext`.
7. Ignore acknowledgements at the start of a turn ("That's great.", "Okay, so"). `isBackchannel` and the filler stripping from A2 apply.
8. One preference, `earlyReveal`, default on. When off, rule 1 behaves like rule 2.

The fixed 1.4 s wait no longer applies to prepared cards. Keep a short end-of-turn pause only where you still need it to merge continued segments before starting a live request.

Add `fixtures/replay/interview-bank.json`: a pack plus timed partial and final rows, including a question with a twist at the end, a reworded question, an acknowledgement before the question, and an off-bank question. The replay asserts rule by rule.

### B6. Card output, version 3

Replace the `lead` and `points` card with the shape in the contract (`say`, `cues`, `source`, `proof`, `askBack`, `frame`). Keep adapters for the Codex and sample providers at the validation boundary as today.

Add a guard on anything about to be shown: if a cue reads like a note to self (for example "I need to recall", "I don't want to overstate", "add one specific"), drop the cue and log a gap. If `say` does, regenerate once with a stricter instruction; if it still does, fall back to the frame in C1. Unit-test the guard with the three cards from Matt's test, quoted in Appendix C.

### B7. Measure it

Extend `coaching.latency` with `matchedAt`, `revealedAt`, `turnEndedAt`, `source` and `revealLeadMs` (negative when the card appeared before they finished). Expose the last value and the median in the snapshot for the speed readout (E5).

Checkpoint B: post matcher results on the eval set, the replay output, and median reveal time in the replay.

---

## Group C: surprises

Matt wants the app to stay on top of questions that were not in the prep, without being asked.

### C1. The ladder

Work down this in order. Every card carries its `source`, which the screen shows as a tag.

| Step | When | What appears | `source` |
|---|---|---|---|
| 1 | High or middle match | The prepared card | `prepared` |
| 2 | Tie-break picks a card for a reworded question | The same card | `prepared_closest` |
| 3 | No match, and the pack's stories or facts cover it | At turn end, a frame at once (below). Then a live card written from the matching stories and facts, with sources. | `live` |
| 4 | No match, nothing on file | The frame stays, plus one question to ask back. No facts about Matt are invented. | `none` |
| 5 | A question about the other side | A fact card from the pack's `facts` where `about` is `them`. If connected search is allowed and consented, it may run; otherwise never. | `fact` |

**The frame** needs no model. Choose by question type: a past-experience question gives "Situation, your move, result"; an opinion or plan question gives "Your view, why, one example"; a challenge gives "Acknowledge, reframe, proof".

**Live cards** are written from the pack, not from raw excerpts: retrieve the top three stories and top five facts with the B4 matcher, and send those with their source text. Start the request as soon as a complete question is stable in the partials (the existing `completePartial` idea), keep the result hidden, and apply the B5 rules to show it. Target: the sentence is on screen within about two seconds of the question ending.

Remove the "I need more verified context" card. Step 4 replaces it.

### C2. Listen for meaning

`classifyTurn` misses challenges and objections that are not phrased as questions, and in interview mode they wait for the 20-second background check. Keep the rules as the fast path. For a final turn of eight or more words that the rules do not classify, ask the fast model for one label from `question`, `challenge`, `objection`, `small_talk`, `logistics`, `none`, within one second, under the existing rate limits. `question`, `challenge` and `objection` enter the ladder.

### C3. Predict the follow-up

After a card is shown and Matt starts answering, prepare up to three likely follow-up cards for that story in the background with the fast model, grounded in the same story. Add them to the matcher for this call only, with `source: live`. List them in `stage.readyNext`. Cancel unfinished work when the next question arrives. Count this against per-call limits and show it in the cost estimate.

### C4. Keep his story straight

Keep a per-call ledger of numbers and named claims from cards that were shown and from Matt's own final turns. Before showing a live card, compare it with the ledger and the pack. On a conflict for the same thing (for example 4.8 times and 3.8 times for the same client), prefer the pack's value and regenerate once; if it still conflicts, show the frame.

### C5. Know when it misheard

Providers do not set `confidence` today. Pass a confidence through from the speech engine if it offers one. Otherwise use signals you have: unknown tokens, a very short final turn, and a matcher score near zero for every card. When a turn looks misheard, set `stage.notice` to `heard_unclear` with the raw text and show no answer. If the next row clarifies, continue normally.

### C6. Never a blank

If the fast model has not produced a first token within 2.5 s, or fails, show the nearest prepared card when its score is at least the middle band, marked `prepared_closest` with `stage.notice` set to `model_slow`. Otherwise show the frame. An error banner alone is not acceptable during a call.

### C7. Learn from surprises

Record every turn that reached steps 3 to 5: the question, what was shown, and the transcript segment ids of Matt's answer. After the call, offer them as draft cards (`needs_review`), pre-filled from what he actually said. Nothing is added to a pack without his approval. Approved additions are available to future packs of the same call type.

Checkpoint C: post a replay that walks all five steps, the misheard case and the slow-model case.

---

## Group D: prep packs, the copyable prompt, and Claude

### D1. Importing a pack

Accept a pack as a folder, a `.zip`, or a single `pack.json`, by drag and drop on the Ready screen, through "Add files", or from a watched folder.

- Watched folder: one folder Matt chooses in a system dialog (suggest "Callwise Prep" in Documents). Off until he chooses. New packs are listed on Ready as waiting for review. Never delete or modify files there.
- Validate against the schema. Reject unknown top-level versions with a clear message.
- Limits: 2 MB of JSON, 200 cards, 40 tiles, 5 MB per image.
- Treat every field as untrusted data. Never fetch a URL from a pack. Render SVG tiles through an image element only, never inline.
- An imported pack never replaces approved cards silently. A second import with the same `id` shows as an update to review.
- If the pack's meeting time is within 12 hours of a calendar event with a similar title, offer to attach it. Only when calendar access has already been granted.

Older builds can still use a pack: `story-sheet.md` is plain material.

### D2. The copyable prompt

Ship Appendix A verbatim as `core/prep-prompt.md`. Add a command that copies it to the clipboard with the current pack schema appended. Claude will place a "Copy prep prompt" control on the Ready screen.

### D3. Claude Desktop and Codex, without copy and paste

The app already has a local connection for assistants (`desktop/meeting-mcp.mjs`, installed by "Connect Claude Desktop" and "Connect Codex"), with four read-only tools. Add:

| Tool | Kind | Purpose |
|---|---|---|
| `prep_guide` | read-only | Returns the prep prompt, the pack schema and today's date. |
| `prep_pack_list` | read-only | Titles, meeting times and review status of packs. No card text. |
| `prep_pack_save` | write, not destructive, idempotent by pack `id` | Validates and stores a pack as waiting for review. Returns the counts of cards and gaps. |

Gate the write tool behind a new setting, "Allow assistants to add prep packs", off by default and separate from "Allow assistants to read saved Callwise meetings". Mark annotations truthfully (`readOnlyHint: false` on the write tool). Keep the existing rule that only completed meetings whose notice allowed assistant access can be read. Bump the server version. Add tests beside `tests/meeting-mcp.test.mjs`.

With this in place Matt can say "prep my next call for Callwise" in Claude, and the pack arrives in the app for review.

### D4. Graphics

Tiles are data first: `proof` on a card (types in Appendix B) is drawn by the app. Images are optional extras in `tiles/`. Nothing is generated during a call unless Matt asks with a key press; that request goes to the existing Deeper advice lane and is out of scope for this round beyond leaving room for it.

Checkpoint D: post an import of the Appendix B example by all three routes and the new connection tests.

---

## Group E: extras Matt approved

**E1. Rehearsal mode.** A practice session using an approved pack. The app speaks each likely question (system speech), listens on the microphone only, and marks which cues Matt covered, reusing the coverage logic in `trackStructure`. No participant notice is needed because nobody else is on the line; label the session clearly as rehearsal, record nothing unless he keeps it, and never mix it into the meeting library by default.

**E2. Pre-flight check, kept out of the way.** No window and no dialog. Before a meeting that has a pack or a matching calendar event, a menu bar item shows one of two states: ready, or needs attention with the reason (microphone permission, call audio, key, no approved cards, open gaps). One notification five minutes before, only if something needs attention. Clicking opens Ready with that meeting selected. Use cached readiness (`desktop/readiness.mjs`); do not capture audio and do not make billed requests. Watching the calendar is a new behavior: put it behind a setting that is off by default, and update `docs/PRIVACY.md`, which currently says calendar reads require a deliberate action.

**E3. Questions for them.** Packs carry `questionsForThem`. On a wrap-up cue, including "do you have any questions for us", show them as a card. Cross out any that the conversation already answered, using the same coverage check on the other speaker's turns. Extend `isWrapUp` for the new phrasings.

**E4. After-call debrief.** Add to the saved meeting: promises Matt made (existing actions), surprises with "add to pack" (C7), which cards were shown, pinned or dismissed, and speed figures (B7). Data only; Claude lays it out.

**E5. Speed readout.** Reuse the `debug` preference, renamed in the interface by Claude to "Show speed readout". Provide the numbers in `stage.speed`.

Not in this round: an answer timer. Matt does not want one.

---

## The UI contract

Claude builds against this. Ship a JSON Schema at `core/ui-contract.schema.json`, validate every emitted snapshot against it in tests, and add one fixture per state under `fixtures/ui/stage/`.

```json
{
  "stage": {
    "phase": "idle | listening | held | early | final",
    "question": { "clean": "string", "raw": "string" },
    "current": "Card or null",
    "earlier": [{ "id": "string", "question": "string", "say": "string" }],
    "readyNext": [{ "id": "string", "question": "string" }],
    "notice": "null or { kind: heard_unclear | model_slow | offline, text: string }",
    "speed": { "lastRevealLeadMs": 0, "medianRevealMs": 0, "lastLiveMs": 0 }
  }
}
```

`Card`:

```json
{
  "id": "string",
  "source": "prepared | prepared_closest | live | none | fact",
  "say": "string, empty when frame is set",
  "frame": ["Situation", "Your move", "Result"],
  "cues": [{ "icon": "number | person | decision | caution | ask | time | money | place", "text": "string" }],
  "askBack": "string or null",
  "proof": "Tile or null",
  "sources": [{ "id": "string", "title": "string" }],
  "pinned": false,
  "createdAt": 0
}
```

`Tile` is one of: `number_bars`, `beats`, `scope`, `image` (Appendix B).

Also expose: `packs` (list with review status and counts), `bank` for the pack under review (cards, gaps), `rehearsal` state, `debrief`, `preflight`, the library path (A9), and `preferences.earlyReveal`.

Commands: `card.other` (switch to the backup story), `card.pin`, `card.dismiss`, `bank.gap.answer`, `bank.card.edit`, `bank.card.approve`, `bank.approveAll`, `pack.import`, `pack.remove`, `prep.copyPrompt`, `rehearsal.start`, `rehearsal.stop`, `library.reveal`. Add a default shortcut for `card.other` in `desktop/shortcuts.mjs`; Claude mirrors it in the Settings view.

Fixtures, one snapshot each: `listening`, `held`, `early`, `prepared`, `closest`, `frame`, `live`, `none`, `fact`, `unclear`, `model-slow`, `wrapup-questions`, `settings-midcall`, `review-cards`, `debrief`.

What Claude will build from this, for context only: the Stage screen (question, one sentence to say, up to three cue chips, a proof tile, a quiet side rail, newest card on top), card review, the pack inbox and prompt button, rehearsal, the debrief, and the Settings additions including a permanent "Back to call" bar.

---

## Done means

| Check | How |
|---|---|
| A prepared card is on screen within 0.5 s of the question ending, at the 90th percentile. | Replay with a stub model; then Matt's latency log on a real call. |
| With early reveal on, fewer than 2% of early cards are later swapped. At most one swap per turn. | Eval set and replay. |
| The same question asked five times gives the same card. | Replay. |
| No shown card contains a note to self or ends mid-sentence. | Guard tests with the Appendix C cards. |
| An off-bank question gets a frame at turn end and a live sentence in about two seconds. | Replay for the frame; real call for the sentence. |
| A slow or failed model still produces a card. | Provider stub that stalls. |
| Pressing End right after speaking keeps the last words. | A6. |
| Opening Settings mid-call keeps unsent text, and Done returns to the call. | A4, A8. |
| `npm audit` reports no high advisory for the runtime. | A5. |
| A pull request from a non-`claude/` branch that touches a protected UI path fails CI. | A11. |
| All existing tests still pass. | `npm test`, `npm run check`, `npm run test:ui`, `npm run test:meetings`. |

---

## Only Matt can check

- Microphone and call-audio capture, permissions and signing after the Electron update.
- Real reveal times and live-card times with his key and models.
- Card quality with his real material.
- "Connect Claude Desktop" with the new tools, and a pack arriving from Claude.
- Menu bar pre-flight and its single notification.

## Out of scope

- Any visual design by Codex.
- An answer timer.
- Gaze-correction or camera features.
- Generating images during a call.
- New cloud services. Everything new runs locally or through the providers Matt already configured.

---

## Appendix A: the prep prompt

Ship this text as `core/prep-prompt.md`. The copy command appends the schema from Appendix B.

```text
Prepare me for my next meeting and package the result for Callwise.

1. Find the meeting. Look at my calendar and pick my next upcoming meeting with other people. If you can't see my calendar, ask me for the title, time, people and purpose, then continue.

2. Gather what matters. Read the invite. Where you have access, read recent email and documents about this meeting, these people and their organisation, and look up the organisation's public basics. Use my own background files if you have them. If you don't, ask me once for my résumé or story notes.

3. Work out what will come up. List the 12 to 20 questions or topics most likely to be raised, and the 3 to 5 points I need to land.

4. Build the pack in the format below. Rules:
   - Use only facts from my materials or that I have told you. Never invent experience, numbers, names or results for me.
   - If a card needs a detail you can't find, such as a number or what I personally decided, leave it out of the card and add a question to "gaps".
   - "say" is one sentence I can say aloud in the first person: 24 words at most, no hedging, no notes to self.
   - "cues" are up to three reminders of five words or fewer. Facts or names, never instructions.
   - Give every card 5 to 8 other ways the question could be phrased.
   - Give a story one proof tile when it has a number, a before-and-after, or a clear scope.
   - Facts about the other side go in "facts", each with where you found it.
   - Add 4 to 6 good questions for me to ask them.

5. Deliver it. If a Callwise tool named prep_pack_save is available, call it with the pack. Otherwise create a folder named "<meeting title> - <YYYY-MM-DD>" containing pack.json, story-sheet.md (the same stories as readable text, under 60,000 characters) and a tiles folder for any images, and give it to me as a zip.

6. Finish with five lines: who, when, the points to land, how many cards, and the gaps you need me to fill.
```

## Appendix B: pack format, version 1

```json
{
  "callwisePack": 1,
  "id": "example-interview-2026-11-14",
  "createdBy": "Claude",
  "meeting": {
    "title": "Interview with Example Agency",
    "start": "2026-11-14T15:00:00-08:00",
    "type": "interview",
    "goal": "Show I can run several accounts and lead a team",
    "people": [{ "name": "Jordan Lee", "role": "Managing Director", "org": "Example Agency" }]
  },
  "points": ["Ran more than ten accounts at once", "Led a rebrand that grew revenue"],
  "stories": [
    {
      "id": "ojo",
      "title": "Ojo client acquisition",
      "result": "Client acquisition grew 4.8 times in two years",
      "numbers": [{ "label": "client acquisition", "value": "4.8×", "period": "two years" }],
      "sources": [{ "title": "Study guide", "locator": "page N", "quote": "client acquisition growing 4.8 times over two years" }]
    }
  ],
  "cards": [
    {
      "id": "proud-result",
      "kind": "story",
      "status": "needs_review",
      "questions": [
        "Tell me about a client result you're proud of.",
        "What's the win you'd lead with?",
        "Which result best shows what you can do?"
      ],
      "say": "One I'm proud of is Ojo: client acquisition grew 4.8 times in two years.",
      "cues": [{ "icon": "person", "text": "Credit the team" }],
      "storyId": "ojo",
      "backupStoryId": null,
      "proof": { "type": "number_bars", "value": "4.8×", "label": "Ojo, client acquisition, two years" }
    }
  ],
  "facts": [
    { "id": "f1", "about": "them", "text": "Example Agency opened a second office in 2025.", "source": { "title": "Company site", "url": "https://example.com/about" } }
  ],
  "questionsForThem": ["What does a strong first 90 days look like in this role?"],
  "gaps": [{ "id": "g1", "storyId": "ojo", "ask": "What did you personally decide on Ojo?" }],
  "glossary": ["Ojo", "CNV"],
  "tiles": [{ "id": "t1", "file": "tiles/ojo.svg", "alt": "Ojo acquisition before and after" }]
}
```

Field notes:

- `kind`: `story`, `view`, `fact` or `logistics`.
- `status`: `needs_review` or `approved`. Imports always arrive as `needs_review`.
- `cues[].icon`: one of `number`, `person`, `decision`, `caution`, `ask`, `time`, `money`, `place`.
- `proof.type`: `number_bars` (`value`, `label`, optional `before` and `after`), `beats` (`title`, `beats` of `label`, `text`, optional `highlight`), `scope` (`title`, `stats` of `value` and `label`), `image` (`tileId`).
- `story-sheet.md` and `tiles/` are optional. `sources/` may hold original files.
- The example's company, person, fact and page locator are placeholders. The Ojo figures are Matt's.

## Appendix C: the three cards from Matt's test

Use these as guard fixtures (B6). Each was shown as a quick answer on 12 November.

1. Lead: "I'm proud of the Sessions Retreat rebrand I led; revenue grew 2.3 times in one year." Cues: "My role — I led the rebrand; I don't want to overstate what drove the result." and "Recall — Add one specific decision you made and how the team measured revenue growth."
2. Lead: "One result I'm proud of is Ojo's client acquisition growing 4.8 times over two years, though I'd want to be precise about my role." Cues: "My part — I don't want to overstate it; I need to recall the specific decisions I owned." and "Context — I'd explain the baseline, how acquisition was measured, and who else contributed."
3. Lead: "I manage several clients by getting clear on priorities, owners and what each client needs next." Cues: "Scope — At CNV, I handled 10-plus concurrent accounts and coordinated a bench of about 20 specialists." and "Approach — I'd surface conflicts early and agree on tradeoffs before committing;"

Cards 1 and 2 answered the same question on two tries with different stories. Card 3's second cue ends on a semicolon.

## Appendix D: Matt's notes, and where each one landed

| Note | Item |
|---|---|
| Cards take too long; anticipate the question; swap at the right moment | B4, B5, B7 |
| A decision model with pre-made cards | B1 to B4 |
| Fine for the card to show while they are still talking, if fairly sure | B5 |
| Stay on top of surprises automatically | Group C |
| Answers that did not make sense or confused him | B2, B6, A1, A2 |
| Use most of the screen, call window small; question bigger; less header; nicer look | Claude, from the contract |
| Silent cues look like the line to say; make cues visual | Contract (`cues` with icons), Claude |
| Settings mid-call has no obvious way back | A4, A8, Claude |
| Where transcripts and audio live | A9 |
| Illustrations and graphs made before the call | B1 (`proof`), D4 |
| A prompt to copy, a pack from the calendar, tight link with Claude | Group D |
| Page 11 of the approval PDF (the test report) | Group A |
| Page 12: rehearsal, pre-flight kept minimal, questions for them, debrief, speed readout, one version | E1 to E5, A10 |
| No answer timer | Out of scope |
| Codex should not design the interface | "Who builds what", A11 |
