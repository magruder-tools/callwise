import { SuggestionFocus } from "../suggestion-focus.mjs";
import { escape, button } from "./common.mjs";
const labels = {
  say: "Say",
  ask: "Ask",
  fact: "From your notes",
  heads_up: "Heads-up",
  bigger_picture: "Bigger picture",
};
export function card(s, ui) {
  const cards = s.cards.filter(
    (c) => c.lane === "fast" && c.status !== "dismissed" && !c.late,
  );
  const latest = cards.at(-1),
    pinned = cards.find((c) => c.pinned);
  ui.focus ||= new SuggestionFocus();
  ui.focus.sync(s.sessionId, cards);
  if (ui.selectedId && latest?.id === ui.lastCardId)
    ui.focus.select("fast", ui.selectedId);
  ui.lastCardId = latest?.id;
  const current = ui.focus.current.fast || pinned || latest;
  ui.selectedId = current?.id;
  const slow = s.cards
    .filter((c) => c.lane === "strategy" && c.status !== "dismissed")
    .at(-1);
  const pending = s.pendingTrigger;
  const waitingForNew =
    s.thinking.fast &&
    pending &&
    !current?.streaming &&
    s.pendingOrigin !== "auto";
  if (!current || waitingForNew)
    return `<article class="coach-card quiet"><div class="trigger">${s.thinking.fast ? `<span>${pending?.speaker === "You" ? (s.pendingOrigin === "nudge" ? "You asked for help" : "You asked") : pending?.kind === "question" ? "They asked" : "They said"}</span> ${escape(pending?.text || "Finding a useful next thought…")}` : ""}</div><h1 aria-live="polite">${s.thinking.fast ? '<span class="thinking" aria-label="Thinking"></span>' : "Nothing to add right now."}</h1><p>${s.thinking.fast ? "Finding useful words…" : "Your notes are ready when the conversation needs them."}</p></article>`;
  const pos = cards.indexOf(current) + 1;
  return `<article class="coach-card ${current.streaming ? "streaming" : ""}" data-card-id="${escape(current.id)}"><div class="card-heading"><div class="trigger" title="${escape(current.trigger?.text || current.question)}"><span>${current.origin !== "auto" ? (current.origin === "nudge" ? "You asked for help" : "You asked") : current.trigger?.kind === "question" ? "They asked" : "They said"}</span> ${escape(current.origin === "nudge" ? "" : current.trigger?.text || current.question || "")}</div><div class="kind ${current.kind === "heads_up" ? "warning" : ""}">${labels[current.kind] || "Say"}${current.streaming ? '<span class="thinking small" aria-label="Writing"></span>' : ""}</div></div><h1 class="lead" aria-live="polite" aria-atomic="true">${escape(current.lead || current.say || current.body)}</h1>${current.points?.length ? `<ul class="points">${current.points.map((p) => `<li><strong>${escape(p.label)}</strong><span>${escape(p.text)}</span></li>`).join("")}</ul>` : ""}${slow ? `<details class="bigger-picture" data-detail-key="bigger:${escape(slow.id)}"><summary>Bigger picture: ${escape(slow.lead || slow.body)}</summary><p>${escape(slow.more || "")}</p></details>` : ""}<footer class="card-footer"><div class="sources">${(current.sources || []).map((src, i) => `<details class="source" data-detail-key="source:${escape(current.id)}:${escape(src.id || String(i))}"><summary>${escape(src.title || `Source ${i + 1}`)}</summary><p>${escape(src.excerpt)}</p>${src.url ? button("link", "Open source", { attrs: `data-url="${escape(src.url)}"` }) : ""}</details>`).join("")}</div><div class="card-nav">${button("previous", "", { iconName: "left", title: "Previous suggestion", disabled: pos <= 1, className: "icon-button" })}<span>${pos} of ${cards.length}</span>${button("next", "", { iconName: "right", title: "Next suggestion", disabled: pos >= cards.length, className: "icon-button" })}${button("pin", current.pinned ? "Pinned" : "Pin", { iconName: "pin", attrs: `data-id="${escape(current.id)}" aria-pressed="${!!current.pinned}"` })}${button("not-useful", "Not useful", { attrs: `data-id="${escape(current.id)}"`, className: "text-button" })}</div></footer></article>`;
}
