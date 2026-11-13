import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { cleanQuestion, stageModel, stage } from "../ui/components/stage.mjs";

const chrome = { topBar: "<header></header>", footer: "<footer></footer>" };
const card = (id, o = {}) => ({ id, lane: "fast", origin: "auto", status: "new", sources: [], points: [], ...o });
const base = (cards, extra = {}) => ({ status: "running", thinking: {}, cards, ...extra });

test("question line drops filler and acknowledgements but keeps the question", () => {
  assert.equal(
    cleanQuestion("All right, 12nd. Okay, um. Tell me about a client result that you're proud of."),
    "Tell me about a client result that you're proud of.",
  );
  assert.equal(cleanQuestion("That's great. How do you manage several clients at the same time?"), "How do you manage several clients at the same time?");
  assert.equal(cleanQuestion("So, um, what would you change?"), "What would you change?");
  assert.equal(cleanQuestion("Why?"), "Why?");
  assert.equal(cleanQuestion(""), "");
});

test("newest card is current, earlier cards are listed newest first", () => {
  const s = base([
    card("a", { lead: "First answer.", trigger: { text: "First question?" } }),
    card("b", { lead: "Second answer.", trigger: { text: "Okay. Second question?" } }),
  ]);
  const m = stageModel(s, {});
  assert.equal(m.current.id, "b");
  assert.equal(m.question, "Second question?");
  assert.deepEqual(m.earlier.map((x) => x.id), ["a"]);
});

test("an earlier card can be viewed until a newer one arrives", () => {
  const ui = { stageSelect: { id: "a", latestId: "b" } };
  const cards = [card("a", { lead: "One." }), card("b", { lead: "Two." })];
  assert.equal(stageModel(base(cards), ui).current.id, "a");
  assert.equal(stageModel(base(cards), ui).viewingOlder, true);
  cards.push(card("c", { lead: "Three." }));
  assert.equal(stageModel(base(cards), ui).current.id, "c");
  assert.equal(ui.stageSelect, null);
});

test("while a new question is pending the last card stays visible", () => {
  const s = base([card("a", { lead: "One.", trigger: { text: "First?" } })], {
    thinking: { fast: true },
    pendingTrigger: { speaker: "Them", text: "Um. And how did you measure that?" },
  });
  const { document } = parseHTML(`<div id="r">${stage(s, {}, chrome)}</div>`);
  assert.match(document.querySelector(".stage-next").textContent, /How did you measure that\?/);
  assert.ok(document.querySelector(".stage-focus.is-previous"));
  assert.match(document.querySelector(".stage-say").textContent, /One\./);
});

test("the contract shape renders tags, cues, frames and proof tiles", () => {
  const s = base([], {
    stage: {
      phase: "final",
      question: { clean: "What would your first 90 days look like?", raw: "So what would your first 90 days look like?" },
      current: { id: "x", source: "none", say: "", frame: ["Your view", "Why", "Example"], cues: [], askBack: "What matters most in the first quarter?" },
      earlier: [{ id: "p", question: "Earlier?", say: "Earlier answer." }],
      readyNext: [{ id: "n", question: "How did you measure that?" }],
    },
  });
  const { document } = parseHTML(`<div>${stage(s, {}, chrome)}</div>`);
  assert.equal(document.querySelector(".stage-tag").textContent, "No source");
  assert.equal(document.querySelectorAll(".stage-frame li").length, 3);
  assert.match(document.querySelector(".cues").textContent, /Ask back/);
  assert.match(document.querySelector(".ready-list").textContent, /measure/);
  const proof = base([], { stage: { question: { clean: "Q?" }, current: { id: "y", source: "prepared", say: "Say this.", cues: [{ icon: "person", text: "Credit the team" }], proof: { type: "number_bars", value: "4.8×", label: "Ojo" } } } });
  const d2 = parseHTML(`<div>${stage(proof, {}, chrome)}</div>`).document;
  assert.equal(d2.querySelector(".stage-tag").textContent, "Prepared");
  assert.match(d2.querySelector(".proof-value").textContent, /4\.8×/);
});

test("text from cards is escaped", () => {
  const s = base([card("a", { lead: "<img src=x onerror=alert(1)>", trigger: { text: "<b>Hi</b>?" } })]);
  const html = stage(s, {}, chrome);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>Hi<\/b>/);
});
