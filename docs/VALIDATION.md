# Validation

0.4.0 implements the remaining milestones from `CALLWISE_BRIEF.md` on top of the reliability work recorded in `CHECKPOINT_1.md`.

Automated verification uses the real controller/engine with offline providers, fake Realtime sockets, encrypted-storage substitutes and rendered DOM. Replays cover interview, discovery and client calls, including own speech, backchannels, repeats and partial questions. The stub measures trigger/engine first paint only, not live network or transcription performance. It does not establish model answer quality.

The Mac workflow runs syntax, tests, production dependency audit, native Electron smoke, DMG/ZIP packaging, signature verification, bundled Codex verification and actual packaged-app smoke. Screenshots cover Ready, Recap and the live panel at 340, 440 and 640 px widths. CI checks that essential lead/point text is present and not clipped. It uses synthetic data, no permissions, audio or credentials.

`npm run test:ui` uses Playwright against the shipped renderer with synthetic snapshots. Ready is checked at 720 × 560; Live at 340 × 240 (a short card), 440 × 320 (a full 16-word lead and three 12-word points), and 640 × 480. It verifies visible controls, horizontal overflow and the 12 px minimum type size, and saves screenshots for inspection. The default live size passed locally without scrolling. The narrower native panel grows when a full card needs more room.

## Checks that need your Mac/account

- Run the in-app API, microphone and call-audio tests; exercise a wrong key, revoked permission and muted output.
- Install the app, test the floating panel over full-screen Zoom/Meet/FaceTime and confirm keyboard focus stays in the meeting.
- Change the microphone and output device while listening; verify fallback/reacquisition and transcript continuity.
- With the same persistent signing identity, install build N then N+1 over it and check permission continuity.
- Use `npm run replay -- --live --compare` with a private API key to compare the two fast models. Targets: median first paint ≤2 seconds, p90 ≤4 seconds; evaluate factual correctness as well as timing. The app does not claim those targets have been measured here.
- Spot-check preparation and recap against your original evidence. Citation IDs and recorded commitments are validated in code; factual prose still needs ordinary human review.

No API key or signing certificate was supplied to this work session. No live request was made. The release workflow requires persistent signing secrets; preview CI can still build an ad-hoc DMG. The brief's companion HTML visual reference was not supplied, so the redesign follows its written layout, tokens and accessibility requirements.

## Audio-only capture investigation

The supported Electron loopback path grants a display source and audio. Chromium rejects display-media requests without a video source when video is requested, and the browser API does not expose audio-only display capture. Electron 39+ uses Core Audio taps internally. A separate process-tap helper would require native integration and real Mac permission/audio validation; shipping an unverified helper would reduce reliability. The permitted fallback retains the current path, never reads frames, explains macOS wording, and supplies an end-to-end sound check.
