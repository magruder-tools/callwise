# Start here — Callwise

You do not need to gather keys before trying the demo.

## 1. See the experience

Clone the private repository, or unzip the saved source project. Open its
`callwise` folder in Codex on your Mac and ask:

> Read START_HERE.md and NEXT_SESSION.md. Run the offline demo first, then help me
> validate the desktop app. Do not activate paid APIs until I choose to do so.

Or, with Node.js 22.12+ already installed, open Terminal in this folder and run:

```sh
npm run demo
```

Open http://127.0.0.1:4173. Click **Start demo**. Within a few seconds you should
see a question linked to a fictional client brief. A strategic card follows.
Try **Useful**, **Dismiss**, **Why this?**, source chips, and **Pause**.
The sample replies are scripted so you can evaluate the workflow at no cost.

## 2. Open the actual desktop shell

```sh
npm ci
npm start
```

Try the demo again. The ↗ button switches to a narrow floating window. Global
shortcuts: **Command+Shift+Space** requests a fast thought, and
**Command+Shift+P** pauses the session. The app has no stealth mode.

The included macOS ZIP, if present, targets Apple Silicon. It is an unsigned
development build. Its build was verified; launching it on macOS was not. Use
the source commands above if macOS will not open the downloaded package.

## 3. Connect OpenAI when you are ready

Ask Codex to help reuse your existing key securely. Do not paste a key into this
chat, a GitHub issue, a context note, or a tracked file.

The example file is `.env.example`. The actual private file is `.env.local` in
the source project. For the packaged app, the alternate location is:

```text
~/Library/Application Support/Callwise/.env.local
```

Required for the current live build: `OPENAI_API_KEY`.

Defaults: fast coaching uses `gpt-5.6-luna`; API strategy uses `gpt-6-astra`;
audio transcription uses `gpt-live-transcribe`. Model names are configurable.
Your account must have access. Restart after editing the private configuration.

Start with **Paste conversation text** and a short mock conversation to verify
coaching before testing audio. Live operation can incur API charges. The app
caps each session at 120 fast and 15 strategic requests; that is a request cap,
not a guaranteed dollar budget. Transcription is billed separately.

## 4. Test microphone and computer audio

Use a practice call in a setting where assistance and transcription are allowed.
Choose **Microphone + computer**, confirm the consent checkbox, and start.
Grant the Mac's requested microphone/audio/screen permission. If the screen
picker offers an audio-sharing checkbox, enable it for the selected source.

Verify both meters with speech on each side. A stream can exist but be silent;
the app flags channels with no detected signal. Prefer headphones for the first
test to reduce the other person's voice leaking into the microphone.

Pause must stop both channels. Test pause/resume, app switching, and disconnects
before trusting it in a client call. No video frames are processed or sent.

## 5. Optional connections

- **Codex strategy:** ensure `codex` is installed and signed in on your Mac.
  Connections → Check tests account/app discovery, not coaching quality. Select
  Astra via Codex, then test a short turn. This consumes available subscription
  usage. The current bridge does not automatically run your connected apps.
- **Fireflies:** add `FIREFLIES_API_KEY`. Enter the active meeting's transcript ID.
  API availability and live capture compatibility depend on your account. You
  can also import an earlier transcript by ID. Fireflies is not required for
  local audio capture.
- **MCP context search:** set the endpoint, optional token, read-only search tool
  name, and argument template from `.env.example`. Test manually before turning
  on automatic search in Connections. Gmail/Drive/Notion authentication belongs
  to the selected MCP server; this build does not manufacture or reuse tokens.

## 6. Get the project from GitHub

The private repository is [magruder-tools/callwise](https://github.com/magruder-tools/callwise).
Sign into GitHub as `magruder-tools`, then clone it through Codex or GitHub CLI:

```sh
gh repo clone magruder-tools/callwise
cd callwise
npm run demo
```

You can also choose **Code → Download ZIP** on GitHub and unzip it. Node.js
22.12+ is required for the demo. No API key or dependency installation is needed.

The historical `scripts/publish-github.sh` creates a new repository and is no
longer needed for this project. Use the existing repository for future work.
Keep `.env.local`, session exports, and real client context outside Git.
