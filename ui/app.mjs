import { AudioCapture } from "./capture.mjs";
import { connectionControls } from "./connections.mjs";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const bridge = window.callwise || {
  desktop: false,
  async command(name, payload = {}) {
    const response = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, payload }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data.result;
  },
  onState(callback) {
    const stream = new EventSource("/api/events");
    stream.onmessage = (event) => callback(JSON.parse(event.data));
    stream.onerror = () => {
      $("status-label").textContent = "Demo connection interrupted";
    };
    return () => stream.close();
  },
  onStopCapture() {
    return () => {};
  },
};
let state,
  toastTimer,
  fastSignature = "",
  strategySignature = "",
  transcriptSignature = "",
  contextSignature = "",
  compact = false,
  sourceUrl = "";
const capture = new AudioCapture(
  bridge,
  (channel, rms) => {
    $(`meter-${channel}`).style.width = `${Math.min(100, rms * 600)}%`;
  },
  (message) => {
    void act("pause");
    showError(message);
  },
);
bridge.onStopCapture(() => capture.stop());
function showError(message) {
  $("error-box").textContent = message;
  $("error-box").hidden = false;
  toast(message, true);
}
function toast(message, error = false) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  $("toast").style.borderColor = error ? "#ad7051" : "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5000);
}
async function act(name, payload = {}) {
  try {
    return await bridge.command(name, payload);
  } catch (e) {
    showError(e.message);
    return null;
  }
}
const connections = connectionControls(bridge, { toast, showError });
const timestamp = (ms) =>
  `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function drawCards(lane) {
  const all = state.cards.filter(
    (c) => c.lane === lane && c.status !== "dismissed",
  );
  const cards = all
    .filter((c) => c.status === "accepted" || c.expiresAt > Date.now())
    .slice(-2)
    .reverse();
  const signature = JSON.stringify(cards.map((c) => [c.id, c.status]));
  if ((lane === "fast" ? fastSignature : strategySignature) === signature)
    return;
  if (lane === "fast") fastSignature = signature;
  else strategySignature = signature;
  const container = $(`${lane}-cards`);
  container.replaceChildren();
  if (!cards.length) {
    container.innerHTML = `<div class="empty-card ${lane === "strategy" ? "strategy" : ""}"><span class="empty-symbol" aria-hidden="true">${lane === "fast" ? "✧" : "⌘"}</span><div><strong>${lane === "fast" ? "The right thought, at the right time." : "A second perspective, working in the background."}</strong><p>${lane === "fast" ? "Useful questions, relevant facts, and words you can make your own." : "Space to notice assumptions, connect context, and think a few steps ahead."}</p></div></div>`;
    return;
  }
  for (const card of cards) {
    const article = document.createElement("article");
    article.className = `coaching-card ${lane === "strategy" ? "strategy" : ""}`;
    article.innerHTML = `<div class="card-meta"><span>${card.demo ? "SCRIPTED DEMO · " : ""}${esc(card.kind)}</span><small>${(card.latencyMs / 1000).toFixed(1)}s · ${card.sources.length ? "SOURCE LINKED" : "SUGGESTION"}</small></div><h3>${esc(card.title)}</h3><p class="card-body">${esc(card.body)}</p>${card.say ? `<div class="say">“${esc(card.say)}”</div>` : ""}<div class="card-sources"></div><div class="card-actions"></div>`;
    for (const source of card.sources) {
      const button = document.createElement("button");
      button.className = "source-chip";
      button.textContent = `▤ ${source.title}`;
      button.addEventListener("click", () =>
        openSource(source.id, source.excerpt),
      );
      article.querySelector(".card-sources").append(button);
    }
    const actions = article.querySelector(".card-actions");
    if (card.status === "accepted") {
      const label = document.createElement("span");
      label.className = "feedback-saved";
      label.textContent = "✓ Marked useful";
      actions.append(label);
    } else
      for (const [label, status] of [
        ["✓ Useful", "accepted"],
        ["Dismiss", "dismissed"],
      ]) {
        const button = document.createElement("button");
        button.textContent = label;
        button.addEventListener("click", () =>
          act("feedback", { id: card.id, status }),
        );
        actions.append(button);
      }
    const why = document.createElement("button");
    why.className = "why";
    why.textContent = "Why this?";
    why.addEventListener("click", () => toast(card.reason));
    actions.append(why);
    container.append(article);
  }
}

function render(next) {
  state = next;
  const running = state.status === "running",
    paused = state.status === "paused",
    ended = state.status === "ended";
  $("status-label").textContent = state.connecting
    ? "Connecting…"
    : running
      ? state.source === "demo"
        ? "Demo in progress"
        : "Session active"
      : paused
        ? "Session paused"
        : ended
          ? "Session ended"
          : "Ready when you are";
  $("status-dot").className =
    `dot ${running ? "running" : paused ? "paused" : ""}`;
  $("start").disabled = running || state.connecting;
  $("start").innerHTML = ended
    ? "＋ New session"
    : paused
      ? "▶ Resume"
      : $("source").value === "demo"
        ? "▶ Start demo"
        : "▶ Start session";
  $("pause").disabled = !running && !state.connecting;
  $("end").disabled = !running && !paused && !state.connecting;
  for (const id of [
    "source",
    "backend",
    "mode",
    "goal",
    "project",
    "quiet",
    "profile",
    "save-profile",
    "auto-search",
  ])
    $(id).disabled = running || state.connecting;
  for (const id of ["ask-submit", "transcript-submit", "deep-think"])
    $(id).disabled = !running || state.connecting;
  for (const button of document.querySelectorAll(".prompt-chip"))
    button.disabled = !running;
  if (running || paused) {
    $("source").value = state.source;
    $("backend").value = state.backend;
  }
  for (const [id, value] of [
    ["mode", state.settings.mode],
    ["goal", state.settings.goal],
    ["project", state.settings.project],
    ["profile", state.settings.profile],
  ])
    if (document.activeElement !== $(id)) $(id).value = value;
  $("quiet").checked = state.settings.quiet;

  $("fast-status").textContent = state.thinking.fast
    ? "Finding a useful next thought…"
    : running
      ? "Watching for what matters"
      : "Ready for your conversation";
  $("strategy-status").textContent = state.thinking.strategy
    ? "Thinking through the bigger picture…"
    : running
      ? state.source === "demo"
        ? "Scripted strategy demo"
        : state.backend === "codex"
          ? "Astra via Codex"
          : "Astra via API"
      : "Room for a deeper thought";
  for (const lane of ["fast", "strategy"])
    $(`${lane}-status`).classList.toggle("thinking", state.thinking[lane]);
  $("usage").textContent =
    `${state.metrics.fastCalls} / ${state.limits.fast} fast · ${state.metrics.strategyCalls} / ${state.limits.strategy} strategic requests`;
  $("retention").textContent =
    state.backend === "codex" && state.source !== "demo"
      ? "Callwise is in-memory; Codex manages its own retention"
      : "Session stays in memory until you export";
  $("transcript-footnote").textContent = running
    ? state.source === "demo"
      ? "Synthetic conversation · no audio captured"
      : state.source === "audio"
        ? "Two audio channels · no saved audio"
        : "Receiving text · no local audio capture"
    : "Nothing is being captured";
  for (const [channel, key] of [
    ["mic", "mic-label"],
    ["system", "system-label"],
  ])
    $(key).textContent =
      state.source === "demo" && running
        ? "demo"
        : state.capture[channel] || "off";
  const tSignature = JSON.stringify(
    state.transcript.map((r) => [r.id, r.text, r.final]),
  );
  if (tSignature !== transcriptSignature) {
    transcriptSignature = tSignature;
    const list = $("transcript");
    const nearBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 90;
    list.replaceChildren();
    if (!state.transcript.length)
      list.innerHTML =
        '<div class="transcript-empty"><span>〰</span><strong>The conversation starts here.</strong><p>Try the demo to watch context turn into useful questions and strategic advice.</p></div>';
    for (const row of state.transcript) {
      const el = document.createElement("div");
      el.className = `transcript-row ${row.speaker === "You" ? "you" : ""} ${row.final ? "" : "partial"}`;
      el.innerHTML = `<header><span class="avatar">${esc(row.speaker.slice(0, 1))}</span><span>${esc(row.speaker)}</span><time>${timestamp(row.startMs)}</time></header><p>${esc(row.text)}</p>`;
      list.append(el);
    }
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }
  $("transcript-count").textContent = state.transcript.length;
  const cSignature = JSON.stringify(state.context);
  if (cSignature !== contextSignature) {
    contextSignature = cSignature;
    const list = $("context-list");
    list.replaceChildren();
    if (!state.context.length)
      list.innerHTML =
        '<p class="muted micro">Add a brief, notes, or a past transcript. Suggestions can cite the originals.</p>';
    for (const doc of state.context) {
      const button = document.createElement("button");
      button.className = "context-item";
      button.innerHTML = `<span class="file-icon">▤</span><span><strong>${esc(doc.title)}</strong><small>${esc(doc.kind)} · ${(doc.characters / 1000).toFixed(1)}k characters</small></span>`;
      button.addEventListener("click", () => openSource(doc.id));
      list.append(button);
    }
  }
  $("context-count").textContent = state.context.length;
  for (const [id, ready, no] of [
    ["openai-status", state.config.openaiReady, "Key needed"],
    ["fireflies-status", state.config.firefliesReady, "Optional"],
    ["mcp-status", state.config.mcpReady, "Not connected"],
  ]) {
    $(id).textContent = ready ? "Configured" : no;
    $(id).classList.toggle("ready", ready);
  }
  $("model-labels").textContent =
    `Fast: ${state.config.fastModel || "gpt-5.6-luna"} · Strategy: ${state.config.strategyModel || "gpt-6-astra"}`;
  $("import-file").disabled = !bridge.desktop;
  connections.sync(state);
  if (state.errors.length) {
    $("error-box").textContent = state.errors.at(-1).message;
    $("error-box").hidden = false;
  }
  drawCards("fast");
  drawCards("strategy");
  updateSource();
  if (!running) capture.stop();
}
function updateSource() {
  const source = $("source").value;
  $("demo-notice").hidden = source !== "demo";
  $("live-consent").hidden = source === "demo";
  $("fireflies-field").hidden = source !== "fireflies";
  if (state?.status === "idle")
    $("start").textContent =
      source === "demo" ? "▶ Start demo" : "▶ Start session";
}
async function openSource(id, excerpt) {
  const doc = await act("context.get", { id });
  if (!doc) return;
  $("source-title").textContent = doc.title;
  $("source-text").textContent = [
    doc.provenance
      ? `Retrieved from ${doc.provenance.appName} • ${doc.provenance.action}\nRetrieved at: ${doc.retrievedAt} (not the source modification date)\n`
      : "",
    excerpt || doc.text,
  ]
    .filter(Boolean)
    .join("\n");
  sourceUrl = doc.url;
  $("source-link").hidden = !sourceUrl;
  $("source-dialog").showModal();
}
function configure() {
  return act("configure", {
    mode: $("mode").value,
    goal: $("goal").value,
    project: $("project").value,
    quiet: $("quiet").checked,
    profile: $("profile").value,
  });
}
for (const id of ["mode", "goal", "project", "quiet"])
  $(id).addEventListener("change", configure);
$("source").addEventListener("change", updateSource);
$("start").addEventListener("click", async () => {
  $("error-box").hidden = true;
  if (state.status === "ended") {
    const result = await act("new", { clearContext: state.source === "demo" });
    if (result) {
      $("source").value = "demo";
      $("consent").checked = false;
      render(result);
    }
    return;
  }
  if (!(await configure())) return;
  const source = $("source").value;
  $("start").disabled = true;
  const result = await act("start", {
    source,
    backend: $("backend").value,
    consent: $("consent").checked,
    transcriptId: $("fireflies-id").value,
  });
  if (result) {
    render(result);
    if (source === "audio" && result.status === "running")
      try {
        await capture.start();
      } catch (e) {
        await act("pause");
        showError(e.message);
      }
  } else $("start").disabled = false;
});
$("pause").addEventListener("click", () => {
  capture.stop();
  void act("pause");
});
$("end").addEventListener("click", () => {
  capture.stop();
  void act("end");
});
$("ask-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = $("question").value.trim();
  if (!question) return;
  $("question").value = "";
  await act("ask", { question });
});
for (const button of document.querySelectorAll("[data-question]"))
  button.addEventListener("click", () =>
    act("ask", { question: button.dataset.question }),
  );
$("deep-think").addEventListener("click", () =>
  act("ask", {
    lane: "strategy",
    question:
      $("question").value.trim() ||
      "What important assumption, tradeoff, or strategic next step am I missing?",
  }),
);
$("transcript-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("transcript-text").value.trim();
  if (!text) return;
  const result = await act("transcript", { text, speaker: $("speaker").value });
  if (result) $("transcript-text").value = "";
});
$("settings-open").addEventListener("click", () =>
  $("settings-dialog").showModal(),
);
$("save-profile").addEventListener("click", async () => {
  const result = await configure();
  if (result) toast("Preferences saved for this session.");
});
$("add-context").addEventListener("click", () =>
  $("context-dialog").showModal(),
);
$("context-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await act("context.add", {
    title: $("context-title").value,
    text: $("context-text").value,
    url: $("context-url").value,
    project: state.settings.project,
  });
  if (result) {
    $("context-dialog").close();
    $("context-form").reset();
    toast("Source added to this session.");
  }
});
$("import-file").addEventListener("click", async () => {
  const result = await act("desktop.import");
  if (result?.imported) {
    $("context-dialog").close();
    toast(`${result.imported} source(s) added.`);
  }
});
$("context-search-open").addEventListener("click", () =>
  $("search-dialog").showModal(),
);
$("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("search-result").textContent = "Searching…";
  const result = await act("context.connected", {
    query: $("context-query").value,
  });
  $("search-result").textContent = result
    ? result.added !== undefined
      ? `${result.added} verified source(s) added. ${result.retrieval?.detail || ""}`
      : "Results added as a source for this session."
    : "Search unavailable. Check your connections.";
});
$("history-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("search-result").textContent = "Importing…";
  const result = await act("context.fireflies", { id: $("history-id").value });
  $("search-result").textContent = result
    ? "Transcript added as a source."
    : "Import unavailable. Check your Fireflies connection.";
});
$("source-link").addEventListener("click", () => {
  if (bridge.desktop) void act("desktop.openLink", { url: sourceUrl });
  else window.open(sourceUrl, "_blank", "noopener,noreferrer");
});
$("export").addEventListener("click", async () => {
  if (bridge.desktop) {
    const result = await act("desktop.export");
    if (result?.saved) toast("Session exported.");
    return;
  }
  const text = await act("export");
  if (typeof text !== "string") return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "callwise-demo.md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("compact").addEventListener("click", async () => {
  compact = !compact;
  document.body.classList.toggle("compact", compact);
  if (bridge.desktop) await act("desktop.compact", { enabled: compact });
  else
    toast("Compact layout enabled. The desktop app can float above your call.");
});
setInterval(() => {
  if (!state) return;
  $("clock").textContent = timestamp(
    state.startedAt
      ? Math.max(0, (state.stoppedAt || Date.now()) - state.startedAt)
      : 0,
  );
  drawCards("fast");
  drawCards("strategy");
}, 1000);
window.addEventListener("beforeunload", () => capture.stop());
bridge.onState(render);
const initial = await act("state");
if (initial) render(initial);
