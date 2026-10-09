import { escape, icon } from "./common.mjs";
export const chips = (items) =>
  `<div class="chips">${items.map((d) => `<span class="chip">${icon("file")}<span>${escape(d.title)}</span><button type="button" data-action="remove-material" data-id="${escape(d.id)}" aria-label="Remove ${escape(d.title)}">${icon("close")}</button></span>`).join("")}</div>`;
