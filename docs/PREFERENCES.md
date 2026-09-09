# Saved preferences — 0.2.2

Desktop preferences are encrypted through macOS secure storage in Callwise's application-support folder. The profile, call type, goal, Context scope, quiet mode, input choice, strategy choice, app selections, read-only context permission, automatic lookup preference, and floating-window setting persist across new calls and app restarts.

Setup edits save automatically. Use Save preferences for the profile and Save context preferences for connected sources. Existing selected apps are retained; access is not enabled just because an app is selected. Codex availability and read-only tools are checked again for each lookup.

Transcripts, retrieved documents, call activity, and participant consent are excluded from the preferences file. New calls require participant consent again and do not start recording automatically. Demo fixture changes do not become saved defaults.

Validation: 118 regression tests passed, covering encrypted persistence, controller recreation, new sessions, UI app-selection restoration, malformed preferences, unavailable apps, and failed saves. Native reopening after the macOS keychain prompt restored 10 selected app IDs, microphone + computer input, quiet mode enabled, context permission disabled, and idle status with no capture. Codex discovery again found 36 of 38 apps ready. Version 0.2.2's refreshed microphone and system-audio approvals are being checked separately because its ad-hoc signature differs from 0.2.1.
