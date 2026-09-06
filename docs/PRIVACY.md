# Data and consent controls

This is a technical description, not a jurisdiction-specific legal conclusion.
Your original requirement is to use assistance without breaking recording or
interception laws or the rules of the meeting. A vendor's existence, a hidden
overlay, or the absence of a saved audio file does not establish permission.

## Defaults

- No capture before explicit Start in a live session.
- Live start requires confirming that assistance/transcription are permitted
  and that any required participant consent has been obtained.
- The checkbox records your instruction locally; it cannot itself obtain another
  participant's consent or guarantee compliance with their jurisdiction.
- Pause/end closes the local transcription connections and releases streams.
  It does not delete data already transmitted to a provider.
- No raw audio files, analytics, background microphone, stealth mode, or hidden
  screen-share features are implemented.
- No external messages, purchases, calendar changes, or post-call writes are
  performed by the coaching engine.

## What leaves the computer

| Enabled feature        | Data transmitted                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Offline demo           | None; fictional fixtures only                                                                  |
| OpenAI transcription   | PCM audio from enabled microphone/computer channels                                            |
| OpenAI coaching        | Bounded transcript, selected goal/profile/context excerpts, question and prior advice          |
| Codex strategy         | Bounded transcript, goal/profile/context excerpts and question through the local Codex process |
| Fireflies live/history | Authentication and requested transcript ID; Fireflies supplies transcript text                 |
| MCP context search     | Configured search arguments, which may contain relevant conversation terms                     |

Only add context you are permitted to process with the selected services. Review
client confidentiality requirements before using real client data. Imported
documents and transcripts are treated as untrusted model input, not commands.

## Retention

Callwise itself keeps session data in memory unless you export. Text can remain
in OS memory, crash artifacts, or explicit exports; this is not secure erasure.
Provider retention, network logs, and Codex's local/account behavior remain
governed by those services and their settings. `store:false` and an ephemeral
Codex thread are not a blanket zero-retention guarantee.

Keys live in a private, Git-ignored `.env.local` file. They remain in main-process
memory and are not returned through the UI bridge. Credentials are never part
of exports. Source archive scripts include tracked project files and Git history,
so secrets must never be committed in the first place.
