> **Connected context update:** Callwise now has an opt-in Codex context bridge.
> Follow [docs/CODEX_CONTEXT.md](docs/CODEX_CONTEXT.md) for **Find my apps**,
> per-session source selection, and the known-record test. Use current source,
> not an earlier development ZIP. No live-account validation is claimed.

# Run Callwise on your Mac

Callwise is an early build. The offline demo is tested in code; **live OpenAI inference and macOS meeting-audio capture still require a real practice call on your Mac before you trust it for an important meeting.**

## The easy path

1. Install Node.js 22.12 or newer if it is not already installed.
2. Open Terminal in the Callwise folder.
3. Run `npm ci` once.
4. Run `npm start`.
5. Click **Start demo**. Make sure you see the fictional transcript and both coaching lanes.
6. Open **Connections**. Paste your OpenAI API key, keep the suggested model names unless you know your account uses different ones, then click **Save encrypted connections**.
7. Click **Check model access**. Green/OK metadata checks mean the key can see those model names; they do not yet prove inference or billing.
8. Select **Microphone + computer**, check the consent box, and start a short practice call. macOS may ask for Microphone and Screen/System Audio permissions. Grant them, then fully restart Callwise if macOS asks.
9. During the practice call, speak and play the other person's audio. Both meters must move and both sides must appear in the transcript. If either side does not, do not use Callwise for an important call yet.
10. Ask Callwise a typed question while automatic coaching is already thinking. The typed question should take priority and return an answer.
11. Pause, resume, and end once. Confirm capture stops immediately each time.

## What I would trust today

- Offline demo and core state/control logic.
- In-memory session context and explicit exports.
- The UI's basic desktop and compact layouts.
- Encrypted local connection storage when macOS secure storage is available.

## What still needs proof on your actual Mac

- Your OpenAI key has live inference access to the configured models and sufficient API billing/quota.
- The configured transcription model is available to your key and works with the realtime transcription endpoint.
- macOS captures Zoom/Meet/Teams/FaceTime system audio reliably on your hardware and OS version.
- Long calls remain stable under your real network conditions.
- Optional Codex, Fireflies, and MCP connections.

## If something goes wrong

- **Key rejected:** open Connections and paste the key again. The app never displays a saved key.
- **Saved connections cannot be unlocked:** quit Callwise, unlock/login to your Mac normally, and reopen. If the warning persists, move `connections.bin` out of Callwise's app-data folder and save connections again. Do not delete the old file until the new setup works.
- **No microphone:** System Settings → Privacy & Security → Microphone → allow Callwise/Terminal, then restart.
- **No meeting audio:** System Settings → Privacy & Security → Screen & System Audio Recording → allow Callwise/Terminal, restart, then select a source that includes audio.
- **One audio channel dies:** Callwise should pause rather than quietly continue with an incomplete transcript. Resume after checking the connection; use a new session when changing clients.
