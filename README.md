# Callwise

A personal thinking copilot for live conversations. Built for sales, strategy,
discovery, interview practice, negotiation, and general calls.

**Status: working offline demo + implemented desktop/integration code. Live API
and macOS audio validation are pending. This is not a claim of parity with or
superiority to Final Round, Glass, Cue, or any commercial product.**

**New: selected read-only ChatGPT apps through local Codex are now implemented.**
See [Connected context setup and validation](docs/CODEX_CONTEXT.md). Actual account-specific
retrieval still needs a practice test on your Mac. This feature does not import ChatGPT memory
or guarantee that every ChatGPT app is available through Codex.

Start with [START_HERE.md](START_HERE.md). The specific setup tasks for the next
session are in [NEXT_SESSION.md](NEXT_SESSION.md).

## Try it without an account or API key

Node.js 22.12 or newer is required. From this folder:

```sh
npm run demo
```

Open http://127.0.0.1:4173 and click **Start demo**. This server uses only Node's
standard library; dependency installation is not required for the browser demo.
The fictional Northstar call demonstrates both coaching lanes and source links.
Its model responses are deliberately scripted and labeled. It never loads keys,
captures audio, starts Codex, or calls external services.

## Run the desktop app on your Mac

```sh
npm ci
npm run doctor
npm start
```

The same demo works inside the desktop app. Choose a live source only after keys
and permissions are set up. An Apple Silicon development ZIP can also be built:

```sh
npm run dist:mac
```

The current package is unsigned and not notarized. A source launch is the
recommended development path until signing is configured. macOS may prevent an
unsigned downloaded application from launching.

## Implemented

- Electron 44 desktop shell; standard window and floating compact mode.
- Independent microphone and computer-audio channels, a 24 kHz AudioWorklet,
  live level meters, explicit start/pause/end, and no saved raw audio.
- OpenAI live transcription adapter with bounded audio packets, silence
  detection, utterance commits, and connection/backpressure handling.
- OpenAI Responses adapter for fast coaching and Astra strategy, with structured
  output, bounded prompts, request timeouts, and `store: false`.
- Experimental Codex App Server adapter using the installed CLI/sign-in. It
  negotiates JSON-lines messages, creates an ephemeral coaching thread, parses
  final structured output, and interrupts cancelled turns.
- Two independent coaching lanes with coalesced triggers, request caps, stale
  response rejection, confidence filtering, deduplication, and useful/dismiss
  feedback. Quiet mode supports assistance only when requested.
- Text, Markdown, CSV, VTT, SRT, and JSON context import; scoped local retrieval;
  preserved source excerpts; unknown source IDs rejected by the engine.
- Optional read-only MCP search, manually or automatically before strategic
  checks. A configured tool must advertise read-only behavior. User-approved,
  trusted server configuration is still essential.
- Fireflies live Socket.IO adapter and past-transcript GraphQL import.
- Markdown session export, connection readiness UI, and safe setup diagnostics.
- Offline tests for lifecycle, provider contracts, context scope, and controls.

## Explicitly not finished

- Live testing with your OpenAI key, Fireflies beta access, and Codex installation.
- macOS capture and permissions across Zoom, Meet, Teams, FaceTime, and devices.
- Live validation of your selected ChatGPT apps through Codex. The new separate
  read-only context bridge is implemented and opt-in; account-specific access,
  provider metadata, and actual retrieval quality still need validation.
- ChatGPT memory/chat-history import; native Gmail/Drive OAuth onboarding.
- PDF/Word extraction, speaker diarization beyond you/others for local audio,
  local Whisper, screenshots for model input, and autonomous post-call actions.
- A measured coaching-quality or latency comparison with Final Round.
- Signed/notarized distribution, auto-updates, and production support.

## Data handling

Callwise holds transcripts and loaded call context in memory by default. Closing
the app clears those. Desktop preferences, including your profile, call setup defaults,
selected apps, and context permission, are saved encrypted on this Mac until changed.
Participant consent is confirmed for each new call. Explicit exports create a file you choose.
Live audio/text/context go to whichever providers you enable. Providers and Codex
have their own data handling; in-memory storage here is not a promise of zero
provider retention. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

```sh
npm test
npm run check
npm run doctor
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/VALIDATION.md](docs/VALIDATION.md). No live provider calls are part of the
tests. GitHub Actions is configured to check pushes and pull requests. No
auto-publish job exists.

## Provenance and license

GPL-3.0-or-later. The AudioWorklet adapts a small component from Cue; the rest of
the coaching architecture and UI were written for this project. Glass was
reviewed as a reference, and no Glass code or binaries are included. Exact source
revisions and modifications are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

