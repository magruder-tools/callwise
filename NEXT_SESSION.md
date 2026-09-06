# Next session — the shortest path to a useful live call

Prepared September 6, 2026. User requested keys and Mac-specific setup be left
for the next session. No live API call, key creation, or paid service was used.

## Decisions already made

- Working name: Callwise (can be changed).
- Build a personal assistant for many types of calls; prioritize useful,
  source-linked thinking, fast suggestions, and slower Astra strategy.
- Use one small current Electron shell, reuse Cue's AudioWorklet, and avoid a
  wholesale merge of Cue/Glass. GPL attribution is preserved.
- Default to local in-memory session state and explicit consent/start/pause/end.
- Keep provider keys outside Git. Start with imported context, then connect one
  live context source. No additional SaaS subscription is required by the code.

## Need Matthew / the actual Mac

1. Run the demo and tell us whether the coaching panel density is comfortable.
2. Reuse an OpenAI key securely; verify access to the three configured models.
3. Confirm macOS version and the first calling app to support. Test two-sided
   audio and permission prompts on that machine.
4. Decide whether to use Codex subscription usage or API usage for strategy.
5. Optionally add the Fireflies API key and a valid test transcript ID. Verify
   live API/beta access; a key alone does not prove streaming works.
6. Choose the first useful context source: a handful of real approved notes,
   or a trusted read-only MCP server for Gmail, Drive, or Notion.
7. Clone the private repository at https://github.com/magruder-tools/callwise
   in Codex on your Mac. Repository creation is complete.

## Highest-priority implementation follow-ups

- Validate the Codex App Server adapter against the user's installed version.
  Handshake, account inspection, and schema generation were verified against a
  real Codex CLI 0.153.4 in the build workspace. Model turns are tested against
  protocol fixtures, not live inference or the user's Mac.
  Thread startup on the build host timed out; investigate that first if choosing
  Codex strategy. The OpenAI API strategy adapter is the simpler initial route.
  Confirm `features.shell_tool`, thread config overrides, the read-only sandbox,
  and `ephemeral` behavior with that version; fail closed if unsupported.
- Test audio routing and timestamp alignment during a 15-minute practice call.
- Run explicit consent/start → pause while connecting → resume → end → new-call
  tests, including device disconnects and network interruption.
- Add model token usage into a user-configured spend estimate, then enforce
  meaningful dollar budgets once model pricing has been reverified.
- Add curated ChatGPT connector invocation only after effective permissions and
  read-only tool allowlists are verified. Do not enable all inherited tools.
- Improve retrieval from structured MCP results into individual source records
  with original links, rather than a combined search-result note.
- Add a compact rolling conversation summary; currently model prompts use a
  bounded recent transcript plus retrieved documents, not complete long-call
  history. Full transcript remains available for explicit export.
- Add optional local Whisper after profiling the user's Mac. Choose the model
  size based on its available memory and measured transcription speed.
- Add speaker diarization if group calls need distinct identities beyond
  microphone versus computer audio.

## Quality target: earn the right to replace a commercial coach

Replay representative sales, strategy, and general-call segments. For each
suggestion, assess relevance, correctness, source support, timing, usefulness,
and distraction. Compare the same segments against Final Round if available.
Measure actual fast-lane latency and strategic usefulness rather than claiming
that Astra or open-source assembly automatically wins.

Proposed first gate: a 15-minute practice call with continuous two-sided capture,
correct sources, no post-pause requests, no unrelated-client context, and several
suggestions Matthew would actually choose to use. These are proposed acceptance
criteria, not completed results.
