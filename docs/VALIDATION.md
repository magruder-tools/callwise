# Validation record

Build date: September 6, 2026. Build host: Linux x64, Node 24.19.0.

## Verified

- Offline demo server starts without dependency installation or API keys.
- All 31 automated checks passed in the final source suite, including a simulated
  DOM renderer test against the real session controller. No tests were skipped.
- JavaScript syntax checks cover all source and test modules.
- Production dependency audit reports zero known vulnerabilities after updating
  the direct WebSocket dependency. This is not a comprehensive security audit.
- Demo flow: start → load fictional context → ingest transcript → fast/source
  cards → inspect source → mark useful → pause → end → new session.
- Engine: stable transcript IDs, revisions, cancellation, independent lanes,
  stale advice rejection, request caps, quiet mode, deduplication, project scope,
  unknown-citation rejection, background-retrieval cancellation, and export.
- Provider fixtures: OpenAI structured requests, safe errors, Fireflies event
  mapping/history import, MCP read-only filtering, PCM silence handling, and
  Codex streaming/final-answer handling.
- Real Codex CLI 0.153.4: schema generation, JSON-lines initialization, and
  account inspection completed without running model inference. A signed-in
  account was reported in the build environment; this does not verify the
  user's Mac or automatic access to its ChatGPT connections.
- Electron builder produced an Apple Silicon development app bundle on Linux.
  Source and package metadata include macOS audio permission descriptions.

## Not verified / environment limitations

- No OpenAI coaching or transcription request was made with a live API key.
- No live Fireflies or MCP account was configured or tested.
- No Codex inference turn was run. Model entitlement, behavior, latency, usage
  limits, and tool restrictions still need a short real test after approval.
  An attempted ephemeral thread startup timed out on the build host; end-to-end
  Codex strategy remains experimental even though schema/account checks passed.
- No microphone/computer audio was captured here. macOS permissions, device
  switching, echo, dropouts, diarization, and app compatibility need Mac testing.
- The cloud browser blocked the loopback demo URL. The headless Electron
  renderer could not run under this host's socket/process restrictions. Thus
  visual rendering and real desktop interaction were not verified; the DOM test
  validates interface wiring, not pixel appearance or native UI behavior.
- The macOS package is unsigned and unnotarized. It has not been launched on
  macOS and should be treated as a development candidate.
- Initial build environment could not create a GitHub repository. Matthew later
  created private `magruder-tools/callwise`; its initial README and write access
  were verified before preparing the source upload.

## First real-call gate

1. Run the offline demo in the actual desktop app.
2. With chosen credentials, test a pasted conversation and verify source links.
3. Test both audio channels in a permitted practice call with headphones.
4. Pause during connection setup, during speech, and during strategic inference.
5. Resume, disconnect a device/network, end, and start a separate session.
6. Verify that no prior client's context appears in the next call.
7. Assess actual useful/distracting advice, not just whether cards appear.

Performance targets are not measurements. A strong model and a working event
pipeline do not yet establish that Callwise is better than Final Round.
