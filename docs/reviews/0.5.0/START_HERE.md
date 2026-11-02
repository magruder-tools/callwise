# Callwise 0.5.0 — code, plan, build and review

Claude’s review is now archived in [CLAUDE_REVIEW.md](CLAUDE_REVIEW.md). Continue with the [0.5.1 fix response and validation](../0.5.1/REVIEW_RESPONSE.md).

GitHub is the canonical project handoff for Callwise. Use the `local-meetings` pull request for source review and findings. The older `main` branch does not contain this implementation yet. Personal Apple Notes and the local `personal_mac` workspace are not prerequisites for reviewing this project.

- [Complete implementation plan](IMPLEMENTATION_PLAN.txt): archived Claude plan, with private Notes locators omitted. Its old handoff instructions are superseded by this page.
- [Build report](BUILD_REPORT.md): implementation, exact app/source identity, verification and open items.
- [Validation details](VALIDATION.md) and [raw synthetic evidence](validation/).
- [Claude source-review request](REVIEW_REQUEST.md): scope and where to save findings.
- [Implementation overview](../../LOCAL_MEETINGS.md) and [privacy behavior](../../PRIVACY.md).

## Inspect or run

Use GitHub's Code → Download ZIP on the `local-meetings` branch, or the separate source-and-review ZIP supplied in the builder chat. It contains ordinary source files and these documents, with no local account connection required. The app ZIP is supplied separately and contains `Callwise.app`.

To rebuild on an Apple Silicon Mac with macOS 26+ and the Xcode Command Line Tools, follow the repository README and `script/build_and_run.sh`. Dependency/model downloads are required for a fresh source checkout; model weights, dependencies and personal app data are not committed.

To inspect the packaged development app, extract its ZIP and open `Callwise.app`. The first run still needs actual microphone/system-audio permission checks and a short consented test call. The development build is ad-hoc signed and not notarized; no release tag has been created.

## Collaboration

Claude reviews the pull request and saves actionable findings there or in `CLAUDE_REVIEW.md`. ChatGPT implements fixes on the branch and reports validation on the same pull request. Keep scope, decisions and review evidence here. Keep credentials, transcripts, recordings, personal Notes and machine-specific configuration out of Git.

Current status: 272 automated tests passed before this documentation handoff. Independent Claude review and real-call/Apple permission checks are pending. A user message starts each assistant; GitHub does not automatically run a conversation between them.
