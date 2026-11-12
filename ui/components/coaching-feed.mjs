import { escape as e, button as b } from "./common.mjs";

export function coachingFeed(s) {
  const cards = s.cards.filter((c) => c.status !== "dismissed");
  return `<section class="coaching-workspace" aria-label="Live coaching">
    <div class="coaching-heading"><div><h2>Live coaching</h2><p class="help">A sentence to start with. A few points to make it yours.</p></div>${b("coach-latest", "Latest ↓", { className: "text-button" })}${b("m-coach-floating", "Float window", { className: "text-button" })}</div>
    <div id="coaching-history" class="coaching-history" role="log" aria-live="off" tabindex="0" aria-label="Questions and coaching history">
    ${cards.map((c) => `<article class="coach-card history-card ${c.streaming ? "streaming" : ""} ${c.lane === "strategy" || c.kind === "bigger_picture" ? "deeper-card" : ""}" data-card-id="${e(c.id)}">
      <div class="card-heading"><div class="trigger"><span>${c.origin === "nudge" ? "You asked for help" : c.origin === "asked" ? "You asked" : c.trigger?.kind === "question" ? "They asked" : "They said"}</span> ${e(c.trigger?.text || c.question || "")}</div><span class="kind">${c.lane === "strategy" || c.kind === "bigger_picture" ? "Deeper advice" : "Quick answer"}${c.late ? " · arrived late" : ""}${c.streaming ? " · writing…" : ""}</span></div>
      <p class="lead">${e(c.lead || c.say || c.body || "")}</p>
      ${c.points?.length ? `<ul class="points">${c.points.map((p) => `<li><strong>${e(p.label)}</strong><span>${e(p.text)}</span></li>`).join("")}</ul>` : ""}
      ${c.more ? `<p class="coaching-detail">${e(c.more)}</p>` : ""}
      <footer class="card-footer"><div class="sources">${(c.sources || []).map((src, i) => `<details class="source" data-detail-key="history-source:${e(c.id)}:${e(src.id || String(i))}"><summary>${e(src.title || `Source ${i + 1}`)}</summary><p>${e(src.excerpt || "")}</p>${src.url ? b("link", "Open source", { attrs: `data-url="${e(src.url)}"` }) : ""}</details>`).join("")}</div>${b("pin", c.pinned ? "Pinned" : "Pin", { attrs: `data-id="${e(c.id)}" aria-pressed="${!!c.pinned}"`, className: "text-button" })}${b("not-useful", "Not useful", { attrs: `data-id="${e(c.id)}"`, className: "text-button" })}</footer>
    </article>`).join("") || '<div class="empty-coaching"><h3>Ready when the conversation needs it.</h3><p>Callwise waits for a finished thought before offering help. Ask below whenever you want a cue.</p></div>'}
    ${s.thinking.fast || s.thinking.strategy ? `<div class="coaching-pending" role="status">${s.thinking.fast ? "Finding useful words…" : "Thinking through the bigger picture…"}</div>` : ""}
    </div>
    <form id="ask-form" class="ask-row"><label for="question" class="sr-only">Ask your coach</label><input id="question" name="question" placeholder="Ask your coach…" maxlength="3000" autocomplete="off" ${s.status !== "running" ? "disabled" : ""}><button type="submit" ${s.status !== "running" ? "disabled" : ""}>Ask</button>${b("help", "Quick cue", { disabled: s.status !== "running" })}${b("deep-help", "Deeper advice", { disabled: s.status !== "running" || s.thinking.strategy })}</form>
  </section>`;
}
