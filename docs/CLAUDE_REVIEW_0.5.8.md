# Callwise 0.5.8 review handoff

Review pull request https://github.com/magruder-tools/callwise/pull/7 on branch `codex/fix-meeting-setup-scrolling`. The default branch and the older published release do not contain this complete version. This is a draft for analysis, not an approved merge or public release.

## Source coverage

This branch combines the current coaching changes with the previously local recording archive implementation used by the installed Mac app. It includes the JavaScript application, Swift archive helper source, and archive tests. Private settings, API keys, signing credentials, recordings, and interview materials are not part of the source handoff.

The changed runtime modules were compared with the source packaged for the installed 0.5.8 app. The local native helper and the installed signed helper have identical contents in all 42 loadable Mach-O sections; their whole-file hashes differ because of signing. The app version was verified as 0.5.8.

## Changes to examine

- The main notebook owns a Coaching tab. The floating window opens only on request. Earlier questions and answers stay in a chronological history; new answers follow at the bottom, while scrolling back preserves the reading position. Quick answers use a complete lead sentence and large bold cue bullets. Notes and transcript tabs remain available.
- Automatic coaching waits for finalized speech plus a 1.4-second quiet gap and combines continued segments. Partial speech does not start a reply. Manual quick and deeper help remain immediate. Review cancellation, discarded partials, backchannels, and speaker changes carefully.
- Automatic model selection chooses stable, account-visible Luna and Sol aliases by numeric version before a new call, then keeps the choice fixed during that call. Current models are GPT-6 Luna and GPT-6.1 Sol. Custom model edits disable automatic selection. Offline metadata checks retain the saved selection and expose a notice.
- Fast processing is an explicit connection setting. It is passed to both OpenAI coaching lanes and auxiliary preparation requests. The default is Standard until the user chooses Fast. Setup test results display the actual response tier. Estimates apply current prices and the Fast multiplier; they are not a billing report or a future pricing guarantee.
- Finished-meeting iCloud export is opt-in and handled by the app and native helper. It exports portable recordings and transcript/notes files, verifies upload and file hashes, and retains original audio until verified iCloud upload and cache offload. Review retention, interrupted exports, cancellation, deletion races, and provider metadata carefully. Legacy Google Drive archive code remains present but automatic Drive uploading is disabled at boot.

## Validation already performed

- All 370 local JavaScript tests passed, including routing, turn timing, history preservation, and archive tests.
- Syntax and desktop metadata checks passed for 149 JavaScript modules.
- Coaching layout checks passed at 980 by 740, 1280 by 800, 640 by 620, and 400 by 600: controls remained reachable, bold cue type remained readable, there was no horizontal overflow, and appending a card preserved a reader's earlier scroll position.
- Live setup requests returned GPT-6 Luna with Fast processing and GPT-6.1 Sol with Fast processing. Tiny test replies took roughly 1.1 and 2.0 seconds. These are setup checks, not real-call latency benchmarks.

Run the repository's normal `npm test` and `npm run check` commands for an independent check. Browser checks are available through `npm run test:ui` and `npm run test:meetings`; `CALLWISE_BROWSER_BIN` can select an installed Chromium browser where supported by the script.

## Limits for the review

The revised turn timing and reading experience still need a fresh real conversation. Synthetic checks do not establish end-of-turn accuracy, coaching quality, or real iCloud upload reliability. Callwise does not automatically inherit all ChatGPT/Codex plugin permissions or automatically research every email/Drive folder. Model selection can discover newer family aliases, but future API compatibility and prices still require validation.

Report concrete bugs, regressions, and missing coverage before proposing a merge. Do not assume that a draft PR or the installed app has been approved for release.
