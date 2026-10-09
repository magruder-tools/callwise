import { AudioCapture, describeAudioCapture } from "./capture.mjs";
import { connectionControls } from "./connections.mjs";
import { SuggestionFocus } from "./suggestion-focus.mjs";
const focus = new SuggestionFocus();
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
  sourceUrl = "",
  localError = null,
  displayedError = null,
  errorSequence = 0;
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
  localError = {
    id: `local:${++errorSequence}`,
    message,
    at: Date.now(),
    expiresAt: Date.now() + 30000,
  };
  drawError();
}
function drawError() {
  if (localError?.expiresAt <= Date.now()) localError = null;
  const active = (state?.errors || []).filter(
    (error) => error.expiresAt === null || error.expiresAt > Date.now(),
  );
  displayedError = [...active, ...(localError ? [localError] : [])]
    .sort((a, b) => a.at - b.at)
    .at(-1);
  $("error-box").hidden = !displayedError;
  $("error-message").textContent = displayedError?.message || "";
  $("error-box").classList.toggle(
    "warning",
    displayedError?.severity === "warning",
  );
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

function cardAge(card) {
  const earlier = card.expiresAt <= Date.now();
  return earlier ? "Earlier · check relevance" : "From this conversation";
}
function drawCards(lane) {
  const card = focus.current?.[lane];
  const pending = focus.pending(lane).length;
  const next = $(`next-${lane}`);
  next.disabled = !pending;
  next.textContent = pending
    ? `${pending} new ${lane === "fast" ? (pending === 1 ? "suggestion" : "suggestions") : pending === 1 ? "insight" : "insights"}`
    : lane === "fast"
      ? "New suggestion"
      : "New insight";
  if (lane === "fast")
    next.textContent = pending ? `${pending} new` : "New suggestion";
  const container = $(`${lane}-cards`);
  // Keep the same DOM node while reading: selection, scroll and Details survive.
  if (container.dataset.cardId !== (card?.id || "empty")) {
    container.dataset.cardId = card?.id || "empty";
    container.replaceChildren();
    if (!card) {
      const empty = document.createElement("div");
      empty.className = "empty-card";
      empty.innerHTML = `<span class="empty-mark" aria-hidden="true">${lane === "fast" ? "✦" : "·"}</span><p>${lane === "fast" ? "Stay with the conversation." : "Space for a bigger thought."}</p><small>${lane === "fast" ? "New suggestions appear automatically. Keep one to hold it here." : "Deeper advice will wait here when it adds something."}</small>`;
      container.append(empty);
      return;
    }
    const article = document.createElement("article");
    article.className = `coaching-card ${lane === "strategy" ? "strategy" : ""}`;
    article.dataset.cardId = card.id;
    const spoken = lane === "fast" && card.say;
    const lead = spoken || card.title;
    article.innerHTML = `<div class="card-scroll">${card.origin === "asked" ? `<p class="card-question">You asked: ${esc(card.question)}</p>` : card.origin === "hotkey" ? '<p class="card-question">You asked for help</p>' : ""}<div class="card-meta"><span>${card.demo ? "DEMO · " : ""}${esc(card.kind)}</span><span class="card-age"></span></div><h3 class="card-lead">${esc(lead)}</h3><p class="card-summary">${esc(card.reason)}</p><details class="advice-details"><summary>Details${card.sources.length ? ` · ${card.sources.length} ${card.sources.length === 1 ? "source" : "sources"}` : ""}</summary>${spoken ? `<h4>${esc(card.title)}</h4>` : ""}${lane === "strategy" && card.say ? `<p class="card-body">“${esc(card.say)}”</p>` : ""}<p class="card-body">${esc(card.body)}</p><div class="card-sources"></div></details></div><div class="card-actions"><button class="keep-button" type="button">Keep</button><button class="dismiss-button" type="button">Dismiss</button></div>`;
    for (const source of card.sources) {
      const button = document.createElement("button");
      button.className = "source-chip";
      button.textContent = source.title;
      button.addEventListener("click", () =>
        openSource(source.id, source.excerpt),
      );
      article.querySelector(".card-sources").append(button);
    }
    article
      .querySelector(".keep-button")
      .addEventListener("click", () =>
        act("feedback", { id: card.id, status: "accepted" }),
      );
    article.querySelector(".dismiss-button").addEventListener("click", () => {
      focus.dismiss(lane);
      drawCards(lane);
      if (card.status !== "accepted")
        void act("feedback", { id: card.id, status: "dismissed" });
    });
    container.append(article);
  }
  if (card) {
    container.querySelector(".card-age").textContent = cardAge(card);
    const keep = container.querySelector(".keep-button");
    keep.textContent = card.status === "accepted" ? "✓ Kept" : "Keep";
    keep.disabled = card.status === "accepted";
  }
}
function drawHistory() {
  const list = $("advice-history-list");
  list.replaceChildren();
  if (!state.cards.length) {
    list.textContent =
      "Your suggestions will be collected here during the call.";
    return;
  }
  for (const card of [...state.cards].reverse()) {
    const row = document.createElement("article");
    row.className = "history-item";
    row.innerHTML = `<div class="card-meta"><span>${card.lane === "fast" ? "Next move" : "Worth considering"} · ${card.status === "accepted" ? "Kept" : card.status === "dismissed" ? "Dismissed" : "Suggestion"}</span><span>${esc(cardAge(card))}</span></div><h3>${esc(card.say || card.title)}</h3><p>${esc(card.body)}</p>`;
    if (card.status !== "dismissed") {
      const open = document.createElement("button");
      open.className = "secondary-button";
      open.textContent = "Show in call";
      open.addEventListener("click", () => {
        focus.select(card.lane, card.id);
        drawCards(card.lane);
        $("advice-history-dialog").close();
        if (card.lane === "strategy") $("insights-dialog").showModal();
      });
      row.append(open);
    }
    list.append(row);
  }
}

function render(next) {
  const sessionChanged = state?.sessionId !== next.sessionId;
  state = next;
  document.body.classList.toggle("desktop", !!bridge.desktop);
  if (sessionChanged) {
    $("source").value = state.preferences?.preferredSource || "demo";
    $("backend").value = state.preferences?.preferredBackend || "openai";
    $("consent").checked = false;
  }
  if (bridge.desktop) {
    compact = !!state.preferences?.compact;
    document.body.classList.toggle("compact", compact);
    $("compact").setAttribute("aria-pressed", String(compact));
  }
  focus.sync(state.sessionId, state.cards);
  if (sessionChanged) {
    for (const lane of ["fast", "strategy"])
      $(`${lane}-cards`).dataset.cardId = "";
    localError = null;
    $("advice-history-dialog").close();
  }
  $("advice-count").textContent = state.cards.length;
  const insights = state.cards.filter(
    (c) => c.lane === "strategy" && c.status !== "dismissed",
  ).length;
  $("insights-count").textContent = insights ? `· ${insights}` : "";
  $("capture-summary").textContent =
    state.status === "running"
      ? state.source === "demo"
        ? "Demo · no recording"
        : state.source === "audio"
          ? describeAudioCapture(state.capture)
          : "Receiving conversation text"
      : "Nothing is being captured";
  const running = state.status === "running",
    paused = state.status === "paused",
    ended = state.status === "ended";
  $("status-label").textContent = state.connecting
    ? "Connecting…"
    : running
      ? state.source === "demo"
        ? "Demo in progress"
        : Object.values(state.capture).includes("reconnecting")
          ? "Reconnecting…"
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
  $("start").hidden = running || state.connecting;
  $("pause").hidden = !running && !state.connecting;
  $("end").hidden = !running && !paused && !state.connecting;
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
    ? "Considering the conversation…"
    : running
      ? "Listening for a useful moment"
      : "Suggestions stay until you move on";
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
      el.className = `transcript-row ${row.speaker === "You" ? "you" : ""} ${row.final ? "" : "partial"} ${row.gap ? "gap" : ""}`;
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
  drawError();
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
function configure(event) {
  const id = event.target.id;
  const field =
    { source: "preferredSource", backend: "preferredBackend" }[id] || id;
  return act("configure", {
    [field]: id === "quiet" ? $(id).checked : $(id).value,
  });
}
for (const id of ["mode", "goal", "project", "quiet", "source", "backend"])
  $(id).addEventListener("change", configure);
$("source").addEventListener("change", updateSource);
$("start").addEventListener("click", async () => {
  if (state.status === "ended") {
    const result = await act("new", { clearContext: state.source === "demo" });
    if (result) {
      $("consent").checked = false;
      render(result);
    }
    return;
  }
  if ($("source").value !== "demo" && !$("consent").checked) {
    $("setup-dialog").showModal();
    toast("Confirm participant consent in call setup, then start when ready.");
    return;
  }
  const source = $("source").value;
  $("start").disabled = true;
  const result = await act("start", {
    source,
    backend: $("backend").value,
    consent: $("consent").checked,
    transcriptId: $("fireflies-id").value,
  });
  if (result) {
    if (result.status === "running") localError = null;
    render(result);
    if (result.status === "running") $("setup-dialog").close();
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
$("settings-open").addEventListener("click", () => {
  $("settings-dialog").showModal();
});
$("save-profile").addEventListener("click", async () => {
  const result = await act("configure", { profile: $("profile").value });
  if (result)
    toast(
      bridge.desktop
        ? "Preferences saved on this Mac."
        : "Preferences kept until this demo closes.",
    );
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
  if (result) {
    if (result.imported) $("context-dialog").close();
    if (result.message) toast(result.message);
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
  $("compact").setAttribute("aria-pressed", String(compact));
  if (bridge.desktop) await act("desktop.compact", { enabled: compact });
  else
    toast("Compact layout enabled. The desktop app can float above your call.");
});

$("more-open").addEventListener("click", () => $("more-dialog").showModal());
for (const button of $("more-dialog").querySelectorAll("button"))
  button.addEventListener("click", () => $("more-dialog").close());
$("connections-shortcut").addEventListener("click", () =>
  $("settings-open").click(),
);
$("export-shortcut").addEventListener("click", () => $("export").click());
$("copy-diagnostics").hidden = !bridge.desktop;
$("copy-diagnostics").addEventListener("click", async () => {
  if ((await act("desktop.diagnostics"))?.copied)
    toast("Diagnostics copied. No keys or call content included.");
});
$("error-dismiss").addEventListener("click", () => {
  const error = displayedError;
  localError = null;
  if (error && !error.id.startsWith("local:"))
    void act("error.dismiss", { id: error.id });
  else drawError();
});
bridge.onNavigate?.(({ direction }) => {
  focus.navigate("fast", direction);
  drawCards("fast");
});
window.addEventListener("keydown", (event) => {
  if (
    event.ctrlKey &&
    event.altKey &&
    event.key.toLowerCase() === "p" &&
    state?.status === "paused"
  ) {
    event.preventDefault();
    $("start").click();
  }
});
$("insights-open").addEventListener("click", () =>
  $("insights-dialog").showModal(),
);

for (const id of ["setup-open"])
  $(id).addEventListener("click", () => $("setup-dialog").showModal());
$("transcript-open").addEventListener("click", () =>
  $("transcript-dialog").showModal(),
);
$("advice-history-open").addEventListener("click", () => {
  drawHistory();
  $("advice-history-dialog").showModal();
});
for (const lane of ["fast", "strategy"])
  $(`next-${lane}`).addEventListener("click", () => {
    focus.advance(lane);
    drawCards(lane);
  });

setInterval(() => {
  if (!state) return;
  $("clock").textContent = timestamp(
    (state.activeTimeMs || 0) +
      (state.status === "running"
        ? Math.max(0, Date.now() - state.snapshotAt)
        : 0),
  );
  drawError();
  drawCards("fast");
  drawCards("strategy");
}, 1000);
window.addEventListener("beforeunload", () => capture.stop());
bridge.onState(render);
const initial = await act("state");
if (initial) render(initial);
