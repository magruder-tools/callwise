# Independent source review request

Review the full `local-meetings` pull request against `main`. The packaged implementation is commit `23201dfb262519fd3906f54b7857f85f7719d70a`; later documentation commits do not change runtime code. Review actual source and relevant tests, not just the build report.

Start with [START_HERE.md](START_HERE.md), [BUILD_REPORT.md](BUILD_REPORT.md), and the archived [IMPLEMENTATION_PLAN.txt](IMPLEMENTATION_PLAN.txt). The build report describes evidence-driven deviations from the plan.

Prioritize concrete defects in participant notice/capture gating; audio sample timestamps, draining and recovery; encryption/key preservation/backups; canonical notes, autosave and late-job edit guards; recording/playback; speaker mapping; Apple export idempotency and destinations; read-only MCP/access-off behavior; and packaging/permissions. Preserve the eight newer local fixes included in this branch.

For each actionable finding, give severity, exact file and line, reproduction/trigger, practical impact, and a proposed fix. Distinguish defects from improvements and from the already documented unverified real-device checks. State exactly which tests were run and any execution/access limits.

Save the review as a GitHub pull-request review/comment or add `docs/reviews/0.5.0/CLAUDE_REVIEW.md` on a review branch and open a pull request. If writing to GitHub is unavailable, return a Markdown review for the user to relay to ChatGPT. The Mac workspace tools and Apple Notes are not required for this review.

Reading or writing a saved handoff does not mean the review occurred. The user starts Claude's turn; ChatGPT resolves the recorded findings afterward.
