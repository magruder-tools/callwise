# Callwise: connected context through Codex

**Implemented September 6, 2026.** This is an experimental integration, not a claim that a live search has already been tested against Matthew's accounts. The code, offline regression tests, setup UI, and a credential-free handshake/configuration probe against Codex CLI 0.153.4 have been verified. Actual account-specific retrieval and Mac audio still need a practice run.

## What it does

Callwise can discover the apps available to your local Codex ChatGPT sign-in, let you choose saved sources for future calls, and ask a separate Codex process to retrieve evidence. That evidence is added to the same context store the coach already uses. The fast coaching lane does not wait for connector searches.

This does **not** mean every app visible in ChatGPT will necessarily be callable through your installed Codex version. Discovery checks accessibility, enabled state, read-only tool metadata, and installed runtime availability. A lookup rechecks availability for its restricted thread. No ChatGPT memory or past-chat import is implemented.

## Get it running on your Mac

1. Use the latest source in `magruder-tools/callwise`, not the earlier unsigned development ZIP. In the Callwise folder, run `npm ci` and `npm start`.
2. Codex CLI must be installed and signed in with the same ChatGPT account that has your apps. The tested CLI version is **0.153.4**. Installation/update: `npm install -g @openai/codex@0.153.4`, followed by `codex login`. Being signed into the Codex desktop app alone does not prove that the `codex` command is available to Callwise. A nonstandard CLI location can be set with `CALLWISE_CODEX_BIN` in the existing private `.env.local` configuration.
3. After trying the demo, click **End**, then **New session**. Set a descriptive **Context scope**, such as a client or project name. Open **Connections** and click **Find my apps**.
4. Under **Connected context**, choose **My connected apps through Codex**. Select the ready apps appropriate for this call. Check **Allow selected read-only sources for this and future calls**, then **Save context preferences**. Nothing is selected or authorized automatically.
5. Start with **Search connected context** in the sidebar. Ask a question whose answer you already know, such as “What did we agree in the last call about the campaign transition?” Open the returned source excerpt. Use **Open original** when an associated original link is available.
6. Once that works, optionally enable **Look up prior context when the conversation calls for it** and apply the choices. Then choose **Microphone + computer**, confirm permitted transcription/assistance, and use a practice call. Your regular OpenAI API key is still needed for live transcription and fast coaching; the standalone Codex context lookup does not require a new OpenAI key.

Selecting Codex for context and selecting Codex for strategy are independent. Start with your already working strategy backend. No separate Gmail/Drive/Notion API keys are collected by this bridge.

## How retrieval behaves

- Manual lookups work before the call or during a live session, once you explicitly allow sources. Connected searches are blocked during the fictional demo.
- Automatic retrieval is opt-in, needs a named scope, and uses a small English-language cue detector for references to earlier decisions, emails, notes, proposals, or previous calls. It is intentionally selective, not comprehensive. Use manual search when it misses a cue.
- At most 20 Codex lookups are attempted per session. Automatic lookups have a 45-second cooldown. Matching results are cached for three minutes; negative results for 45 seconds. A lookup has a 45-second deadline and an eight-tool-call target with interruption when the observed budget is exceeded. An already-started tool call cannot be retroactively undone by that interruption.
- The current strategic request prioritizes the excerpts just retrieved. Later fast/strategic requests can retrieve them from the session's local context. A failed or cancelled lookup does not stop ordinary coaching using loaded context.
- Pause, End, Cancel lookup, configuration changes, and New session invalidate in-flight results. New sessions do not retain connector documents or lookup caches. Switching clients after a conversation has started requires a new session.

## Safety and evidence boundaries

The retrieval thread uses default-deny app configuration and enables only selected tools that Codex explicitly identifies as read-only. It overrides inherited per-tool approvals, disables other apps, configured MCP servers, plugins, shell/browser/computer tools, local-image tools, memories and hooks, and declines interactive approval/permission requests. These are per-thread overrides; Callwise does not write global Codex settings or grant new account access.

Tool metadata is still supplied by the provider: this is not independent verification that a third-party tool implements its declared behavior. Managed/user restrictions can block a lookup. Callwise does not silently relax them.

Only completed tool results with matching connector/action identity and a true runtime read-only hint can support an imported excerpt. Excerpts must appear in actual result text; model-only recollections and fabricated snippets are rejected. An original URL is attached only when it is found in the same structured result record as the excerpt. Unstructured text can still support a source excerpt, but its original link is withheld when that association cannot be verified. These checks verify provenance, not the truth, relevance, completeness, or freshness of everything a source says.

The **Context scope** steers searches and partitions local cache/retrieval. It is **not** a server-side folder, client, or email permission boundary: a selected app may have access to the entire connected account. Only select accounts appropriate for the conversation.

Relevant call excerpts and the project/question go to Codex and may become search queries. Retrieved excerpts go to the configured coaching provider when used as evidence. Callwise retains connector results in memory by default. Explicit session exports may include those excerpts and provenance. Codex and connected providers have their own retention behavior; ephemeral threads and local in-memory storage are not a zero-retention guarantee.

## Validation and next gate

`npm test` covers policy enforcement, fabricated excerpts and links, same-record URL association, discovery pagination, runtime blocks, cancellation/timeouts, budgets/cache isolation, no cross-session imports, fast-lane independence, UI selection/consent, key-button wiring, and actual HTTP delivery of the new UI assets.

`scripts/codex-contract.mjs` runs the real CLI with a new empty home/config directory, verifies the handshake, empty app metadata/runtime requests, and restrictive thread configuration. It **never starts an inference turn** or loads the user's credentials. The GitHub **Codex protocol contract** workflow repeats this against the pinned tested CLI version.

A Chromium synthetic UI fixture was inspected at 1250-pixel and 440-pixel widths: no JavaScript errors, correct selected/disabled app states, and no horizontal dialog overflow. This is not a live-account or native macOS test.

The remaining live gate: sign into Codex on Matthew's Mac; discover his actual apps; select a small set; retrieve one known record; verify its excerpt and any original link; cancel a second lookup; then run a practice call. If an app is unavailable or provenance is missing, leave it unselected and use an imported source or the existing configured read-only MCP path instead. Do not treat a green code test as proof of account access.

## Primary protocol references

- OpenAI Codex App Server: https://developers.openai.com/codex/app-server
- OpenAI Codex configuration reference: https://developers.openai.com/codex/config-reference
- Inspected CLI: `codex-cli 0.153.4`, public package `@openai/codex@0.153.4`, September 6, 2026.

