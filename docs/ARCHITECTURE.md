# Architecture

## Boundaries

- `desktop/main.mjs`: trusted Electron main process. Owns provider credentials,
  OS integration, session controller, file dialogs, export, and IPC validation.
- `desktop/preload.cjs`: narrow IPC bridge. No provider keys are exposed.
- `ui/`: local interface and AudioWorklet. Captures two streams after explicit
  start. Sends 24 kHz mono PCM to main; never sends video frames to a model.
- `core/engine.mjs`: state machine, revisioned transcript, retrieval, scheduling,
  bounded prompts, cancellation, source validation, and feedback.
- `providers/`: OpenAI Responses, OpenAI transcription, Codex App Server,
  Fireflies, and a single-tool read-only remote MCP client.
- `scripts/demo-server.mjs`: an independent loopback-only, cookie-protected demo
  host. Hard-disables live modes and does not load credentials.

## Coaching lifecycle

Each final transcript segment is upserted by stable ID. Partial updates are
displayed but do not trigger coaching. Fast and strategic lanes have separate
in-flight slots, minimum intervals, delays, TTLs, and request counters. Incoming
updates coalesce; no unbounded queue is created. Once an in-flight request
finishes, a changed transcript can schedule one subsequent request.

Pause/end/new increments a generation, clears timers, aborts in-flight work,
closes transcription sockets, and signals the renderer to release capture.
Results from old generations cannot produce a card. Results that exceeded time
or transcript-advancement limits are dropped. An old job cannot clear a newer
job's in-flight slot.

Source lookup runs over in-memory documents, scoring chunks with matching query
and title terms, scoped by project. Optional background MCP retrieval happens
before strategic inference. It replaces one recent search-result document and
is bounded by network timeouts and the strategic request limit. A failed lookup
falls back to already loaded context. Only retrieved source IDs may be cited;
cards explicitly labeled as facts require a citation. This checks provenance
references, not the semantic truth of every generated claim.

## Codex adapter

Callwise spawns the configured `codex app-server` executable with argument
arrays, never shell command interpolation. It uses the documented initialize /
thread / turn / item protocol, requests structured advice, denies approval
requests, and interrupts cancelled turns. Inherited apps and MCP servers are
disabled for the coaching thread via per-thread overrides. Shell, computer-use,
browser, code-host, and related capabilities are explicitly disabled as well.
The adapter reads the installed CLI's generated schema to select its supported
approval/sandbox enum values. The turn uses a read-only, network-disabled policy;
it adds restricted filesystem roots when that CLI supports them. Older versions
have broader filesystem read access, so disabling execution tools remains
important. No global Codex configuration is edited.

Existing ChatGPT auth is managed by Codex. The bridge does not read, export, or
copy OAuth tokens. App discovery is a readiness check only. Provider-specific
retention remains separate from the Callwise in-memory policy.

The adapter must be validated on the user's actual CLI before live use. It does
not provide a universal custom-agent sandbox or inherit all ChatGPT memory.

## Audio

Microphone uses `getUserMedia`; computer audio uses `getDisplayMedia` with
loopback. Electron 44's macOS capture path requires the packaged audio-capture
usage description. The native picker is preferred. Display frames keep the
capture stream alive but are not inspected or transmitted.

The AudioWorklet averages input channels, produces 100 ms PCM packets, and
measures RMS. Main retains a brief leading buffer and streams voice plus bounded
trailing silence; utterances commit after 600 ms silence or 8 seconds of speech.
Each channel has an independent transcription connection. The first practical
test should use headphones; microphone echo cancellation is not full acoustic
echo separation of system audio.

## Current constraints

- No automatic diarization of multiple remote participants in local capture.
- No persisted session DB, background daemon, or silent auto-recording.
- No audio restart/replay across a disconnection. Failures pause or visibly
  report a gap; do not silently fabricate continuity.
- Request caps are not dollar budgets. Transcription time is separate.
- Context import is text-only; no PDF/Word extraction yet.
- No model benchmark or macOS end-to-end success is implied by fixture tests.

## Sources reviewed September 6, 2026

- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/auth
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/guides/realtime-transcription
- https://www.electronjs.org/docs/latest/api/desktop-capturer
- https://docs.fireflies.ai/realtime-api/getting-started
- https://docs.fireflies.ai/realtime-api/event-schema
- Cue and Glass revisions in THIRD_PARTY_NOTICES.md
