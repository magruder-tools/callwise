# Calm sidebar — 0.4.0

The live view follows the supplied light sidebar reference: warm white surfaces, dark text, evergreen actions, one stable suggestion, Worth considering, and separate transcript/history and call controls. Default size is 440 × 820, minimum 380 × 660. Long advice scrolls within its own reading area.

## Codex apps

Open the gear menu, then **Codex apps**. The screen distinguishes checking, sign-in required, connected with access off, enabled, and errors. Existing sign-in is reused. Connecting runs discovery automatically; opening a recently checked screen reuses the successful check for two minutes. Refresh forces a fresh check, shows progress, and keeps existing app choices visible if it fails.

Choose up to 12 ready apps and select **Use selected apps**. That explicit action saves both the selection and read-only access for future calls. **Turn off app access** disables searches while retaining the selection. **Search my apps** becomes available immediately after access is enabled. Search entry points route disabled access to this setup instead of a dead-end error. API keys, model configuration, and the optional direct MCP source remain available separately.

Saved apps appear first. **Add apps** and the name filter expose other available choices. Discovery does not grant access by itself. Automatic lookup remains optional and requires a named client or project. Current integration supports connected apps exposed by Codex's app APIs, not arbitrary local plugins, skills, or computer-control tools.

Read-only policy validation, original-source evidence checks, maximum 12 selected apps, existing scope limits, encrypted saved preferences, and call-capture consent remain in force. No call recording starts during setup or discovery. Window activation restores a hidden/minimized existing window.

Validation: 128 tests pass, including one-action enablement followed by recreation, sign-in-to-discovery sequencing, cancellation/refresh behavior, and permission preservation. Native offline previews verified at both window sizes.

Searches show progress, prevent duplicate submits, and can be cancelled. A turn that makes no completed, verified app call reports a connection failure rather than no matches. Context retrieval uses GPT-5.5 separately from the selected coaching model: the bundled Codex 0.153.4 / GPT-6 Astra path returned empty sources without any app calls during native integration checks. Query data includes explicit app IDs and requests contiguous verbatim source text. A live Google Drive query returned one source with its excerpt and original link verified against the completed read-only tool response. No global Codex configuration or app permissions were changed by the retrieval fix.

On cold launch the gear menu and selection area show the saved app count before discovery returns, rather than implying the saved selection was lost. The installed app reopened with all ten selected apps enabled.
