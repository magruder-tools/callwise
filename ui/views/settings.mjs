import {
  escape,
  header,
  button,
  check,
  section,
} from "../components/common.mjs";
export const DEFAULT_KEYS = {
  help: "Control+Alt+Space",
  pause: "Control+Alt+P",
  previous: "Control+Alt+[",
  next: "Control+Alt+]",
  visibility: "Control+Alt+H",
};
export function settings(s, ui) {
  return `${header(s, "Settings")}<div class="settings-layout"><nav aria-label="Settings sections">${["General", "Audio", "AI", "Privacy", "Advanced"].map((t) => button("settings-tab", t, { className: ui.tab === t ? "selected" : "", attrs: `data-tab="${t}"` })).join("")}${button("close-settings", "Done", { className: "text-button" })}</nav><main class="settings-view"><h1>${ui.tab}</h1>${content(s, ui)}</main></div>`;
}
function field(
  id,
  label,
  value,
  {
    type = "text",
    pref = id,
    placeholder = "",
    help = "",
    limit = 2000,
    attrs = "",
  } = {},
) {
  return `<label class="field" for="${id}"><span>${label}</span><input id="${id}" ${pref ? `data-pref="${pref}"` : ""} ${attrs} type="${type}" value="${escape(value)}" maxlength="${limit}" placeholder="${escape(placeholder)}" autocomplete="off">${help ? `<small>${help}</small>` : ""}</label>`;
}
function content(s, ui) {
  const p = s.preferences;
  if (ui.tab === "General")
    return `${section("About you", `<label class="field" for="profile"><span>The experience and voice you want it to remember</span><textarea id="profile" data-pref="profile" maxlength="6000" rows="5">${escape(s.settings.profile)}</textarea></label>${field("userName", "Your name in meeting transcripts", s.settings.userName || "", { help: "Needed for pasted text or Fireflies. Your microphone is already labelled You." })}`)}${section("Panel", check("floatPanel", "Float above other apps", p.floatPanel !== false, "pref-switch"))}${section(
      "Shortcuts",
      `<p class="help">Click a shortcut and press Control + Option with a key.</p><div class="shortcut-list">${Object.entries(
        { ...DEFAULT_KEYS, ...p.hotkeys },
      )
        .map(
          ([action, key]) =>
            `<label>${{ help: "Help me now", pause: "Pause", previous: "Previous", next: "Next", visibility: "Show or hide panel" }[action]}<button type="button" data-action="record-shortcut" data-shortcut="${action}">${escape(key.replaceAll("Control", "Control").replaceAll("Alt", "Option").replaceAll("+", " + "))}</button></label>`,
        )
        .join("")}</div>`,
    )}${check("quiet", "Only help when I ask", s.settings.quiet, "pref-switch")}`;
  if (ui.tab === "Audio")
    return `${section("Microphone", `<label class="field" for="inputDevice"><span>Input device</span><select id="inputDevice" data-pref="inputDevice"><option value="">System default</option>${ui.devices.map((d) => `<option value="${escape(d.deviceId)}" ${p.inputDevice === d.deviceId ? "selected" : ""}>${escape(d.label || "Microphone")}</option>`).join("")}</select></label>${button("mic-permission", "Allow microphone")}${button("sound-mic", "Run microphone check")}`)}${section("Call audio", `<p>Play the test phrase through your speakers. Callwise should hear it through call audio.</p>${button("sound-system", "Run sound check")}${button("permissions-system", "Open System Settings", { className: "text-button" })}<p class="help">macOS may say Screen & System Audio Recording because the capture API also requests a display track. Callwise never reads video frames.</p>`)}<div class="sound-result" role="status">${ui.testChannel ? `Listening to ${ui.testChannel === "mic" ? "your microphone" : "call audio"}… Say “Callwise is ready for my call.”` : s.desktop?.soundResult || "Sound checks record only while you run them."}<p>${escape(s.desktop?.testText || "")}</p><div class="test-meter"><b id="meter-test"></b></div></div>${field("language", "Expected language", p.language || "en", { help: "ISO language code, for example en, es or fr.", limit: 10 })}`;
  if (ui.tab === "AI")
    return `${section("OpenAI", `<p>Save your API key here. It stays encrypted in the main process.</p>${field("openai-key", "API key", "", { type: "password", pref: "", placeholder: s.config.openaiReady ? "Saved. Enter a replacement to change it." : "Paste your API key", limit: 2048 })}<p class="help">Save and test makes two tiny billed model requests and opens a transcription session.</p>${button("save-key", ui.checking ? "Testing…" : "Save and test", { className: "primary", disabled: ui.checking || s.status === "running" })}${button("test-ai", "Test saved key", { disabled: ui.checking || !s.config.openaiReady || s.status === "running" })}<div role="status">${ui.testResults.map((r) => `<p class="test-result ${r.ok ? "passed" : "failed"}"><strong>${escape(r.label)}</strong> ${escape(r.detail)}${r.elapsedMs !== undefined ? ` (${r.elapsedMs} ms)` : ""}</p>`).join("")}</div>`)}`;
  if (ui.tab === "Privacy")
    return `${section("What is saved", `<p>Call setup and extracted material text are encrypted on this Mac. Recaps are saved only when you choose to bring them into another call.</p><p>Transcripts, suggestions and short audio buffers stay in memory. Exported files are your choice. Your audio and supplied context are sent to OpenAI while you run a call. No analytics or background listening.</p><p>The panel is visible when you share your whole screen. Share a single meeting window to keep it outside that share.</p>`)}${section("Delete local data", `<p>Remove saved calls, setup, credentials and diagnostic logs. Export anything you want to keep first.</p>${button("delete-everything", "Delete everything on this Mac", { className: "danger", disabled: s.status === "running" })}`)}`;
  return `${section("Models", `${field("fastModel", "Fast answers", s.config.fastModel, { pref: "", limit: 150, attrs: `data-model="fastModel" ${s.status === "running" ? "disabled" : ""}` })}${field("strategyModel", "Preparation and recaps", s.config.strategyModel, { pref: "", limit: 150, attrs: `data-model="strategyModel" ${s.status === "running" ? "disabled" : ""}` })}${field("transcriptionModel", "Live transcription", s.config.transcriptionModel, { pref: "", limit: 150, attrs: `data-model="transcriptionModel" ${s.status === "running" ? "disabled" : ""}` })}${button("reset-models", "Reset to recommended", { className: "text-button", disabled: s.status === "running" })}<p class="help">The fast model remains GPT-5.6 Luna until a live replay comparison supports changing it.</p>`)}${section("Transcription timing", `<label class="field" for="transcriptionDelay"><span>Partial transcript delay</span><select id="transcriptionDelay" data-pref="transcriptionDelay" ${s.status === "running" ? "disabled" : ""}>${["minimal", "low", "medium", "high"].map((value) => `<option value="${value}" ${(p.transcriptionDelay || "low") === value ? "selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select><small>Lower delay starts help sooner; test transcript accuracy for your names and language.</small></label>`)}${section("Diagnostics", `${check("debug", "Show response timing overlay", p.debug, "pref-switch")}${button("diagnostics", "Copy diagnostics")}`)}${section(
    "Estimated prices (USD)",
    `<div class="price-grid">${Object.entries(
      p.prices || {
        fastInput: 0.2,
        fastOutput: 1.2,
        deepInput: 10,
        deepOutput: 50,
        audioMinute: 0.017,
      },
    )
      .map(([key, value]) =>
        field(
          key,
          {
            fastInput: "Fast input / million tokens",
            fastOutput: "Fast output / million tokens",
            deepInput: "Deep input / million tokens",
            deepOutput: "Deep output / million tokens",
            audioMinute: "Transcription / audio minute",
          }[key],
          value,
          {
            type: "number",
            pref: "",
            limit: 10,
            attrs: `data-price="${key}" min="0" step="any" ${s.status === "running" ? "disabled" : ""}`,
          },
        ),
      )
      .join(
        "",
      )}</div><p class="help">These are estimates. Update for your model and account rates.</p>`,
  )}${section(
    "Alternate connections",
    `<details data-detail-key="connected-apps"><summary>Codex and connected apps</summary><p>Optional read-only research before a call.</p>${button("codex-signin", "Sign in with ChatGPT")}${button("discover-context", "Refresh apps")}<div>${(s.contextApps || []).map((a) => `<label class="check"><input type="checkbox" data-context-app="${escape(a.id)}" ${s.settings.contextApps.includes(a.id) ? "checked" : ""} ${!a.ready ? "disabled" : ""}><span>${escape(a.name || a.id)}</span></label>`).join("")}</div><label class="field">Context source<select id="contextBackend" data-pref="contextBackend"><option value="off" ${s.settings.contextBackend === "off" ? "selected" : ""}>Off</option><option value="codex" ${s.settings.contextBackend === "codex" ? "selected" : ""}>Codex connected apps</option><option value="mcp" ${s.settings.contextBackend === "mcp" ? "selected" : ""}>Custom read-only server</option></select></label>${check("contextConsent", "Allow selected sources for this call", s.settings.contextConsent, "pref-switch")}${check("autoSearch", "Look up related notes when I ask", s.settings.autoSearch, "pref-switch")}<p class="help">Custom server credentials remain in development configuration. Only explicit read-only searches run.</p></details><details data-detail-key="alternate-transcripts"><summary>Fireflies and pasted conversation</summary>${field("fireflies-key", "Fireflies API key", "", { type: "password", pref: "", limit: 2048 })}${button("save-fireflies", "Save Fireflies key")}<form id="fireflies-import"><label for="fireflies-id">Prior transcript ID</label><input id="fireflies-id" maxlength="200"><button type="submit">Import as material</button></form><label class="field">Call input<select id="preferredSource" data-pref="preferredSource">${[
      ["audio", "Mic and call audio"],
      ["manual", "Paste conversation text"],
      ["fireflies", "Fireflies live transcript"],
    ]
      .map(
        ([value, name]) =>
          `<option value="${value}" ${p.preferredSource === value ? "selected" : ""}>${name}</option>`,
      )
      .join(
        "",
      )}</select></label>${field("fireflies-live-id", "Live meeting transcript ID", ui.firefliesLiveId || "", { pref: "", limit: 200 })}<label class="field">Deeper answers<select id="preferredBackend" data-pref="preferredBackend"><option value="openai" ${p.preferredBackend !== "codex" ? "selected" : ""}>OpenAI</option><option value="codex" ${p.preferredBackend === "codex" ? "selected" : ""}>Codex</option></select></label><form id="transcript-form"><label for="speaker">Speaker</label><input id="speaker" value="Other" maxlength="100"><label for="transcript-text">Conversation text</label><textarea id="transcript-text" rows="3" maxlength="20000"></textarea><button type="submit" ${s.status !== "running" ? "disabled" : ""}>Add turn</button></form></details>`,
  )}`;
}
