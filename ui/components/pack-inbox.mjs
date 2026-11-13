import { escape as e, button as b } from "./common.mjs";
export function packInbox(s) {
  if (!s.packs) return "";
  const waiting = s.packs.reduce((n, p) => n + p.cards - p.approved, 0), estimate = s.prepEstimate;
  return `<section class="section round3" aria-label="Prep packs"><div class="row"><h2>Prep packs</h2>${b("r3-copy-prompt", "Copy prep prompt", { className: "text-button" })}</div>
    <p class="help">Prepare with your files here, or ask your assistant to send a Callwise pack. Cards appear during a call after you approve them.</p>
    ${waiting ? `<p role="status">${waiting} ${waiting === 1 ? "card is" : "cards are"} waiting for review.</p>` : ""}
    <div id="pack-drop-zone" class="drop-zone" tabindex="0" role="button" aria-label="Add a prep pack">${b("r3-import", "Add prep pack")}<span>or drop a pack.json, folder or zip here</span></div>
    <div class="row">${b("r3-build", s.preparing ? "Preparing…" : "Build cards from my materials", { disabled: !!s.preparing || !s.context?.length })}</div>
    ${estimate ? `<p class="help">Estimated prep cost: $${estimate.cost.toFixed(3)} · ${estimate.chunks} sections · ${estimate.characters.toLocaleString()} characters.</p>${estimate.cost > estimate.threshold && !s.preparing ? b("r3-confirm-prep", `Prepare for about $${estimate.cost.toFixed(2)}`, { className: "primary" }) : ""}` : ""}
    ${s.prepProgress ? `<p role="status">${e(s.prepProgress.title)} · ${s.prepProgress.completed} / ${s.prepProgress.total}</p>` : ""}
    <ul class="round3-list">${s.packs.map((p) => `<li class="stage-card"><div class="row"><strong>${e(p.title)}</strong><span class="stage-tag">${e(p.status.replaceAll("_", " "))}</span></div><p class="help">${p.cards} cards · ${p.approved} approved · ${p.gaps} gaps${p.meetingStart ? ` · ${e(new Date(p.meetingStart).toLocaleString())}` : ""}${p.updatePending ? " · Update waiting for review" : ""}</p><div class="row">${b("r3-review", "Review", { attrs: `data-pack-id="${e(p.id)}"` })}${b("r3-use", "Use for next meeting", { attrs: `data-pack-id="${e(p.id)}"` })}${b("r3-rehearse", "Rehearse", { disabled: !p.approved, attrs: `data-pack-id="${e(p.id)}"` })}${b("r3-remove", "Remove", { className: "text-button", attrs: `data-pack-id="${e(p.id)}"` })}</div></li>`).join("")}</ul>
    ${(s.attachOffers || []).map((o) => `<div class="banner"><span>Calendar match: ${e(o.event.title)}</span>${b("r3-attach-calendar", "Use this meeting", { attrs: `data-pack-id="${e(o.packId)}" data-event-id="${e(o.event.id)}"` })}</div>`).join("")}
    <p class="help">Watched folder: ${s.watchFolder?.enabled ? e(s.watchFolder.path) : "Off"}. Source files stay in place.</p><div class="row">${b("r3-watch-choose", s.watchFolder?.enabled ? "Change prep folder" : "Choose prep folder", { className: "text-button" })}${s.watchFolder?.enabled ? b("r3-watch-disable", "Stop watching", { className: "text-button" }) : ""}</div></section>`;
}
