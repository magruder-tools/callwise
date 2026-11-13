# Callwise round 3, finish in one run

A brief for Codex, 12 November 2026. Put it at `docs/CALLWISE_ROUND_3_FINISH.md`.

`docs/CALLWISE_ROUND_3.md` is still the specification: Groups B to E, the UI contract, and appendices A to D. This file changes how the work is run and fills in the data shapes that brief left loose. Where the two disagree, this file wins.

## What changes from the round 3 brief

1. **No checkpoints.** Build Groups B, C, D and E in one run without stopping for review. Stop only for the reasons in "Stop and ask".
2. **One pull request.** Branch `codex/round-3-finish` from `codex/round-3-install-preview` at `2a80b51` (0.5.9: Group A plus Claude's Stage UI). Open one pull request into `codex/fix-meeting-setup-scrolling`. Do not merge PRs #8 or #9 and do not touch `main`. Item A10, merging into `main`, stays with Matt.
3. **Screens.** Codex may now build the screens these features need, under the rules in "Screens" below. Claude does a design pass on the pull request afterwards.
4. **Version.** Ship as 0.6.0.

## Starting point (0.5.9)

Done and installed on Matt's Mac:

- Group A: drafts kept, stale promises cleared, End drains, Electron 44.11.3, `trigger.question`, `libraryPath` and `library.path` / `library.reveal`, the ownership guard.
- Claude's Stage: the light theme, the Stage screen, and the Back to call bar. Its files are protected (list under "Screens").

Not built: everything in Groups B to E. The engine does not yet emit `stage`, so the Stage is using its fallback for the older card shape.

Open CI issue: the Linux pull-request smoke fails with `UnknownVizError` during screenshot capture (run 43346952199). It passed on push. Make it reliable as part of this run, for example by retrying the capture once or capturing after a settle wait. Do not delete the check.

## Build order inside the run

Work in this order so each part rests on a tested one, but do not pause between them:

1. **B1 to B3:** the pack format, encrypted storage, prep that reads everything, gaps and approval.
2. **B4 and the match eval set:** local matching. Meet the bar (90% on-bank, 95% off-bank correct) before building on it.
3. **B5 to B7 and the `stage` snapshot:** reveal timing, the version 3 card with its safeguard, and latency fields. From here the Stage leaves its fallback.
4. **Group C:** the ladder, meaning labels, follow-ups, claim ledger, misheard detection, slow-model fallback and learning from answers.
5. **Group D:** pack import, the watched folder, the prep prompt, and assistant tools.
6. **Group E:** rehearsal, the pre-flight menu bar item, questions for them, the debrief and speed data. No answer timer.
7. **Screens** for everything above.
8. **The full check list, then package and install.**

If a part cannot meet its bar, finish the rest. Leave that part behind a preference that is off by default, and explain it in the report.

## Data shapes the screens use

The `stage` and `Card` shapes are exactly as in "The UI contract" of the round 3 brief. Do not rename fields. Add these to the snapshot and validate them in `core/ui-contract.schema.json`:

```json
{
  "packs": [{
    "id": "string", "title": "string", "meetingStart": "ISO string or null", "type": "interview | sales | client | other",
    "status": "needs_review | approved | partly_approved", "cards": 0, "approved": 0, "gaps": 0,
    "origin": "prep | import | assistant | watched_folder", "updatedAt": 0, "attachedMeetingId": "string or null"
  }],
  "bank": {
    "packId": "string",
    "cards": [{ "id": "string", "status": "needs_review | approved", "question": "string", "phrasings": ["string"],
                "say": "string", "cues": [{ "icon": "string", "text": "string" }], "proof": "Tile or null",
                "storyTitle": "string or null", "openGapIds": ["string"] }],
    "gaps": [{ "id": "string", "ask": "string", "storyTitle": "string or null", "answer": "string or null" }],
    "rebuilding": ["card id"]
  },
  "prepPrompt": { "available": true },
  "watchFolder": { "path": "string or null", "enabled": false },
  "rehearsal": {
    "status": "idle | asking | listening | between | done", "packId": "string or null",
    "index": 0, "total": 0, "question": "string or null",
    "cues": [{ "text": "string", "covered": false }], "results": [{ "question": "string", "covered": 0, "total": 0 }]
  },
  "debrief": {
    "meetingId": "string",
    "promises": [{ "id": "string", "who": "string", "what": "string", "due": "string or null" }],
    "surprises": [{ "id": "string", "question": "string", "shown": "string", "draftCardId": "string or null", "added": false }],
    "cardsShown": [{ "id": "string", "question": "string", "source": "string", "pinned": false, "dismissed": false }],
    "speed": { "medianRevealMs": 0, "medianLiveMs": 0, "earlyReveals": 0, "swaps": 0 }
  },
  "preflight": { "state": "off | ready | attention", "meetingTitle": "string or null", "startsAt": "ISO string or null", "reasons": ["string"] }
}
```

`debrief` is per saved meeting: put it in the meeting detail the notebook already loads, not in the live snapshot.

New commands, beyond those in the round 3 contract: `bank.open` `{packId}`, `bank.close`, `bank.phrasing.add` / `bank.phrasing.remove`, `pack.attach` `{packId, meetingId}`, `watchFolder.choose`, `watchFolder.disable`, `debrief.surprise.add` `{surpriseId}`, `preflight.open`.

## Screens

Matt does not want new visual design from Codex. Build plain, functional screens that reuse what exists, and Claude will refine them.

**Do not modify these files** (Claude's): `ui/components/stage.mjs`, `ui/stage.css`, `ui/tokens.css`, `ui/app.css`, `ui/meetings.css`, `ui/index.html` (except one `<link>` line for the new stylesheet), `ui/render.mjs`, `ui/components/common.mjs`, `ui/components/card.mjs`.

**You may:**

- Add new files under `ui/views/` and `ui/components/` for the new screens: card review and pack inbox, rehearsal, the debrief section, and new Settings sections.
- Make minimal edits to `ui/views/meetings.mjs`, `ui/views/ready.mjs` and `ui/views/settings.mjs` to add an entry point (a button, a tab, a section) to the new screens.
- Add one stylesheet, `ui/round3.css`, and link it after `stage.css`. Use only the variables in `ui/tokens.css`. Do not add new colors, fonts, shadows, gradients or font sizes. Reuse the Stage classes (`stage-card`, `stage-label`, `cues`, `cue`, `stage-tag`, `proof`, `rail-title`, `earlier-item`) and the existing `button`, `primary`, `text-button`, `segmented` and `banner` styles.
- Update `scripts/check-ui-ownership.mjs` to allow exactly the above for branch `codex/round-3-finish`, and nothing else.

**Each screen must:**

- Have real buttons, labels and inputs (keyboard reachable).
- Keep 44px minimum targets.
- Have no horizontal overflow at 400, 640, 980 and 1280px.
- Have a fixture under `fixtures/ui/` and a browser check that screenshots it at those widths into `artifacts/browser/round3/`.

**What each screen does:**

- **Ready screen.**
  - "Copy prep prompt" button.
  - Pack inbox: list of `packs` with status, counts, Review and Remove.
  - Drop zone for packs.
  - Watched folder status.
  - When cards are waiting, one line saying so.
- **Card review** (`bank`). One card per row, showing:
  - the question and phrasing count
  - the `say` sentence and cues
  - the gaps it needs, with an answer field each
  - Edit, Approve, and Approve all
  - a rebuilding state while a gap answer is applied
- **Rehearsal.**
  - The question, large.
  - The cues as chips that tick when covered.
  - Next, Repeat and Stop.
  - A results list at the end.
  - Clearly labelled as rehearsal, not recorded.
- **Debrief**, in the saved meeting's Notes and recap:
  - promises
  - surprises with "Add to pack"
  - cards shown
  - speed figures
- **Settings.**
  - "Where your meetings are stored", showing the path with Show in Finder.
  - "Allow assistants to add prep packs".
  - Watched folder.
  - Pre-flight and calendar watching, off by default.
  - "Show cards before they finish asking" (`earlyReveal`).
  - "Show speed readout".
- **Pre-flight.** Menu bar only (native, yours). No window, no dialog. At most one notification, and only when something needs attention.

**Two Stage behaviours** need no Stage edits from you:

- **Questions for them:** emit them as `stage.current` with `source: "prepared"`, an empty `say`, and the questions as `cues` with icon `ask`. Answered ones are omitted.
- **Speed figures:** put them in `stage.speed`. Claude will draw the readout.

## Keep these

Everything in "Keep these" in the round 3 brief, plus:

- Group A behaviour and its tests.
- The draft field IDs `material-title`, `material-text` and `question`.
- The `close-settings` action used by both Done and Back to call.

## Stop and ask

Stop and ask Matt only for:

- An action that cannot be undone on his Mac or in GitHub. This includes ending a live meeting, deleting meeting data, merging into `main`, and publishing a release.
- A change to the participant-notice flow or to what leaves the Mac.
- A new paid service or API key.

Everything else, decide, record the decision in the report, and keep going.

## Done means

The pull request is not done until all of these hold.

- Every row in "Done means" of the round 3 brief, measured with replays, stubs and the eval set.
- `fixtures/match/eval.json` meets the matching bar, with the confidence band values used recorded in `docs/`.
- `fixtures/replay/interview-bank.json` passes rule by rule, and the replay walks all five ladder steps, the misheard case and the slow-model case.
- An import of the Appendix B example works by all three routes: drop, watched folder and `prep_pack_save`.
- Every snapshot validates against `core/ui-contract.schema.json`, with one fixture per state listed in the round 3 contract plus the new screens.
- The suites pass: `npm test`, `npm run check`, `npm run test:ui`, `npm run test:meetings`, and the ownership guard.
- GitHub CI passes on the pull request, including the Linux smoke.
- The signed 0.6.0 build passes the packaged Mac smoke and is installed, with the previous app kept for rollback and signing identities unchanged.

## Report

Write `docs/ROUND_3_FINISH_REPORT.md` and put its first section in the pull request description:

1. What was built, by brief item, marked **done**, **behind a flag** or **not done**, with the reason for anything not done.
2. Measured results: matcher scores, replay reveal times, test counts, CI links.
3. Every decision you made in place of asking, one line each.
4. The screenshot folder for Claude's design pass.
5. What only Matt can check on a real call: real reveal and live-card times, card quality with his material, packs arriving from Claude, and the pre-flight menu bar item.

Do not describe a feature as working on real calls unless it was tested on one.
