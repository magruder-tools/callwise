# Architecture

Callwise is a macOS Electron app with a trusted main process and sandboxed ES-module renderers. It has no renderer Node access. The browser sample uses the same controller and engine with synthetic input and an offline provider.

## Conversation and coaching

`core/controller.mjs` owns inputs, preparation, recaps, call sheets, usage estimates and read-only context research. `core/engine.mjs` owns active call time, final and partial transcript rows, cards, cancellation epochs, coverage and verbatim commitments.

Pure rules in `core/triggers.mjs` classify the other person's turns. Own speech, backchannels, short utterances and recently answered repeats do not trigger proactive help. Limits are a burst of three, eight per rolling minute and per-session caps. A complete partial question can start after 250 ms of stability; a materially changed final aborts it and restarts. Explicit questions cancel proactive work and always produce an answer or a missing-context fallback. Background checks run at most every 45 seconds, deeper observations at decision/topic changes at most every two minutes. Connected lookups during calls run only when explicitly asked.

Specific wrap-up cues, including a short “Anything else?”, can immediately surface the prepared points not yet covered without an API request. Coverage and trigger classification are included in the volatile prompt tail. Pin and dismissal persist across streaming updates, cancellation removes unfinished cards, and an answer painted on time stays current even if completing the response takes longer.

OpenAI Responses requests stream v2 cards with `speak`, `kind`, `lead`, `points`, `sourceIds`, `covers`. The engine paints partial leads, retains authoritative source checks, holds factual cards until citations can be checked, and removes invalid draft cards. Fast requests use 350 output tokens, the lowest known supported reasoning effort, a six-second first-token deadline and at most one network/5xx retry within that deadline. Slow observations never replace the main card. Older Codex and demo response shapes are adapted at the validation boundary without changing their transports.

Prompts keep instructions, playbook, profile, call line, material text and prep before the volatile conversation tail. Full material is supplied within estimated 20k/60k token budgets; oversized material uses selected excerpts and the digest. Those budgets use a documented four-character estimate. Short recent verbatim turns, rolling memory, commitments, explicit gaps, the trigger and prior leads follow. All user and retrieved data is marked untrusted. Citation IDs are checked against actually supplied evidence. Running summaries are updated by the cheap model after three minutes of new active-call transcript, and cancelled on pause, reset and close.

Preparation is keyed by call type, line, profile, materials, carried history and model. Audio and unrelated settings do not rebuild it. Every import invalidates it. Starting a call cancels unfinished preparation and retains original evidence with a local fallback rather than accepting late changes to the prompt.

## Audio

The main renderer captures audio; the panel only receives state and meters. User-consented listening and user-initiated short sound checks are the only permission windows. Both channels produce 24 kHz mono PCM through a muted AudioWorklet graph. Raw video is never read: Electron's supported display-media loopback path also requires a display track. The current path is retained instead of shipping an unverified native Core Audio helper. Electron 44 uses Core Audio taps for loopback, but a display-source permission can still be needed by this API path.

Each channel has an independent Realtime transcription socket, bounded 15-second PCM recovery buffer, exponential reconnect up to a minute, heartbeat and stalled-segment checks, gap markers and cancellation. At 50 minutes a standby session is opened; it takes over after 1.5 seconds of silence and old pending transcript acknowledgements drain. Closing or pausing clears standby/delegate sockets too. This is preventive rotation; the current transcription guide does not specify a distinct guaranteed transcription-session duration.

Fireflies retains its existing three-attempt Socket.IO recovery. The controller lets it retry while the call stays running, records possible missing words as a transcript gap, and reports exhausted recovery. Its meeting ID is held only in memory for pause/resume and cleared for a new call.

Voice detection calibrates a noise floor during the first second and updates quietly. Speech commits after normal silence or a 200 ms dip after eight seconds, with a hard 14-second boundary. Device changes reacquire the saved microphone or fall back to default, without stopping the other channel. Reacquiring system capture may require renewed user interaction on some macOS versions; a failure is reported. Overlapping microphone and system transcripts at 70% text similarity keep system evidence. Saved language, prep glossary and limited call context become supported transcription hints.

## Desktop and storage

Ready, Recap, Settings and Welcome use the normal main window. Listening uses a nonactivating panel, default 440 × 320, resizable 340–640 wide, expanded to fit content, with per-display bounds. `showInactive` and all-Spaces/full-screen visibility avoid taking meeting focus. Global shortcuts register only while running and conflicts are reported.

Keys, settings, call sheets and setup-test status use Electron `safeStorage`, fail closed without encryption, and write atomically. Recent calls keep setup/materials and explicitly carried recaps; no transcript or card array is serialized. Current transcript/card history and short PCM buffers are in memory. Structured diagnostics whitelist timing, state and safe error metadata, exclude private content, and rotate five 1 MB files.

Installed builds ignore plaintext environment/file configuration and use the encrypted connection vault. Development overrides remain available to source launches. Custom server URL, private token, exact search tool and JSON parameters can be entered in Advanced; the unchanged transport still verifies the configured tool's read-only annotation. Saved verified excerpts retain bounded connector provenance.

The read-only Codex bridge, Fireflies transport and custom MCP policy retain their existing safety boundaries. The bundled Codex helper removes Terminal/PATH requirements. External links are restricted to HTTP(S); update offers accept only stable newer GitHub releases under this repository's HTTPS release path.

## Distribution

Mac CI checks source and packaged apps and records UI screenshots. DMG and ZIP builds use the same app identifier. Personal development builds are explicitly ad-hoc; production release publishing requires a persistent certificate held in Actions secrets. The signer handles nested Electron code and the bundled helper. Releases are durable; CI preview artifacts are retained 30 days. Actual permission continuity and full-screen behavior require a real Mac with two successive persistent-identity builds.
