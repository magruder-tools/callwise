# Privacy

Callwise listens only when you start a call with consent or run a short sound check. Pause, End, sleep, lock and quitting stop capture and close input sockets. No analytics, background microphone, screen reading, raw audio files, stealth mode or hidden screen-share features are implemented.

## What leaves your Mac

While listening, microphone and call audio go to OpenAI Realtime transcription. Coaching requests include your supplied profile, call line, materials, prep, relevant transcript and rolling memory. With a saved key, preparation reads supplied materials before Start as you edit the setup; recaps use the conversation after End. These requests set `store:false`. OpenAI's applicable API retention and account policies still apply; this setting is not a guarantee of zero retention.

Saving and testing the API key makes a metadata request, two tiny billed inference requests, and a transcription-session handshake. Sound checks send the short test audio to transcription and display the returned words. They stop automatically and do not become saved conversations.

Optional Codex, Fireflies or a custom read-only server may receive the queries and material you explicitly request. Connected-app research is pre-call or on explicit questions during a call. Nothing sends emails or other messages for you. The app checks GitHub Releases on launch without transmitting call content or credentials.

## What is saved

The macOS keychain-backed encryption mechanism stores connection keys, setup defaults, readiness results and the last five call setups with their extracted material text. A recap is saved only if you check **Bring this recap into the next call**. Old carried recaps appear as preparation evidence when you reuse that call. Full transcripts and suggestion arrays are never serialized to saved calls. Encrypted storage is required; no plaintext fallback is used.

Transcript rows, suggestions, prep, memory and audio buffers are temporary process memory. Reconnection keeps at most 15 seconds of PCM per channel and clears it after acknowledged final transcription or stopping. Raw video frames are never read, stored or sent; the display track exists solely because Electron's capture API requires it for this loopback path.

Diagnostic logs include version, state, timing and constrained error codes/status. They exclude credentials, prompts, transcripts, goals, material text, upstream error bodies and private paths. Logs rotate across five 1 MB files. Copy diagnostics produces a sanitized summary and 200 recent events. Cost is an estimate based on token usage and submitted audio duration at editable rates, not a billing statement.

**Delete everything on this Mac** requires confirmation and removes Callwise's saved calls, materials, carried recaps, keys, settings, test results, private work directory and logs. Files you explicitly exported and shared Codex/ChatGPT authentication outside Callwise's data directory remain under your control.

Markdown exports can contain the transcript, recap and source provenance in plaintext; choose where to save them. Callwise does not upload exported files.

## Screen sharing and permission checks

The panel is visible in whole-screen sharing. Share one meeting window if you want the panel outside the share. macOS may call the loopback permission Screen & System Audio Recording because this API requests a display source, even though no frames are used. Development launches can create a silent stream; use the installed app and run the sound check.

Check that participants and the meeting or interview rules permit AI assistance before listening. The consent checkbox resets for every new or reused call. Saved setup never supplies consent.
