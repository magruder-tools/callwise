## Built by brief item

“Done” here means implemented and checked with synthetic data. No real-call performance is claimed. No feature was left behind a new off-by-default experimental flag; the required assistant-write, calendar-watch and pre-flight preferences remain off by default.

| Item | Status | Result |
|---|---|---|
| B1 | **done** | Version 1 pack validation; packs and image records use the existing authenticated, encrypted library and backup path. |
| B2 | **done** | All imported text is read in 8,000-character, non-overlapping sections. The fast provider extracts evidence; one strategy merge writes cards. Literal quotes are verified and resolved to exact source spans. Estimated prep above $0.25 requires confirmation. |
| B3 | **done** | Review inbox, editable sentences/cues/phrasings, gap answers with user provenance, targeted rebuilds and individual/bulk approval. Same-ID updates keep the approved copy in use until a revision is approved. |
| B4 | **done** | MiniSearch plus the bundled, offline BGE sentence model. The expanded 30-card evaluation passes the specified aggregate bars; detailed and novel-paraphrase results are below. |
| B5 | **done** | 600 ms stability, first-second early gate, immediate final middle-band reveal, 2.5-second early hold, one story swap, compound-question queue and protection after the user starts answering. Early reveal defaults on. |
| B6 | **done** | Version 3 cards, source labels, complete first-person opening sentence, factual short cues, self-note guard and one regeneration before a frame. Production explicit-help adapters and Codex output schemas also use the guard. |
| B7 | **done** | Matched/revealed/turn-ended times, source and signed reveal lead time in coaching.latency; stage.speed exposes the latest and median figures. |
| C1 | **done** | Prepared, closest, grounded live, no-source frame and fact paths. Live requests contain at most three selected stories and five facts with their source text. |
| C2 | **done** | Local rules and approved-card matches are immediate; otherwise eligible unclassified finals use a bounded one-second meaning label under the shared call limits. |
| C3 | **done** | Up to three grounded follow-ups enter the call-only matcher and ready-next list. New questions cancel unfinished prediction; usage is counted. |
| C4 | **done** | Per-call numeric and named-claim ledger, metric/value checks, pack authority and a single regeneration before frame fallback. |
| C5 | **done** | Speech confidence is retained when provided. Unclear-token, short-turn and match signals can suppress an answer and expose the raw words; clarification resumes normally. |
| C6 | **done** | A 2.5-second first-token stall or provider failure keeps a useful frame or closest prepared answer and a model_slow notice. |
| C7 | **done** | Surprises retain the actual own-answer segment IDs. Add to pack creates a sourced draft requiring review; later answers to other questions do not leak into that draft. |
| D1 | **done** | JSON, folder and zip imports through drop/Add files/pack chooser; read-only watched folder; limits, version errors, safe image handling and reviewable updates. Calendar matches use previously granted access only. |
| D2 | **done** | Appendix A is shipped verbatim and copied with the pack schema. |
| D3 | **done** | prep_guide, metadata-only prep_pack_list and idempotent prep_pack_save; write annotation is truthful and the independent write preference defaults off. Completed-meeting read consent is preserved. |
| D4 | **done** | Data proof tiles plus self-contained image tiles. SVG is an image element, never inline markup. No pack URL is fetched. |
| E1 | **done** | System-speech, microphone-only rehearsal with cue coverage, Next/Repeat/Stop and results. No saved meeting or recording is created by default. |
| E2 | **done** | Menu-bar-only cached pre-flight; optional calendar watching defaults off. At most one attention notification per meeting is recorded across restarts; no capture or billed request is made. |
| E3 | **done** | Wrap-up cues show unanswered questions as prepared ask cues, with all remaining questions available to the screen. |
| E4 | **done** | Saved meeting detail contains own promises, surprises, shown/pinned/dismissed cards and speed figures. |
| E5 | **done** | The existing debug switch is exposed as Show speed readout and the numbers are in stage.speed. Drawing the Stage readout remains Claude's pass, as specified in the finish brief. |
| Screens | **done** | Plain functional inbox/review, rehearsal, saved debrief and Prep settings. Nineteen contract fixtures, 76 four-width screenshots, 44 px targets and edit-preservation checks pass. |
| Icon | **done** | The existing four-bar mark now uses the protected theme's light and indigo colors; SVG, PNG and macOS ICNS are rebuilt. |
| Release verification | **not done** | Code/browser/model/library checks and signing pass. The signed native-window smoke, installation and on-screen About version/icon verification pass. Pull-request Linux CI is being corrected for an asynchronous Resume-control race. |

## Measured results

- Selected model: `Xenova/bge-small-en-v1.5 int8 (bundled, offline) (live)`. The Apple NLEmbedding experiment returned 86.7% aggregate on-bank accuracy on the expanded set, so it was not selected.
- Thirty cards, six indexed phrasings each, six held-out wrapper variants each, and thirty additional hand-written paraphrases: **201/210 (95.7%)** on-bank. The additional novel paraphrases score **21/30 (70%)**; the aggregate result is not a claim of general real-world accuracy.
- Off-bank rejection: **39/40 (97.5%)**. Near-miss rejection: **19/20 (95%)**.
- Actual bundled-model inference on this Mac, 100-card index: median **1.45 ms**, p90 **1.64 ms**, maximum **5.52 ms** in the recorded run. Frozen-vector CI timing is not a native inference benchmark.
- Confidence bands remain high **0.80**, runner-up margin **0.15**, middle **0.60**, stable **600 ms**. Lexical/sentence contributions are 25%/75%. Polite request wrappers are removed for matching, while display text retains the question.
- Timing replay: virtual clock, deterministic matcher bands and provider stubs; this is a state-machine test, not a recording or paid provider measurement. Prepared p90 reveal **-600 ms**, median **-600 ms** relative to the final row. **1/103 (0.97%)** early story swaps across the deliberate twist and stable repetitions. At most one story swap per turn. The stub live sentence appears at **1,800 ms**; all five ladder paths, unclear speech and a stalled provider are exercised.
- Final full test suite: **442 passing, zero failures**. Syntax checks cover **185 modules**. Both browser suites pass. The replay has eight explicit timing/behavior checks, all five ladder paths, unclear speech and a stalled provider.
- Renderer: **19 states × 4 widths = 76 screenshots**, at 400/640/980/1280 px, with no horizontal overflow and 44 px controls.
- Runtime audit: **zero advisories**, including zero high or critical findings.
- Signed app's actual offline-model worker/native library and encrypted SQLite/backup/restore checks pass with disposable data. Native-window smoke passes with all 40 native presses. The installed About window shows 0.6.0 and the new icon; 0.5.9 is retained at `/Applications/.Callwise-0.5.9-rollback-round3.app`.
- CI: [draft PR #10](https://github.com/magruder-tools/callwise/pull/10) targets `codex/fix-meeting-setup-scrolling`. Its first [Linux run](https://github.com/magruder-tools/callwise/actions/runs/43476201458) reached the panel test and failed during an immediate renderer action. The smoke now waits for the paused Resume control before clicking and includes the failed expression in diagnostics. The original screenshot check is retained; captures settle for two frames and retry a transient UnknownVizError exactly once.

## Decisions

- Keep `codex/round-3-finish` based on exact `2a80b51`; preserve Group A and Claude's authored Stage history, leave PRs #8/#9 open and leave `main` unchanged. No release is published.
- Preserve every protected Stage/theme/common/card/render file byte for byte. The ownership guard permits only the named new screens, the three entry points and one stylesheet link on this exact branch; inherited Claude files must match their known baseline bytes.
- Reuse encrypted docs records for packs, keeping the existing key, record authentication, backup format and rollback compatibility. Store each optional image in its own encrypted record so a 5 MB image stays below the backup-frame limit.
- Imports always require review. A same-ID import is idempotent when identical and becomes a pending revision when changed; an approved copy remains available.
- Read all supplied extracted text, with no silent trimming at merge time. Resolve a unique exact quote to its character span if the model miscounts offsets; reject invented or ambiguous quotes. Oversized evidence fails visibly rather than dropping pages.
- Use the existing configured providers for preparation; never use the sample provider for a real imported pack. Codex receives the requested structured-output schema. The $0.25 gate uses editable existing estimated prices, not a billing promise.
- Bundle the verified 34 MB BGE int8 model and tokenizer at build time; no runtime download or remote embedding fallback exists. Run inference in a worker with one CPU thread.
- Treat a frame filling with its grounded sentence as refinement of the same answer, not a second story swap. Early story changes retain the 2.5-second hold. Explicit user card selection/pinning/dismissal is preserved.
- Retain the existing live-help opt-in and participant-notice flow. Rehearsal is separate, microphone-only and unsaved; pre-flight never captures or contacts a model.
- Keep limits of 2 MB JSON, 200 cards, 40 tiles and 5 MB per image, plus a 50 MB compressed/expanded zip cap and bounded archive entries. Source files in a watched folder are never modified. Missing optional tile files are omitted; data proof tiles still work.
- Read calendar metadata on deliberate import/selection only with existing access; background reads require the separate calendar-watching preference. Persist only notification-key hashes in encrypted readiness data to prevent repeat alerts after restart.
- Keep UI additions functional and token-based. Add image/unclear/early/wrap-up supplements in shared integration code so the protected Stage component remains unchanged.
- Keep the original waveform geometry and recolor native vector assets directly to the existing palette.
- Preserve the established root and helper signing identities and keep the previous app for rollback. No real meeting is ended without a new explicit instruction.

## Claude design handoff

Screenshots: `artifacts/browser/round3/`. Fixtures and their screen mappings: `fixtures/ui/index.json`. New UI files are `ui/views/bank.mjs`, `ui/views/rehearsal.mjs`, `ui/components/pack-inbox.mjs`, `ui/components/debrief.mjs`, `ui/components/round3-settings.mjs`, `ui/round3.mjs` and `ui/round3.css`. Keep the exact stage/Card/bank/rehearsal/preflight command and field names.

The Stage readout can now use `stage.speed`; the visual readout remains yours. The existing Stage does not draw image tiles or all wrap-up cues itself, so shared integration adds safe image elements and the remaining questions. Keep the raw-unclear and Early indicators when refining that integration.

There were **no merge conflicts** to resolve from the integrated 0.5.9 starting point. Shared logic was kept in `ui/app.mjs` and `ui/meetings.mjs`; the three existing view files only gain entry points. Keep the Group A draft IDs and close-settings action intact.

## Checks only Matt can make

- Actual reveal times, live-provider times and card quality in a real call with his material and configured models.
- Microphone and call-audio permissions after the installed update, without disrupting an active meeting.
- A pack arriving from an actual Claude Desktop/Codex connection and the value of the prepared questions.
- The pre-flight item and its single attention notification with a real calendar event.

All recorded matcher questions, replays, browser states, package-library tests and smoke input are synthetic.
