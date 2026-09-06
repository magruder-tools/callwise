# Install Callwise on your Mac

Personal-use development build for Apple Silicon (M1 or newer), macOS 14.2 or newer. The package includes Callwise and the official Codex helper. You do not need Node, Terminal, a separate Codex CLI installation, or separate Gmail/Drive/Notion API keys for the packaged app.

## 1. Open the app

Download the Callwise Apple Silicon ZIP, double-click to expand it, and drag Callwise.app to Applications. Open it from Applications. If you downloaded the GitHub Actions artifact, expand the outer ZIP and then the Callwise ZIP inside it.

This personal build is ad-hoc signed, not signed with an Apple Developer ID or notarized by Apple. After trying to open it, macOS may require System Settings > Privacy & Security > Open Anyway. That is a per-app exception; do not disable Gatekeeper globally or run commands that remove system security protections. If macOS says the app is damaged or malicious, stop and share the exact warning instead of bypassing it.

Click Start demo. The fictional conversation and its suggestions are scripted; no key or microphone is used. End the demo and click New session before trying real context.

## 2. Add one OpenAI API key

For live transcription and fast coaching you need an OpenAI API project key with model access and available API billing/quota. ChatGPT Pro does not pay for API use. Create or reuse a key at https://platform.openai.com/api-keys and manage API billing at https://platform.openai.com/settings/organization/billing/overview .

Paste the key ONLY into Callwise > Connections > OpenAI API key. Click Save encrypted connections, then Check model access. Never paste the key into ChatGPT, email, GitHub, source code, or a screenshot. Callwise does not need your account password.

Configured models are gpt-5.6-luna (fast), gpt-6-astra (strategy), and gpt-live-transcribe (transcription). Model access is account-specific. A successful model metadata check is not a paid inference test. If a check fails, share the model name and error, not the key. Avoid guessing replacement model names.

The standalone Codex context lookup can be tested before adding an API key. The full live-call path still requires that key. API charges vary with transcript length and reasoning; this early version caps requests but has no dollar-denominated spending meter or guaranteed dollar cap. Review actual API usage after the practice test.

## 3. Connect Codex without Terminal

In Connections, click Sign in with ChatGPT. Complete the official browser sign-in using the ChatGPT account that has your connected apps. Existing local Codex ChatGPT sign-in is reused. Tokens remain with the official Codex helper, and its sign-in may be shared with your other local Codex tools. Callwise will not silently replace an API-key-only Codex login.

Click Find my apps. Under Connected context choose My connected apps through Codex, select only ready apps appropriate for the call, allow those read-only sources for this session, and Apply context choices. App availability depends on your account and Codex; it is not a promise that every ChatGPT connector is callable. ChatGPT memory and past chats are not imported.

Set Context scope to the client/project name. Use Search connected context and ask a question whose answer you know. Inspect the excerpt and original link when available. Only after that succeeds, turn on optional automatic lookups. Source choices are per-session and reset for a new session.

Context scope steers retrieval but is not an account permission boundary. A selected app may access the entire connected account. Relevant call excerpts may become search queries, and retrieved excerpts may go to the configured coaching provider. Only use content appropriate to the call.

## 4. Run a practice call

Use headphones. Choose Microphone + computer, confirm that transcription and AI assistance are permitted, and grant Microphone and Screen/System Audio Recording permissions if macOS asks. Restart Callwise if macOS requires it.

Confirm both your speech and the other side appear in the transcript. Check fast and strategic suggestions, a typed question while the app is already thinking, a known-record context lookup, Pause, Resume, and End. Do not rely on it in an important meeting until that whole path works on your actual Mac. Provider latency, real account access, and live audio have not been verified by automated tests.

## Optional — not needed for first use

Fireflies: only supply a Fireflies API key for its alternative live-transcript/history path. Live feed access may require additional account eligibility and the active transcript ID. Leave it blank for microphone/computer audio and Codex context.

MCP: leave it off unless you already have a specific trusted read-only server to connect. No extra Gmail, Drive, Notion, Slack, Zoom or Meet keys are needed for the Codex path.

Apple signing: no Apple Developer account is required to try this personal build. Developer ID signing and notarization remain work for broader distribution, not a requirement to buy before a practice test.

## What to send back

Report whether the app opens, whether the demo works, the result of Check model access (hide any secret), which apps Find my apps marks ready, and whether both sides of the practice call are transcribed. Include the exact error text or a screenshot when something fails. Never include a key or password.

## Primary documentation

OpenAI Codex authentication: https://developers.openai.com/codex/auth
OpenAI App Server: https://developers.openai.com/codex/app-server
OpenAI models: https://developers.openai.com/api/docs/models
Apple app safety: https://support.apple.com/102445
