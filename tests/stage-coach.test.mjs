import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { StageCoach } from "../core/stage-coach.mjs";
import { PackBank } from "../core/packs.mjs";
const fixture = JSON.parse(readFileSync(new URL("../fixtures/replay/interview-bank.json", import.meta.url)));
const pause = () => new Promise((resolve) => setImmediate(resolve));
async function harness({ provider, earlyReveal = true } = {}) {
  let now = 0, score = .94, margin = .3, id = "client-result";
  const bank = new PackBank(); bank.import(fixture.pack); await bank.command("bank.approveAll", { packId: fixture.pack.id });
  const engine = { sessionId: "test", config: { maxFast: 120 }, settings: { mode: "interview", userName: "Matt" } };
  const coach = new StageCoach({ bank, engine, clock: () => now, preferences: () => ({ earlyReveal }), provider: () => provider });
  coach.records = bank.usable({ type: "interview" });
  const entries = coach.records.flatMap((r) => r.pack.cards.map((card) => ({ id: `${r.id}:${card.id}`, questions: card.questions, card, record: r })));
  let stable;
  const ranked = () => entries.map(e => ({ cardId: e.id, score: e.card.id === id ? score : Math.max(0, score - margin), entry: e })).sort((a,b) => b.score-a.score);
  coach.matcher.entries = entries;
  coach.matcher.match = async (_text, { turnId }) => {
    if (stable?.id !== id || stable.turnId !== turnId) stable = { id, turnId, at: now };
    return { cardId: `${fixture.pack.id}:${id}`, score, margin, stableMs: now - stable.at, questionComplete: true, candidates: ranked() };
  };
  coach.matcher.rank = async () => ranked();
  coach.refresh = async () => {};
  coach.retrieve = async () => ({ stories: [], facts: [] });
  const row = (text, extra = {}) => ({ id: "q", channel: "system", speaker: "Them", text, final: false, ...extra });
  return { coach, bank, engine, row, set: (patch) => { now = patch.at ?? now; score = patch.score ?? score; margin = patch.margin ?? margin; id = patch.card ?? id; },
    async tick(at) { now = at; coach.turn.match.stableMs = now - (stable?.at || 0); await coach.decide(coach.turn); },
  };
}
for (const scenario of fixture.scenarios) test(`timing replay: ${scenario.name} (${scenario.rule})`, async (t) => {
  const h = await harness(scenario); t.after(() => h.coach.cancel());
  for (const e of scenario.events) {
    h.set(e);
    if (e.tick) await h.tick(e.at); else await h.coach.ingest(h.row(e.text, { id: e.id, final: e.final }));
    if (e.expectedPhase) assert.equal(h.coach.stage.phase, e.expectedPhase);
    if (!e.final && e.at < 1000) assert.equal(h.coach.stage.current, null);
    if (scenario.earlyReveal === false && e.tick) assert.equal(h.coach.stage.current, null);
    if (scenario.name.startsWith("twist") && e.at === 1500) assert.match(h.coach.stage.current.id, /client-result$/);
  }
  assert.equal(h.coach.stage.current.source, scenario.expected);
  if (scenario.name.startsWith("twist")) { assert.match(h.coach.stage.current.id, /team-lead$/); assert.equal(h.coach.turn.swaps, 1); }
  else assert.ok(h.coach.latencies.every(l => l.revealLeadMs <= 0));
});
test("a repeated question gives the same approved card five times", async (t) => {
  const h = await harness(); t.after(() => h.coach.cancel()); const ids = [];
  for (let i = 0; i < 5; i++) { h.set({ at: i * 5000 }); await h.coach.ingest(h.row("Tell me about customer growth?", { id: `q${i}`, final: true })); ids.push(h.coach.stage.current.id); }
  assert.equal(new Set(ids).size, 1);
});
test("an early card never automatically swaps while the user is speaking", async (t) => {
  const h = await harness(); t.after(() => h.coach.cancel());
  await h.coach.ingest(h.row("Tell me about customer growth?")); await h.tick(1000);
  await h.coach.ingest(h.row("I led that work.", { id: "own", channel: "mic", speaker: "You" }));
  h.coach.showEntry({ entry: h.coach.matcher.entries[1] }, h.coach.turn);
  assert.match(h.coach.stage.current.id, /client-result$/); assert.equal(h.coach.stage.readyNext.length, 1);
});
test("compound questions keep the first card and queue the second", async (t) => {
  const h = await harness(); t.after(() => h.coach.cancel());
  const second = h.coach.matcher.entries[1]; h.coach.matcher.rank = async () => [{ cardId: second.id, score: .9, entry: second }];
  await h.coach.ingest(h.row("Tell me about customer growth? And how do you manage many accounts?", { final: true }));
  assert.match(h.coach.stage.current.id, /client-result$/); assert.equal(h.coach.stage.readyNext[0].id, second.id);
});
test("a delayed final from their question cannot replace a card after the user starts answering", async (t) => {
  const h = await harness(); t.after(() => h.coach.cancel());
  await h.coach.ingest(h.row("Tell me about customer growth?")); await h.tick(1000);
  await h.coach.ingest(h.row("I led that work.", { id: "own", channel: "mic", speaker: "You" }));
  h.set({ at: 1600, card: "multi-account" });
  await h.coach.ingest(h.row("Actually, how do you manage several client accounts?", { final: true }));
  assert.match(h.coach.stage.current.id, /client-result$/); assert.ok(h.coach.stage.readyNext.some(c => c.id.endsWith("multi-account")));
});
test("bounded tie-break can select closest or reject all without invented IDs", async (t) => {
  const provider = { generate: async () => ({ cardId: `${fixture.pack.id}:client-result` }) };
  const h = await harness({ provider }); t.after(() => h.coach.cancel()); h.set({ score: .68, margin: .02 });
  await h.coach.ingest(h.row("Which customer result would you discuss?", { final: true }));
  assert.equal(h.coach.stage.current.source, "prepared_closest");
});
test("ladder: no source shows an immediate frame and an ask-back", async (t) => {
  const h = await harness(); t.after(() => h.coach.cancel()); h.set({ score: .1, margin: .01 });
  await h.coach.ingest(h.row("How would you approach a situation outside your experience?", { final: true }));
  assert.equal(h.coach.stage.current.source, "none"); assert.ok(h.coach.stage.current.frame.length); assert.ok(h.coach.stage.current.askBack); assert.equal(h.coach.surprises.length, 1);
});
test("ladder: a grounded live result replaces its immediate frame", async (t) => {
  const h = await harness({ provider: { generate: async () => ({ say: "I led the work and measured our results.", cues: [{ icon: "decision", text: "Measured results" }], sourceIds: ["client-result"] }) } });
  t.after(() => h.coach.cancel()); h.set({ score: .1 });
  h.coach.retrieve = async () => ({ stories: [fixture.pack.stories[0]], facts: [] });
  const shown = []; h.coach.onChange = () => shown.push(h.coach.stage.current?.source);
  await h.coach.ingest(h.row("How did you measure the outcome of your work?", { final: true }));
  assert.ok(shown.includes("none")); assert.equal(h.coach.stage.current.source, "live"); assert.ok(h.coach.stage.current.sources.length);
});
test("ladder: facts about them use the fact source without a model request", async (t) => {
  const h = await harness({ provider: { generate: () => { throw new Error("Unexpected network request"); } } });
  t.after(() => h.coach.cancel()); h.set({ score: .1 }); h.coach.retrieve = async () => ({ stories: [], facts: fixture.pack.facts });
  await h.coach.ingest(h.row("What is your company known for?", { final: true }));
  assert.equal(h.coach.stage.current.source, "fact"); assert.match(h.coach.stage.current.say, /second office/);
});
test("misheard speech suppresses an answer, then a clarified row resumes normally", async (t) => {
  const h = await harness(); t.after(() => h.coach.cancel()); h.set({ score: 0 });
  await h.coach.ingest(h.row("[inaudible]", { final: true, confidence: .1 }));
  assert.equal(h.coach.stage.notice.kind, "heard_unclear"); assert.equal(h.coach.stage.current, null);
  h.set({ score: .95, margin: .3 }); await h.coach.ingest(h.row("Tell me about customer growth?", { id: "clarified", final: true, confidence: .9 }));
  assert.equal(h.coach.stage.notice, null); assert.equal(h.coach.stage.current.source, "prepared");
});
test("a stalled provider keeps a frame and adds the slow-model notice at 2.5 seconds", async (t) => {
  const h = await harness({ provider: { generate: () => new Promise(() => {}) } }); t.after(() => h.coach.cancel());
  h.set({ score: .1 }); h.coach.retrieve = async () => ({ stories: [fixture.pack.stories[0]], facts: [] });
  const pending = h.coach.ingest(h.row("How did you measure the outcome?", { final: true })); await pause();
  assert.ok(h.coach.stage.current.frame.length); h.set({ at: 2500 }); h.coach.turn.live.onSlow();
  assert.equal(h.coach.stage.notice.kind, "model_slow"); h.coach.cancel(); await pending;
});
test("a stable complete off-bank partial prepares a hidden live answer before the final row", async (t) => {
  let complete;
  const h = await harness({ provider: { generate: () => new Promise(resolve => complete = resolve) } }); t.after(() => h.coach.cancel());
  h.set({ score: .1 }); h.coach.retrieve = async () => ({ stories: [fixture.pack.stories[0]], facts: [] });
  await h.coach.ingest(h.row("How did you measure the outcome of your work?")); await h.tick(1000); await pause();
  assert.equal(typeof complete, "function"); assert.equal(h.coach.stage.current, null);
  complete({ say: "I led the work and measured our results.", cues: [], sourceIds: ["client-result"] }); await pause();
  assert.equal(h.coach.stage.current, null);
  h.set({ at: 1800 }); await h.coach.ingest(h.row("How did you measure the outcome of your work?", { final: true }));
  assert.equal(h.coach.stage.current.source, "live");
});
test("unsafe say and a conflicting number regenerate once, then retain the frame", async (t) => {
  let calls = 0;
  const h = await harness({ provider: { generate: async () => { calls++; return { say: "I grew revenue 9.8 times in one year.", cues: [], sourceIds: ["client-result"] }; } } });
  t.after(() => h.coach.cancel()); h.set({ score: .1 }); h.coach.retrieve = async () => ({ stories: [fixture.pack.stories[0]], facts: [] });
  await h.coach.ingest(h.row("How did you measure customer outcomes?", { final: true }));
  assert.equal(calls, 2); assert.equal(h.coach.stage.current.say, ""); assert.ok(h.coach.stage.current.frame.length);
});
test("meaning labels catch an unpunctuated objection; small talk stays silent", async (t) => {
  const h = await harness({ provider: { generate: async () => ({ label: "objection" }) } }); t.after(() => h.coach.cancel()); h.set({ score: .1 });
  await h.coach.ingest(h.row("I remain unconvinced that this plan addresses our underlying concern", { final: true }));
  assert.deepEqual(h.coach.stage.current.frame, ["Acknowledge", "Reframe", "Proof"]);
});
test("the claim ledger rejects an invented client and a value assigned to the wrong metric", async (t) => {
  const h = await harness(); t.after(() => h.coach.cancel());
  const story = { ...fixture.pack.stories[0], numbers: [{ label: "revenue", value: "4.8×", period: "one year" }, { label: "acquisition", value: "3.8×", period: "one year" }], result: "Revenue grew 4.8 times; acquisition grew 3.8 times." };
  assert.equal(h.coach.claimConflict({ say: "I led Acme's growth.", cues: [], sourceIds: [story.id] }, { stories: [story], facts: [] }), true);
  assert.equal(h.coach.claimConflict({ say: "I grew revenue 3.8 times.", cues: [], sourceIds: [story.id] }, { stories: [story], facts: [] }), true);
  assert.equal(h.coach.claimConflict({ say: "I grew revenue 4.8 times.", cues: [], sourceIds: [story.id] }, { stories: [story], facts: [] }), false);
});
test("wrap-up emits all unanswered questions as ask cues without a model", async (t) => {
  const h = await harness(); t.after(() => h.coach.cancel()); h.coach.questionsAnswered.add(fixture.pack.questionsForThem[0]);
  await h.coach.ingest(h.row("Do you have any questions for us?", { final: true }));
  const c = h.coach.stage.current; assert.equal(c.source, "prepared"); assert.equal(c.say, ""); assert.equal(c.cues.length, 3); assert.ok(c.cues.every(c => c.icon === "ask"));
});
test("surprise learning cites only the user's surviving final answer rows", async (t) => {
  const h = await harness(); t.after(() => h.coach.cancel()); h.set({ score: .1 });
  await h.coach.ingest(h.row("How would you handle a new situation?", { final: true }));
  await h.coach.ingest(h.row("I would start with a small trial.", { id: "answer", final: true, channel: "mic", speaker: "You" }));
  assert.equal(h.coach.learning()[0].answer, "I would start with a small trial.");
  h.coach.invalidateSegment("answer"); assert.equal(h.coach.learning()[0].answer, "");
});
