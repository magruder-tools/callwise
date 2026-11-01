# Callwise 0.5 privacy

Audio capture begins only after you explicitly start a transcribed meeting and confirm that you shared the current participant notice and obtained agreement. A notes-only meeting does not capture audio. Setup sound checks capture only when you run them. Pause, End, sleep and screen lock stop capture; End drains audio already received. Callwise does not listen in the background between meetings.

Apple SpeechAnalyzer transcribes on this Mac. Apple Foundation Models uses an explicitly constructed on-device SystemLanguageModel for local recaps and note editing. No private-cloud model or automatic cloud fallback is selected. Speech language preparation may download Apple assets. Bundled speaker models are downloaded and hash-verified at build time; runtime inference loads local Core ML files directly.

Meeting content is encrypted with AES-256-GCM using a random library key wrapped by Electron safeStorage and the macOS keychain. Record-specific authenticated data prevents ciphertext from being moved between meetings or record types. An unreadable or missing existing key is preserved and fails closed. SQLite/WAL contains ciphertext and basic record identifiers/timestamps, not plaintext titles, people, transcript text, notes or actions. Working content and the search index exist decrypted in app/worker memory while needed. Diagnostic logs contain safe codes, not transcripts or API keys.

Retained audio is off by default. When enabled it is encoded into independently encrypted MP3 chunks on this Mac. Group-call speaker processing can retain up to two active hours of remote-channel PCM in memory even when audio retention is off; it is discarded after processing or cancellation. Playback is deliberate and reads only the selected meeting's retained chunks.

Transcripts/notes are kept until deleted by default. Retained audio defaults to 30 days. Privacy settings require confirmation before new limits apply to existing ended meetings. A meeting deletion removes local records and audio; exported files and prior backups are separate copies. Filesystem deletion cannot promise forensic erasure on an SSD or removal from independent device backups.

Markdown/JSON exports are plaintext and saved to a location you choose. Apple Notes/Reminders exports show a preview and destination; content then follows those apps' storage/iCloud settings. Stable export markers prevent duplicates. Calendar reads require a deliberate action. No emails, chat messages or reminders are sent automatically from a recap.

Optional OpenAI/Codex coaching and Advanced OpenAI transcription have separate privacy implications. When enabled, relevant materials/excerpts or transcription audio are sent to that provider. Credentials stay encrypted in the main process and are not exposed to the renderer or saved meeting export. Core local meetings work with these connections off.

Saved meeting MCP access is off by default and checked on every tool call. The headless app opens the same encrypted library read-only. It exposes bounded metadata, search results, notes, recaps, actions and transcript excerpts, not capture, audio playback, writes or deletion. Access logs contain time, tool, client label and meeting IDs only. The requesting assistant's provider may process returned excerpts. Connecting Callwise does not copy raw Claude/ChatGPT chat history, alter the separate personal_mac connection, or grant arbitrary filesystem access.

Participant notification is user-delivered. Callwise cannot verify remote delivery and does not create a platform recording indicator. It stores your confirmation and settings as a receipt, not proof of delivery or a legal determination.
