import { state, viewState as ui } from "./state.mjs";
import { ready } from "./views/ready.mjs";
import { live } from "./views/live.mjs";
import { recap } from "./views/recap.mjs";
import { settings } from "./views/settings.mjs";
import { welcome } from "./views/welcome.mjs";
import { banner, errorBanner, escape, button } from "./components/common.mjs";
import { AudioCapture } from "./capture.mjs";
const root = document.getElementById("app"),
  panel =
    new URLSearchParams(window.location?.search || "").get("surface") ===
    "panel";
if (panel) document.body.classList.add("panel");
const browserBridge = () => ({
  desktop: false,
  command: async (name, payload = {}) => {
    const r = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, payload }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    return data.result;
  },
  onState: (callback) => {
    const events = new EventSource("/api/events");
    events.onmessage = (event) => callback(JSON.parse(event.data));
    return () => events.close();
  },
  onStopCapture: () => () => {},
});
const bridge = window.callwise || browserBridge();
let capture,
  recordingShortcut = null,
  renderQueued = false,
  lastStatus = "idle",
  testTimer,
  captureStarting = false,
  latestMeters = { mic: 0, system: 0 };
const report = (error) => {
  ui.notice = error?.message || String(error);
  render();
};
async function command(name, payload) {
  try {
    return await bridge.command(name, payload);
  } catch (error) {
    report(error);
    throw error;
  }
}
const run = (name, payload) => void command(name, payload).catch(() => {});
const field = (id) => document.getElementById(id)?.value || "";
async function patch(key, value) {
  await command("configure", { [key]: value });
}
const clipboard = async (text) => {
  if (bridge.desktop) await command("desktop.copy", { text });
  else await navigator.clipboard.writeText(text);
  ui.notice = "Copied.";
  render();
};
function receive(s) {
  if (ui.sessionId !== s.sessionId) {
    ui.sessionId = s.sessionId;
    ui.consent = false;
    ui.selectedId = null;
    ui.lastCardId = null;
    ui.transcript = false;
    ui.coverage = false;
    ui.prep = false;
  }
  if (s.status === "ended" && lastStatus !== "ended") ui.screen = "recap";
  if (s.status === "running" && lastStatus !== "running") ui.notice = "";
  if (["running", "paused"].includes(s.status) && ui.screen !== "settings")
    ui.screen = "live";
  if (s.status === "idle" && lastStatus !== "idle" && ui.screen !== "settings")
    ui.screen = "ready";
  if (
    !state.get() &&
    bridge.desktop &&
    !panel &&
    !s.preferences.setupDismissed &&
    (!s.desktop?.readiness?.ai ||
      !s.desktop?.readiness?.mic ||
      !s.desktop?.readiness?.system)
  )
    ui.screen = "welcome";
  if (s.desktop?.platform === "darwin") document.body.classList.add("mac");
  if (
    bridge.desktop &&
    !panel &&
    s.status === "running" &&
    s.source === "audio" &&
    lastStatus !== "running" &&
    !captureStarting
  )
    void startCapture(s);
  if (s.status !== "running" && lastStatus === "running") capture?.stop();
  lastStatus = s.status;
  state.set(s);
}
async function startCapture(s) {
  captureStarting = true;
  try {
    capture ||= new AudioCapture(
      bridge,
      meter,
      (message, channel) => run("capture.error", { message, channel }),
      (message) => {
        run("capture.notice", { message });
      },
    );
    await capture.start({ inputDevice: s.preferences.inputDevice });
  } catch (error) {
    run("pause");
    report(error);
  } finally {
    captureStarting = false;
  }
}
function meter(channel, rms) {
  latestMeters[channel] = rms;
  const node =
    document.getElementById(`meter-${channel}`) ||
    document.getElementById("meter-test");
  if (node) node.style.transform = `scaleX(${Math.min(1, rms * 12)})`;
  bridge.meter?.(channel, rms);
}
function clock() {
  const s = state.get();
  if (!s) return;
  const ms =
      s.activeTimeMs +
      (s.status === "running" ? Math.max(0, Date.now() - s.snapshotAt) : 0),
    seconds = Math.floor(ms / 1000),
    node = document.getElementById("call-time");
  if (node)
    node.textContent = `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
function render() {
  const s = state.get();
  if (!s) return;
  const active = document.activeElement,
    focus = active?.id,
    selection = active?.selectionStart,
    value = active?.value,
    scroll = root.scrollTop;
  const openDetails = new Set(
    [...root.querySelectorAll("details[data-detail-key][open]")].map(
      (n) => n.dataset.detailKey,
    ),
  );
  const preserved = {};
  for (const id of [
    "question",
    "openai-key",
    "fireflies-key",
    "material-text",
    "material-title",
    "fireflies-id",
    "transcript-text",
    "speaker",
    "mcpUrl",
    "mcpToken",
    "mcpSearchTool",
    "mcpSearchArguments",
  ])
    if (document.getElementById(id)) preserved[id] = field(id);
  const view = panel ? "live" : ui.screen;
  let content = { ready, live, recap, settings, welcome }[view](s, ui);
  const notices =
    (s.desktop && !s.desktop.packaged && !s.demoOnly
      ? banner(
          "Development run. Call audio may be silent. Install the app for real calls.",
          "",
          "",
          "warning",
        )
      : "") +
    (s.desktop?.update
      ? banner(
          `Callwise ${s.desktop.update.version} is available.`,
          "update",
          "Get update",
        )
      : "") +
    errorBanner(s) +
    (ui.notice && !s.errors.some((e) => e.message === ui.notice)
      ? banner(ui.notice, "dismiss-notice", "Dismiss")
      : "");
  root.innerHTML = notices + content;
  for (const node of root.querySelectorAll("details[data-detail-key]"))
    if (openDetails.has(node.dataset.detailKey)) node.open = true;
  for (const [id, text] of Object.entries(preserved))
    if (document.getElementById(id)) document.getElementById(id).value = text;
  const replacement = focus && document.getElementById(focus);
  if (replacement && (!document.hasFocus || document.hasFocus())) {
    if (value !== undefined && active?.tagName !== "SELECT")
      replacement.value = value;
    replacement.focus({ preventScroll: true });
    if (Number.isInteger(selection) && replacement.setSelectionRange)
      try {
        replacement.setSelectionRange(selection, selection);
      } catch {}
  }
  root.scrollTop = scroll;
  clock();
  for (const [channel, rms] of Object.entries(latestMeters))
    meterLocal(channel, rms);
  fitPanel();
}
function fitPanel() {
  if (panel && bridge.desktop)
    requestAnimationFrame(() =>
      run("desktop.panel.fit", {
        height: Math.min(
          1000,
          Math.max(320, document.getElementById("app").scrollHeight),
        ),
      }),
    );
}
root.addEventListener("toggle", fitPanel, true);
function meterLocal(channel, rms) {
  const node =
    document.getElementById(`meter-${channel}`) ||
    document.getElementById("meter-test");
  if (node) node.style.transform = `scaleX(${Math.min(1, rms * 12)})`;
}
state.subscribe(() => {
  if (renderQueued) return;
  renderQueued = true;
  (window.requestAnimationFrame || ((cb) => setTimeout(cb, 0)))(() => {
    renderQueued = false;
    render();
  });
});
bridge.onState(receive);
bridge.onStopCapture(() => capture?.stop());
bridge.onMeters?.(({ channel, rms }) => {
  latestMeters[channel] = rms;
  meterLocal(channel, rms);
});
bridge.onNavigate?.((data) => {
  if (data.retryAudio) {
    void capture?.retry(data.retryAudio);
    return;
  }
  if (data.screen) {
    ui.screen = data.screen;
    if (data.tab) ui.tab = data.tab;
    render();
  } else navigate(data.direction);
});
function navigate(direction) {
  const s = state.get(),
    cards = s.cards.filter(
      (c) => c.lane === "fast" && c.status !== "dismissed" && !c.late,
    ),
    i = cards.findIndex((c) => c.id === ui.selectedId);
  ui.selectedId =
    cards[
      Math.max(
        0,
        Math.min(cards.length - 1, i + (direction === "previous" ? -1 : 1)),
      )
    ]?.id;
  render();
}
async function sound(channel) {
  if (!bridge.desktop) {
    report("Sound checks are available in the installed app.");
    return;
  }
  if (state.get().status === "running")
    throw new Error("Pause the call before a sound check.");
  clearTimeout(testTimer);
  capture?.stop();
  await command("desktop.sound.begin", { channel });
  ui.testChannel = channel;
  render();
  capture ||= new AudioCapture(bridge, meter, (message) => report(message));
  try {
    await capture.start({
      inputDevice: state.get().preferences.inputDevice,
      channels: [channel],
    });
    if (channel === "system") await command("desktop.sound.play");
    testTimer = setTimeout(() => void endSound(), 12000);
  } catch (error) {
    await endSound();
    throw error;
  }
}
async function endSound() {
  clearTimeout(testTimer);
  capture?.stop();
  ui.testChannel = null;
  await command("desktop.sound.end");
  render();
}
async function testAI(save) {
  ui.checking = true;
  ui.testResults = [];
  render();
  try {
    if (save) {
      const key = field("openai-key");
      if (key.trim())
        await command("desktop.connections.save", { openaiKey: key });
      else if (!state.get().config.openaiReady)
        throw new Error("Paste your OpenAI API key first.");
      const node = document.getElementById("openai-key");
      if (node) node.value = "";
    }
    ui.testResults = await command("desktop.connections.test");
  } finally {
    ui.checking = false;
    render();
  }
}
async function act(action, node) {
  const s = state.get();
  switch (action) {
    case "call-type":
      await patch("mode", node.dataset.value);
      break;
    case "consent":
      ui.consent = node.checked;
      render();
      break;
    case "start":
      if (!ui.consent) return;
      await flushEdits();
      await command("start", {
        source: bridge.desktop
          ? s.preferences.preferredSource || "audio"
          : "audio",
        backend: s.preferences.preferredBackend || "openai",
        consent: true,
        transcriptId: ui.firefliesLiveId || "",
      });
      break;
    case "resume":
      await command("start", {
        source: s.source,
        backend: s.backend,
        consent: true,
      });
      break;
    case "retry-audio":
      await command("desktop.capture.retry");
      break;
    case "pause":
      await command("pause");
      break;
    case "end":
      await command("end");
      break;
    case "practice":
      await command("new", { clearContext: true });
      await command("start", { source: "demo" });
      break;
    case "new":
      await command("new", { clearContext: true });
      ui.screen = "ready";
      render();
      break;
    case "recent":
      await command("sheet.load", { id: node.dataset.id });
      break;
    case "help":
      await command("nudge");
      break;
    case "previous":
    case "next":
      navigate(action);
      break;
    case "pin":
      await command("card.pin", { id: node.dataset.id });
      break;
    case "not-useful":
      await command("feedback", { id: node.dataset.id, status: "dismissed" });
      break;
    case "transcript":
      ui.transcript = !ui.transcript;
      render();
      break;
    case "coverage":
      ui.coverage = !ui.coverage;
      render();
      break;
    case "paste":
      ui.paste = true;
      render();
      break;
    case "cancel-paste":
      ui.paste = false;
      render();
      break;
    case "remove-material":
      await command("context.remove", { id: node.dataset.id });
      break;
    case "import-profile":
      await command("desktop.profile.import");
      break;
    case "import":
      if (bridge.desktop) {
        const result = await command("desktop.import");
        ui.notice = result.message;
        render();
      } else {
        ui.paste = true;
        ui.notice = "Paste notes to try materials in the browser sample.";
        render();
      }
      break;
    case "view-prep":
      ui.prep = !ui.prep;
      render();
      break;
    case "research":
      await command("context.connected", { query: s.settings.goal });
      break;
    case "settings":
      if (panel) {
        await command("desktop.settings");
        break;
      }
      ui.screen = "settings";
      render();
      await listDevices();
      break;
    case "close-settings":
      ui.screen = ["running", "paused"].includes(s.status)
        ? "live"
        : s.status === "ended"
          ? "recap"
          : "ready";
      render();
      if (bridge.desktop) await command("desktop.settings.close");
      break;
    case "settings-tab":
      ui.tab = node.dataset.tab;
      render();
      if (ui.tab === "Audio") await listDevices();
      break;
    case "readiness":
      ui.screen = "welcome";
      ui.welcomeStep = node.dataset.target === "AI" ? 0 : 1;
      render();
      break;
    case "save-key":
      await testAI(true);
      break;
    case "test-ai":
      await testAI(false);
      break;
    case "replace-key":
      if (panel) await command("desktop.settings", { tab: "AI" });
      else {
        ui.screen = "settings";
        ui.tab = "AI";
        render();
      }
      break;
    case "open-billing":
      await command("desktop.openLink", {
        url: "https://platform.openai.com/settings/organization/billing/overview",
      });
      break;
    case "mic-permission":
      await command("desktop.mic.permission");
      await listDevices();
      break;
    case "sound-mic":
      await sound("mic");
      break;
    case "sound-system":
      await sound("system");
      break;
    case "permissions-system":
      await command("desktop.permissions.open", { pane: "system" });
      break;
    case "permissions-mic":
      await command("desktop.permissions.open", { pane: "mic" });
      break;
    case "welcome-next":
      ui.welcomeStep = Math.min(2, ui.welcomeStep + 1);
      render();
      if (ui.welcomeStep === 1) await listDevices();
      break;
    case "welcome-back":
      ui.welcomeStep = Math.max(0, ui.welcomeStep - 1);
      render();
      break;
    case "welcome-done":
    case "skip-setup":
      await patch("setupDismissed", true);
      ui.screen = "ready";
      render();
      break;
    case "copy-email":
      await clipboard(s.recap?.email || "");
      break;
    case "copy-recap": {
      const { recapText } = await command("recap.text");
      await clipboard(recapText);
      break;
    }
    case "export":
      if (bridge.desktop) await command("desktop.export");
      else {
        const text = await command("export"),
          url = URL.createObjectURL(
            new Blob([text], { type: "text/markdown" }),
          ),
          a = document.createElement("a");
        a.href = url;
        a.download = "callwise.md";
        a.click();
        URL.revokeObjectURL(url);
      }
      break;
    case "carry-recap":
      await command("recap.carry", { enabled: node.checked });
      break;
    case "pref-switch":
      await patch(node.id, node.checked);
      break;
    case "diagnostics":
      await command("desktop.diagnostics");
      ui.notice = "Diagnostics copied.";
      render();
      break;
    case "reset-models":
      await command("desktop.connections.save", {
        fastModel: "gpt-5.6-luna",
        strategyModel: "gpt-6-astra",
        transcriptionModel: "gpt-live-transcribe",
      });
      break;
    case "save-fireflies":
      await command("desktop.connections.save", {
        firefliesKey: field("fireflies-key"),
      });
      document.getElementById("fireflies-key").value = "";
      break;
    case "codex-signin":
      await command("desktop.codex.signin");
      ui.notice = "ChatGPT sign-in ready.";
      render();
      break;
    case "discover-context":
      await command("context.discover");
      break;
    case "record-shortcut":
      recordingShortcut = node.dataset.shortcut;
      node.classList.add("recording");
      node.textContent = "Press Control + Option + key";
      break;
    case "delete-everything":
      confirmDelete();
      break;
    case "confirm-delete":
      await command("desktop.delete");
      ui.screen = "welcome";
      ui.welcomeStep = 0;
      render();
      break;
    case "cancel-delete":
      document.getElementById("confirm-dialog")?.close();
      break;
    case "dismiss-error":
      await command("error.dismiss", { id: node.dataset.id });
      break;
    case "dismiss-notice":
      ui.notice = "";
      render();
      break;
    case "link":
      await command("desktop.openLink", { url: node.dataset.url });
      break;
    case "update":
      await command("desktop.openLink", { url: s.desktop.update.url });
      break;
  }
}
function confirmDelete() {
  const d = document.createElement("dialog");
  d.id = "confirm-dialog";
  d.innerHTML = `<h1>Delete everything on this Mac?</h1><p>Saved calls, materials, recaps, keys, setup and diagnostic logs will be removed. Exported files remain wherever you saved them.</p><div class="row">${button("cancel-delete", "Cancel")}${button("confirm-delete", "Delete everything", { className: "danger" })}</div>`;
  root.append(d);
  d.showModal();
}
async function listDevices() {
  if (bridge.desktop && navigator.mediaDevices?.enumerateDevices) {
    ui.devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "audioinput",
    );
    await command("desktop.devices", {
      ids: ui.devices.map((d) => d.deviceId),
    });
    render();
  }
}
root.addEventListener("click", (e) => {
  const node = e.target.closest("[data-action]");
  if (node && node.type !== "checkbox")
    void act(node.dataset.action, node).catch(report);
});
root.addEventListener("change", (e) => {
  const node = e.target;
  if (node.dataset.pref) {
    clearTimeout(edits.get(node.dataset.pref)?.timer);
    edits.delete(node.dataset.pref);
  }
  if (node.dataset.action && node.type === "checkbox")
    void act(node.dataset.action, node).catch(report);
  else if (node.dataset.pref)
    void patch(
      node.dataset.pref,
      node.type === "checkbox" ? node.checked : node.value,
    ).catch(() => {});
  else if (node.dataset.contextApp) {
    const ids = Array.from(
      document.querySelectorAll("[data-context-app]:checked"),
      (n) => n.dataset.contextApp,
    );
    void patch("contextApps", ids).catch(() => {});
  } else if (node.dataset.model) {
    void command("desktop.connections.save", {
      [node.dataset.model]: node.value,
    }).catch(() => {});
  } else if (node.dataset.connection) {
    void command("desktop.connections.save", {
      [node.dataset.connection]: node.value,
    })
      .then(() => {
        if (node.id === "mcpToken") node.value = "";
      })
      .catch(() => {});
  } else if (node.dataset.price) {
    void patch("prices", {
      ...state.get().preferences.prices,
      [node.dataset.price]: Number(node.value),
    }).catch(() => {});
  } else if (node.id === "fireflies-live-id") {
    ui.firefliesLiveId = node.value;
  }
});
const edits = new Map();
async function flushEdits() {
  const pending = [...edits.entries()];
  edits.clear();
  for (const [key, edit] of pending) {
    clearTimeout(edit.timer);
    await patch(key, edit.value);
  }
}
root.addEventListener("input", (e) => {
  const key = e.target.dataset.pref;
  if (!key || e.target.tagName === "SELECT") return;
  clearTimeout(edits.get(key)?.timer);
  const value = e.target.value;
  edits.set(key, {
    value,
    timer: setTimeout(() => {
      edits.delete(key);
      void patch(key, value).catch(() => {});
    }, 180),
  });
});
root.addEventListener("submit", (e) => {
  e.preventDefault();
  void (async () => {
    switch (e.target.id) {
      case "ask-form": {
        const question = field("question");
        if (!question.trim()) return;
        document.getElementById("question").value = "";
        await command("ask", { question });
        break;
      }
      case "material-form":
        await command("context.add", {
          title: field("material-title"),
          text: field("material-text"),
        });
        ui.paste = false;
        render();
        break;
      case "transcript-form":
        await command("transcript", {
          speaker: field("speaker"),
          text: field("transcript-text"),
        });
        document.getElementById("transcript-text").value = "";
        break;
      case "fireflies-import":
        await command("context.fireflies", { id: field("fireflies-id") });
        break;
    }
  })().catch(report);
});
root.addEventListener("dragover", (e) => {
  if (e.target.closest("#drop-zone")) {
    e.preventDefault();
    e.target.closest("#drop-zone").classList.add("drag-over");
  }
});
root.addEventListener("dragleave", (e) =>
  e.target.closest("#drop-zone")?.classList.remove("drag-over"),
);
root.addEventListener("drop", (e) => {
  if (!e.target.closest("#drop-zone")) return;
  e.preventDefault();
  if (bridge.desktop) {
    const paths = Array.from(e.dataTransfer.files, (f) => bridge.filePath(f));
    void command("desktop.import", { paths })
      .then((result) => {
        ui.notice = result.message;
        render();
      })
      .catch(() => {});
  } else {
    ui.paste = true;
    render();
  }
});
window.addEventListener("keydown", (e) => {
  if (recordingShortcut) {
    if (e.key === "Escape") {
      recordingShortcut = null;
      render();
      return;
    }
    if (
      e.ctrlKey &&
      e.altKey &&
      !e.metaKey &&
      !["Control", "Alt", "Shift"].includes(e.key)
    ) {
      e.preventDefault();
      const key = e.code === "Space" ? "Space" : e.key.toUpperCase(),
        action = recordingShortcut;
      recordingShortcut = null;
      void patch("hotkeys", {
        ...state.get().preferences.hotkeys,
        [action]: `Control+Alt+${e.shiftKey ? "Shift+" : ""}${key}`,
      }).catch(() => {});
    }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ui.screen === "ready") {
    e.preventDefault();
    void act("start", {}).catch(report);
  }
  if (
    e.ctrlKey &&
    e.altKey &&
    e.key.toLowerCase() === "p" &&
    state.get()?.status === "paused"
  ) {
    e.preventDefault();
    void act("resume", {}).catch(report);
  }
});
window.addEventListener("beforeunload", () => {
  clearTimeout(testTimer);
  capture?.stop();
});
setInterval(clock, 1000);
void command("state")
  .then(receive)
  .catch(() => {});
