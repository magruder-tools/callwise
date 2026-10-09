import {
  escape,
  header,
  button,
  check,
  section,
} from "../components/common.mjs";
export function recap(s) {
  const r = s.recap;
  return `${header(s, "Call recap")}<main class="recap-view"><div class="recap-heading"><div><h1>${escape(s.settings.goal || "A clearer next step")}</h1><p>${s.recapping ? "Writing your recap…" : r?.fallback ? "From the transcript. Review before sharing." : "Your conversation, with the next steps in one place."}</p></div>${button("new", "Another call", { className: "primary" })}</div>${r ? `${section("What happened", `<ul>${r.whatHappened.map((x) => `<li>${escape(x)}</li>`).join("")}</ul>`)}${section("Who owes what", r.whoOwesWhat.length ? `<ul>${r.whoOwesWhat.map((c) => `<li><strong>${escape(c.owner)}</strong> ${escape(c.what)}<span class="help"> ${escape(c.due)}</span></li>`).join("")}</ul>` : "<p>No specific promises recorded.</p>")}${section("Still open", r.stillOpen.length ? `<ul>${r.stillOpen.map((x) => `<li>${escape(x)}</li>`).join("")}</ul>` : "<p>No open items recorded.</p>")}${r.interview?.length ? section("Interview review", r.interview.map((i) => `<details data-detail-key="interview:${escape(i.question)}"><summary>${escape(i.question)}</summary><p>${escape(i.answer)}</p><p>${escape(i.stronger)}</p></details>`).join("")) : ""}${section(s.settings.mode === "interview" ? "Thank-you note" : "Follow-up email", `<div class="email-draft">${escape(r.email || "An email draft isn't available. Use the recap to write your follow-up.")}</div>${button("copy-email", "Copy email", { iconName: "copy", disabled: !r.email })}`)}` : '<div class="quiet">Your recap will appear here.</div>'}<div class="row">${button("copy-recap", "Copy recap", { iconName: "copy", disabled: !r })}${button("export", "Save as a file", { iconName: "file" })}</div>${s.source !== "demo" ? check("carry-recap", "Bring this recap into the next call", s.recapCarried, "carry-recap") : ""}<details class="transcript-recap" data-detail-key="recap-transcript"><summary>Transcript and suggestions</summary>${s.transcript.map((t) => `<p><strong>${escape(t.speaker)}</strong> ${escape(t.text)}</p>`).join("")}<h3>Suggestions</h3>${s.cards
    .filter((c) => !c.streaming)
    .map((c) => `<p>${escape(c.lead || c.body)}</p>`)
    .join(
      "",
    )}</details><footer class="recap-footer">Estimated API cost: $${Number(s.costEstimate || 0).toFixed(3)}. Uses editable rates in Settings. Transcripts stay temporary unless exported.</footer></main>`;
}
