# Floating focus — 0.3.0

The live view follows the selected compact dark concept: one stable suggestion, a short explanation, Keep, queued updates, an Ask Callwise field, and visible Pause/End controls. The default window is 740 × 480 and can shrink to 600 × 420. Long advice scrolls inside the reading area; incoming advice does not replace the current card.

## Where existing features live

- Transcript beside the question field: both audio meters, live transcript, speaker attribution, and manual text entry.
- Insights in the footer: the complete strategy lane, queued insights, source links, and Think deeper.
- More options (•••): call setup, suggestion history, connections/preferences, floating above other apps, suggested questions, and session export.
- Call setup: all input modes, participant consent, call type, goal, Context scope, quiet mode, context import/search, Fireflies history, session usage, and export.
- Connections/preferences: saved credentials/models, ChatGPT sign-in, Codex discovery and source choices, read-only context permission, automatic lookup, and personal profile.

Encrypted preferences and connection files keep their existing location and schema. No credentials or settings file is deleted by the update. The installed bundle remains /Applications/Callwise.app with the same bundle identifier. Participant consent is still required for a new live call, and no recording starts automatically.

The previous connection framing fixes, guarded system-audio handler, saved defaults, coaching throttling, and stable advice/history behavior are retained. The floating toggle changes always-on-top behavior without resizing or hiding features.

Validation: 118 regression tests, renderer/controller interactions, source-link and queued-card stability, preferences recreation/new-call tests, and native offline smoke previews at 740 × 480 and 600 × 420. Audio capture code is unchanged from the verified capture implementation; macOS may require refreshed approval after installing a newly ad-hoc-signed bundle. A real call remains the appropriate final reliability check.
