import { escape as e, button as b } from "./common.mjs";

// The Stage: the live coaching screen. One question, one sentence to say,
// a few cues to glance at. It reads the round-3 `stage` contract when the
// engine provides it, and falls back to today's coaching cards otherwise.

const FILLER =
  /^(?:so|okay|ok|right|well|and|but|great|alright|all right|now|then|um+|uh+|yeah|that's great|that is great|thanks|thank you)\b[,.\s]*/i;

// Display-only cleanup until the engine supplies trigger.question.
export function cleanQuestion(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return "";
  const sentences = text.match(/[^.!?？]+[.!?？]*/g)?.map((x) => x.trim()) || [text];
  while (sentences.length > 1 && sentences[0].split(/\s+/).length <= 3)
    sentences.shift();
  let out = sentences.join(" ");
  for (let i = 0; i < 4; i++) out = out.replace(FILLER, "");
  out = out.trim();
  return out ? out[0].toUpperCase() + out.slice(1) : text;
}

const SOURCE_TAGS = {
  prepared: ["Prepared", "prepared"],
  prepared_closest: ["Closest match", "prepared"],
  live: ["Live", "live"],
  none: ["No source", "none"],
  fact: ["Fact", "fact"],
};

function legacyCard(c) {
  if (!c) return null;
  const tag =
    c.kind === "heads_up"
      ? ["Heads-up", "warning"]
      : c.origin === "asked" || c.origin === "hotkey"
        ? ["You asked", "asked"]
        : c.origin === "nudge"
          ? ["You asked for help", "asked"]
          : c.sources?.length
            ? ["From your notes", "live"]
            : null;
  return {
    id: c.id,
    say: c.lead || c.say || c.body || "",
    frame: null,
    cues: (c.points || []).map((p) => ({ label: p.label, text: p.text })),
    askBack: null,
    proof: c.proof || null,
    sources: c.sources || [],
    tag: c.late ? ["Arrived late", "none"] : tag,
    pinned: !!c.pinned,
    streaming: !!c.streaming,
    question: cleanQuestion(c.trigger?.question || (c.origin === "auto" ? c.trigger?.text : c.question || c.trigger?.text) || ""),
    rawQuestion: c.trigger?.text || c.question || "",
    asked: c.origin !== "auto",
  };
}

function contractCard(c, fallbackQuestion) {
  if (!c) return null;
  return {
    id: c.id,
    say: c.say || "",
    frame: c.frame?.length ? c.frame : null,
    cues: c.cues || [],
    askBack: c.askBack || null,
    proof: c.proof || null,
    sources: c.sources || [],
    tag: SOURCE_TAGS[c.source] || null,
    pinned: !!c.pinned,
    streaming: !!c.streaming,
    question: fallbackQuestion,
    rawQuestion: "",
    asked: false,
  };
}

// Normalise either data shape into what the Stage draws.
export function stageModel(s, ui = {}) {
  const deeper = s.cards
    .filter((c) => c.status !== "dismissed" && (c.lane === "strategy" || c.kind === "bigger_picture"))
    .at(-1);
  if (s.stage) {
    const st = s.stage;
    const q = st.question?.clean || cleanQuestion(st.question?.raw);
    return {
      phase: st.phase,
      question: q,
      rawQuestion: st.question?.raw || "",
      current: contractCard(st.current, q),
      earlier: (st.earlier || []).map((x) => ({ id: x.id, question: x.question, say: x.say })),
      readyNext: st.readyNext || [],
      notice: st.notice || null,
      pending: null,
      deeper,
      viewingOlder: false,
      speed: st.speed || null,
    };
  }
  const fast = s.cards.filter(
    (c) => c.status !== "dismissed" && c.lane !== "strategy" && c.kind !== "bigger_picture",
  );
  const latest = fast.at(-1);
  // A card the user chose stays until a newer card arrives.
  if (ui.stageSelect && (ui.stageSelect.latestId !== latest?.id || !fast.some((c) => c.id === ui.stageSelect.id)))
    ui.stageSelect = null;
  const chosen =
    (ui.stageSelect && fast.find((c) => c.id === ui.stageSelect.id)) ||
    fast.findLast((c) => c.pinned) ||
    latest;
  const current = legacyCard(chosen);
  const pendingTrigger = s.thinking?.fast ? s.pendingTrigger : null;
  const pending = pendingTrigger
    ? {
        question:
          pendingTrigger.speaker === "You"
            ? s.pendingOrigin === "nudge"
              ? "Finding something useful to say"
              : cleanQuestion(pendingTrigger.text)
            : cleanQuestion(pendingTrigger.question || pendingTrigger.text),
      }
    : null;
  return {
    phase: pending ? "listening" : current ? "final" : "idle",
    question: current?.question || "",
    rawQuestion: current?.rawQuestion || "",
    current,
    earlier: fast
      .filter((c) => c.id !== chosen?.id)
      .reverse()
      .map((c) => ({ id: c.id, question: legacyCard(c).question, say: c.lead || c.say || c.body || "" })),
    readyNext: [],
    notice: null,
    pending,
    deeper,
    viewingOlder: !!chosen && chosen.id !== latest?.id && !chosen.pinned,
    speed: null,
  };
}

const CUE_ICONS = {
  number: "hash",
  person: "user",
  decision: "pencil",
  caution: "alert",
  ask: "question",
  time: "clock",
  money: "hash",
  place: "pin",
};

function cue(c) {
  const name = CUE_ICONS[c.icon];
  return `<li class="cue">${name ? stageIcon(name) : ""}${c.label ? `<span class="cue-label">${e(c.label)}</span>` : ""}<span>${e(c.text)}</span></li>`;
}

const PATHS = {
  hash: '<path d="M9 4 7 20M17 4l-2 16M4 9h17M3 15h17"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z"/>',
  alert: '<path d="M12 4 3 19.5h18L12 4ZM12 10v4.5M12 17.2v.3"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.5a2.4 2.4 0 1 1 3.3 2.2c-.7.4-1 .9-1 1.8M12 16.7v.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  speech: '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10l5-3v10l-5-3Z"/>',
  layers: '<path d="m12 4 9 4.5-9 4.5-9-4.5L12 4ZM3 12.5l9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
};
export const stageIcon = (name, size = 16) =>
  `<svg class="stage-icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ""}</svg>`;

function proofTile(p) {
  if (!p) return "";
  if (p.type === "number_bars")
    return `<figure class="proof proof-number" aria-label="${e(p.label || p.value)}"><div><div class="proof-value">${e(p.value)}</div><figcaption>${e(p.label || "")}</figcaption></div><div class="proof-bars" aria-hidden="true"><span class="bar before"></span><span class="bar after"></span><small>Before</small><small>After</small></div></figure>`;
  if (p.type === "beats")
    return `<figure class="proof proof-beats" aria-label="${e(p.title || "Story")}">${(p.beats || [])
      .map((x, i) => `${i ? `<span class="beat-arrow" aria-hidden="true">${stageIcon("arrow", 14)}</span>` : ""}<div class="beat ${x.highlight ? "highlight" : ""}"><small>${e(x.label)}</small><strong>${e(x.text)}</strong></div>`)
      .join("")}</figure>`;
  if (p.type === "scope")
    return `<figure class="proof proof-scope" aria-label="${e(p.title || "Scope")}">${(p.stats || [])
      .map((x) => `<div><div class="proof-value">${e(x.value)}</div><figcaption>${e(x.label)}</figcaption></div>`)
      .join("")}</figure>`;
  return "";
}

function sayCard(m) {
  const c = m.current;
  const tag = c.tag ? `<span class="stage-tag ${e(c.tag[1])}">${e(c.tag[0])}</span>` : "";
  const body = c.frame
    ? `<ol class="stage-frame" aria-label="Start with">${c.frame.map((step) => `<li>${e(step)}</li>`).join("")}</ol>`
    : `<p class="stage-say" aria-live="polite" aria-atomic="true">${e(c.say)}${c.streaming ? '<span class="thinking small" aria-label="Writing"></span>' : ""}</p>`;
  return `<section class="stage-card" data-card-id="${e(c.id)}" aria-label="Say this">
    <div class="stage-card-head"><span class="stage-label">${stageIcon("speech")}${c.frame ? "Start with" : "Say"}</span>${tag}</div>
    ${m.notice ? `<p class="stage-notice">${e(m.notice.kind === "heard_unclear" ? `I heard: “${m.notice.text}”. Waiting for the question.` : m.notice.text || "The model is slow. Showing the closest prepared card.")}</p>` : ""}
    ${body}
  </section>`;
}

function glance(c) {
  const items = [...c.cues.slice(0, 3).map(cue), c.askBack ? cue({ icon: "ask", label: "Ask back", text: c.askBack }) : ""].join("");
  return items
    ? `<section class="stage-glance" aria-label="Glance"><span class="stage-label subtle">${stageIcon("eye")}Glance</span><ul class="cues">${items}</ul></section>`
    : "";
}

function cardFooter(c, m) {
  return `<div class="stage-card-actions">
    ${(c.sources || [])
      .map(
        (src, i) =>
          `<details class="source" data-detail-key="stage-source:${e(c.id)}:${e(src.id || String(i))}"><summary>${e(src.title || `Source ${i + 1}`)}</summary>${src.excerpt ? `<p>${e(src.excerpt)}</p>` : ""}${src.url ? b("link", "Open source", { attrs: `data-url="${e(src.url)}"` }) : ""}</details>`,
      )
      .join("")}
    <span class="spacer"></span>
    ${m.viewingOlder ? b("m-stage-latest", "Back to latest", { className: "text-button accent" }) : ""}
    ${b("pin", c.pinned ? "Pinned" : "Pin", { className: "text-button", attrs: `data-id="${e(c.id)}" aria-pressed="${c.pinned}"` })}
    ${b("not-useful", "Not useful", { className: "text-button", attrs: `data-id="${e(c.id)}"` })}
  </div>`;
}

function center(s, m) {
  const pending = m.pending
    ? `<div class="stage-next" role="status"><span class="pulse" aria-hidden="true"></span><span><strong>They're asking</strong> ${e(m.pending.question)}</span></div>`
    : "";
  if (!m.current)
    return `${pending}<div class="stage-empty">${
      m.pending
        ? `<p class="stage-question">${e(m.pending.question)}</p><div class="stage-card skeleton" aria-label="Finding words"><span></span><span></span></div>`
        : `<h2>Ready when they ask.</h2><p>A sentence to say appears here the moment a question lands. Ask below whenever you want a cue.</p>`
    }</div>`;
  const c = m.current;
  return `${pending}<div class="stage-focus ${m.pending ? "is-previous" : ""}">
    <header class="stage-q"><span class="stage-label subtle">${m.pending ? "Last question" : c.asked ? "You asked" : "They asked"}</span><h1 class="stage-question" title="${e(m.rawQuestion)}">${e(m.question || "Your question")}</h1></header>
    ${sayCard(m)}
    ${glance(c)}
    ${proofTile(c.proof)}
    ${cardFooter(c, m)}
  </div>`;
}

function askRow(s) {
  const off = s.status !== "running";
  return `<form id="ask-form" class="stage-ask"><label for="question" class="sr-only">Ask your coach</label><input id="question" name="question" placeholder="Ask your coach anything…" maxlength="3000" autocomplete="off" ${off ? "disabled" : ""}>${b("help", "Quick cue", { disabled: off })}${b("deep-help", "Deeper advice", { disabled: off || s.thinking.strategy })}<button type="submit" class="primary" ${off ? "disabled" : ""}>Ask</button></form>`;
}

function leftRail(m) {
  const earlier = m.earlier.length
    ? `<section class="rail-section" aria-label="Earlier"><h2 class="rail-title">Earlier</h2><ol class="earlier-list">${m.earlier
        .slice(0, 12)
        .map(
          (x) =>
            `<li><button type="button" class="earlier-item" data-action="m-stage-select" data-id="${e(x.id)}" data-row-id="earlier-${e(x.id)}"><span class="earlier-q">${e(x.question || "Your question")}</span><span class="earlier-say">${e(x.say)}</span></button></li>`,
        )
        .join("")}</ol></section>`
    : "";
  const ready = m.readyNext.length
    ? `<section class="rail-section" aria-label="Ready next"><h2 class="rail-title">Ready next</h2><ul class="ready-list">${m.readyNext
        .slice(0, 4)
        .map((x) => `<li>${e(x.question)}</li>`)
        .join("")}</ul></section>`
    : "";
  return `<aside class="stage-rail stage-left">${ready}${earlier || '<p class="rail-empty">Earlier questions collect here, newest first.</p>'}</aside>`;
}

function rightRail(s, m) {
  const d = m.deeper;
  const deeper = s.thinking.strategy
    ? `<section class="deeper-note" role="status"><span class="stage-label subtle">${stageIcon("layers")}Bigger picture</span><p class="help">Thinking it through…</p></section>`
    : d
      ? `<section class="deeper-note" data-card-id="${e(d.id)}"><span class="stage-label subtle">${stageIcon("layers")}Bigger picture</span><p class="deeper-lead">${e(d.lead || d.body || "")}</p>${d.more && d.more !== d.lead ? `<p class="deeper-more">${e(d.more)}</p>` : ""}<div class="row">${b("pin", d.pinned ? "Pinned" : "Pin", { className: "text-button", attrs: `data-id="${e(d.id)}" aria-pressed="${!!d.pinned}"` })}${b("not-useful", "Not useful", { className: "text-button", attrs: `data-id="${e(d.id)}"` })}</div></section>`
      : "";
  return `<aside class="stage-rail stage-right"><div class="call-slot" aria-hidden="true">${stageIcon("video", 22)}<span>Room for your call window</span></div>${deeper}</aside>`;
}

// The full-height in-call screen. `chrome` holds the top bar pieces the
// notebook already knows how to build (status, tabs, actions, receipts).
export function stage(s, ui, chrome) {
  const m = stageModel(s, ui);
  return `<main class="stage-view" aria-label="Live coaching">
    ${chrome.topBar}
    <div class="stage-grid">
      ${leftRail(m)}
      <section class="stage-center" aria-label="Current answer">
        <div class="stage-scroll">${center(s, m)}</div>
        ${askRow(s)}
      </section>
      ${rightRail(s, m)}
    </div>
    ${chrome.footer}
  </main>`;
}
