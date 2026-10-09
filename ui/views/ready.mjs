import {
  escape,
  header,
  button,
  check,
  section,
} from "../components/common.mjs";
import { chips } from "../components/chips.mjs";
const types = {
  interview: "Interview",
  sales: "Sales",
  client: "Client",
  negotiation: "Negotiation",
  general: "Something else",
};
const examples = {
  interview:
    "Second interview at Brightline for Head of Growth. Show I can run paid media end to end.",
  sales:
    "Discovery call with Harbor Dental. Find out why leads dropped and book the audit.",
  client: "Monthly check-in with Northwind. Agree the Q4 budget.",
  negotiation: "Agree the scope and a fair price for the next quarter.",
  general: "Who is it with, and what do you want out of it?",
};
export function ready(s, ui) {
  const mode = s.settings.mode === "strategy" ? "client" : s.settings.mode;
  return `${header(s)}<main class="ready-view"><div class="intro"><h1>A little clearer, before you speak.</h1><p>Your notes and a quiet second thought, right when you need them.</p></div>${section(
    "What kind of call is it?",
    `<div class="segmented" role="group" aria-label="Call type">${Object.entries(
      types,
    )
      .map(([value, label]) =>
        button("call-type", label, {
          className: mode === value ? "selected" : "",
          attrs: `data-value="${value}" aria-pressed="${mode === value}"`,
        }),
      )
      .join("")}</div>`,
  )}${section("Who is it with, and what do you want out of it?", `<label class="sr-only" for="goal">Call goal</label><input id="goal" data-pref="goal" type="text" maxlength="2000" value="${escape(s.settings.goal)}" placeholder="${escape(examples[mode])}" autocomplete="off">`)}${section("Give it something to work from", `<p class="help">Optional. PDF, Word, notes or a past transcript.</p><div id="drop-zone" class="drop-zone" tabindex="0" role="button" aria-label="Add files or paste notes">${button("import", "Add files", { iconName: "plus" })}${button("paste", "Paste text", { className: "text-button" })}<span>or drop files here</span></div>${chips(s.context)}${ui.paste ? `<form id="material-form" class="inline-form"><label for="material-title">Name</label><input id="material-title" maxlength="200" value="Notes"><label for="material-text">Paste your text</label><textarea id="material-text" rows="5" maxlength="2000000" required></textarea><div class="row">${button("cancel-paste", "Cancel", { className: "text-button" })}<button type="submit" class="primary">Add notes</button></div></form>` : ""}${s.retrieval?.status === "searching" ? '<p class="help">Finding related notes…</p>' : ""}${s.settings.contextConsent && s.settings.contextBackend !== "off" ? button("research", "Find related notes in my apps", { className: "text-button" }) : ""}${s.prep || s.preparing ? `<div class="prep-row"><span>${s.preparing ? "Preparing your notes…" : "Your prep is ready"}</span>${button("view-prep", ui.prep ? "Close" : "View", { disabled: s.preparing, className: "text-button" })}</div>` : ""}${ui.prep && s.prep ? prep(s.prep) : ""}`)}<div class="start-area">${check("consent", "Everyone on this call is fine with transcription and AI notes", ui.consent, "consent")}<div class="row"><button id="start" type="button" data-action="start" class="primary large" ${!ui.consent || s.connecting ? "disabled" : ""}>${s.connecting ? "Connecting…" : "Start listening"}</button><span class="help" id="start-reason">${!ui.consent ? "Confirm permission to start." : "Command + Enter to start"}</span></div></div>${
    s.sheets?.length
      ? section(
          "Recent",
          `<div class="recent">${s.sheets
            .slice(0, 5)
            .map((c) =>
              button("recent", c.name, {
                attrs: `data-id="${escape(c.id)}"`,
                className: "recent-call",
              }),
            )
            .join("")}</div>`,
        )
      : ""
  }<footer class="ready-footer">${button("practice", "Practice with a sample call", { className: "text-button" })}<span>Setup and materials saved encrypted. Audio stays temporary.</span></footer></main>`;
}
function prep(p) {
  return `<div class="prep-details">${p.people?.length ? `<h3>People</h3><p>${p.people.map(escape).join("; ")}</p>` : ""}<h3>To cover</h3><ul>${p.myPoints.map((x) => `<li>${escape(x.text)}</li>`).join("")}</ul><h3>From your notes</h3>${p.facts.map((f) => `<p>${escape(f.text)} <small>${f.sourceIds.map(escape).join(", ")}</small></p>`).join("")}<h3>Likely questions</h3>${p.likelyQuestions.map((q) => `<p><strong>${escape(q.question)}</strong><br>${escape(q.outline)}</p>`).join("")}<h3>Watch for</h3><ul>${p.watchFor
    .map(escape)
    .map((x) => `<li>${x}</li>`)
    .join("")}</ul></div>`;
}
