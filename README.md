# Callwise

A quiet second thought for your calls. Callwise listens to your microphone and call audio, uses the notes you supply, and offers short words you can say, questions to ask, or facts from your materials. It stays quiet when there is nothing useful to add.

## Install on your Mac

Use the Apple Silicon DMG from [GitHub Releases](https://github.com/magruder-tools/callwise/releases). Requires macOS 14.2 or later. Drag Callwise to Applications and launch it from there. Personal self-signed builds may need **System Settings → Privacy & Security → Open Anyway**. Developer ID and notarization are optional for maintainers with an Apple Developer account.

Until a stable signing certificate is configured, development DMGs are available from the **Mac download** workflow's **Callwise-Apple-Silicon** artifact. These previews use an ad-hoc signature; upgrading them can require fresh permission approvals.

Real calls are supported in the installed app. Terminal and IDE launches may produce silent call audio even when a stream exists. The app flags development launches and its sound check detects silence.

## First run

1. Save your OpenAI API key and run the tiny, billed setup checks.
2. Allow the microphone, pick your input and transcribe the test phrase.
3. Run the call-audio sound check with output unmuted.
4. Add your résumé or describe your experience and voice.
5. Choose a call type, add materials, confirm everyone is comfortable with transcription and AI notes, and start listening.

A sample call works without credentials or recording. During a real call the main window gives way to a floating panel; ending it opens the recap. Pin a suggestion, browse earlier ones, type a question, or use **Help me now**. The most recent suggestion appears automatically. Late suggestions stay in history.

Default global shortcuts, active while listening: Control + Option + Space for help; P to pause; [ / ] to browse; H to show or hide the panel. Resume from the panel. Shortcuts can be recorded in Settings. The panel is visible if you share your whole screen; share an individual meeting window to keep it outside that share.

PDF, DOCX, Markdown, text, CSV, VTT, SRT and JSON materials are supported: 10 MB per file and 2 MB extracted text per call. Scanned PDFs need pasted text. The last five calls can be reused. Their setup and material text are encrypted locally. A recap is kept only when **Bring this recap into the next call** is checked. Transcripts remain temporary unless exported. [Privacy details](docs/PRIVACY.md).

## Development and validation

Node 22.12 or later:

```sh
npm ci
npm run check
npm test
npm run replay
npm run demo
```

The browser sample runs on loopback only and never loads credentials. `npm start` is a development launch. `npm run dist:mac` builds a DMG and ZIP, including the Codex helper. Windows is outside the current supported scope.

`npm run replay` measures turn triggers and first paint with a deterministic offline provider. For **billed live measurements**, explicitly use `OPENAI_API_KEY` in your private environment and run `npm run replay -- --live --compare`. This compares GPT-5.6 Luna and GPT-6 Luna. The default remains GPT-5.6 Luna until measured live timing and answer quality justify switching. Settings → Advanced exposes models, editable cost rates, timing diagnostics and optional Codex, Fireflies and read-only custom context connections. Connected-app research runs before a call or when explicitly asked.

## Persistent signing and releases

Run `npm run signing:setup` once on your own Mac with a private `CALLWISE_SIGNING_PASSWORD` of at least 16 characters. The script stores a certificate outside the repository and refuses to overwrite an existing identity. Keep its private backup. Set repository Actions secrets **CALLWISE_SIGNING_P12** (base64 PKCS#12) and **CALLWISE_SIGNING_PASSWORD**. Reuse this exact certificate for every release.

After reviewing and tagging a version, run **Publish signed release** with the matching tag. It checks the app, imports the certificate into a temporary CI keychain, builds the DMG/ZIP, verifies the actual signed bundle and publishes durable GitHub Release downloads and checksums. It fails closed if no persistent identity is configured. Private keys are never committed or uploaded as artifacts. Test build N then N+1 on a real Mac to verify permission continuity.

[Architecture](docs/ARCHITECTURE.md) · [Validation and outstanding device checks](docs/VALIDATION.md) · [Changelog](CHANGELOG.md)
