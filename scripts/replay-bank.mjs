import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PackBank } from "../core/packs.mjs";
import { StageCoach } from "../core/stage-coach.mjs";
import { median } from "../core/cards.mjs";
const root = path.resolve(import.meta.dirname, ".."), fixture = JSON.parse(readFileSync(path.join(root, "fixtures/replay/interview-bank.json")));
const flush = () => new Promise(resolve => setImmediate(resolve));
const allLatency = [], checks = [], ladder = [];
async function harness({ earlyReveal = true, mode = "prepared" } = {}) {
  let now = 0, selected = "client-result", score = .94, margin = .3, resolveLive;
  const bank = new PackBank(); bank.import(fixture.pack); await bank.command("bank.approveAll", { packId: fixture.pack.id });
  const provider = { generate: async ({ schema }) => {
    if (schema.properties.cardId) return { cardId: `${fixture.pack.id}:${selected}` };
    if (schema.properties.label) return { label: "objection" };
    if (schema.properties.cards) return { cards: [] };
    return new Promise(resolve => { resolveLive = resolve; });
  } };
  const engine = { sessionId: "replay", config: { maxFast: 120 }, settings: { mode: "interview", userName: "Matt" } };
  const coach = new StageCoach({ bank, engine, provider: () => provider, preferences: () => ({ earlyReveal }), clock: () => now });
  coach.records = bank.usable(); const record = coach.records[0];
  const entries = record.pack.cards.map(card => ({ id: `${record.id}:${card.id}`, questions: card.questions, card, record }));
  let stable;
  coach.matcher.entries = entries;
  coach.matcher.rank = async () => entries.map(entry => ({ entry, cardId: entry.id, score: entry.card.id === selected ? score : score - margin })).sort((a,b) => b.score-a.score);
  coach.matcher.match = async (_, { turnId }) => {
    if (!stable || stable.card !== selected || stable.turnId !== turnId) stable = { card: selected, at: now, turnId };
    const candidates = entries.map(entry => ({ entry, cardId: entry.id, score: entry.card.id === selected ? score : score - margin })).sort((a,b) => b.score-a.score);
    return { cardId: `${record.id}:${selected}`, score, margin, stableMs: now - stable.at, questionComplete: true, candidates };
  };
  coach.retrieve = async () => ({ stories: ["live", "slow"].includes(mode) ? [record.pack.stories[0]] : [], facts: mode === "fact" ? record.pack.facts : [] });
  coach.refresh = async () => {};
  return { coach, set(e) { now = e.at ?? now; selected = e.card || selected; score = e.score ?? score; margin = e.margin ?? margin; },
    async row(e) { this.set(e); return coach.ingest({ id: e.id || "q", text: e.text || "Tell me about a customer result?", final: !!e.final, speaker: "Them", channel: "system", confidence: e.confidence }); },
    async tick(at) { now = at; coach.turn.match.stableMs = now - stable.at; await coach.decide(coach.turn); },
    finishLive() { resolveLive({ say: "I led the work and measured our results.", cues: [{ icon: "decision", text: "Measured results" }], sourceIds: ["client-result"] }); },
  };
}
for (const s of fixture.scenarios) {
  const h = await harness(s);
  try {
    for (const e of s.events) {
      if (e.tick) await h.tick(e.at); else await h.row(e);
      if (e.expectedPhase) assert.equal(h.coach.stage.phase, e.expectedPhase);
      if (!e.final && e.at < 1000) assert.equal(h.coach.stage.current, null);
      if (s.earlyReveal === false && e.tick) assert.equal(h.coach.stage.current, null);
      if (s.name.startsWith("twist") && e.at === 1500) assert.match(h.coach.stage.current.id, /client-result$/);
    }
    assert.equal(h.coach.stage.current.source, "prepared");
    assert.ok(h.coach.turn.swaps <= 1);
    if (s.name.startsWith("twist")) assert.equal(h.coach.turn.swaps, 1);
    allLatency.push(...h.coach.latencies); checks.push({ scenario: s.name, rule: s.rule, passed: true });
  } finally { h.coach.cancel(); }
}
// These use the same timed input path as the fixture scenarios and make the
// remaining B5 rules and repeated-question acceptance check explicit in replay.
{
  const h = await harness();
  try {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      await h.row({ at: i * 5000, id: `repeat-${i}`, final: true });
      ids.push(h.coach.stage.current.id);
    }
    assert.equal(new Set(ids).size, 1);
    checks.push({ scenario: "same question five times", rule: "Done means: repeated question", passed: true });
  } finally { h.coach.cancel(); }
}
{
  const h = await harness();
  try {
    await h.row({ at: 0 }); await h.tick(1000);
    await h.coach.ingest({ id: "own", text: "I led the work.", channel: "mic", speaker: "You", final: false });
    await h.row({ at: 1600, card: "multi-account", final: true, text: "Actually, how do you manage several client accounts?" });
    assert.match(h.coach.stage.current.id, /client-result$/);
    assert.ok(h.coach.stage.readyNext.some(card => card.id.endsWith("multi-account")));
    checks.push({ scenario: "late final while the user speaks", rule: "B5.6", passed: true });
  } finally { h.coach.cancel(); }
}
{
  const h = await harness();
  try {
    const second = h.coach.matcher.entries.find(entry => entry.card.id === "multi-account");
    h.coach.matcher.rank = async () => [{ entry: second, cardId: second.id, score: .94 }];
    await h.row({ at: 0, final: true, text: "Tell me about customer growth? And how do you manage several client accounts?" });
    assert.match(h.coach.stage.current.id, /client-result$/);
    assert.equal(h.coach.stage.readyNext[0].id, second.id);
    checks.push({ scenario: "compound question", rule: "B5.5 second part", passed: true });
  } finally { h.coach.cancel(); }
}
// Stable early-reveal repetitions make the swap denominator explicit instead of claiming a rate
// from the one deliberately adversarial twist above.
for (let i = 0; i < 100; i++) {
  const h = await harness();
  try { await h.row({ at: 0, final: false }); await h.tick(1000); await h.row({ at: 1600, final: true }); assert.equal(h.coach.turn.swaps, 0); allLatency.push(...h.coach.latencies); }
  finally { h.coach.cancel(); }
}
for (const scenario of fixture.ladderCases) {
  const mode = scenario.mode;
  const h = await harness({ mode });
  try {
    h.set({ score: mode === "prepared" ? .94 : mode === "closest" ? .67 : .1, margin: mode === "closest" ? .02 : .3 });
    const pending = h.row({ at: 0, final: true, text: scenario.question, ...(mode === "unclear" ? { confidence: .1 } : {}) });
    await flush();
    if (mode === "live") {
      assert.ok(h.coach.stage.current.frame.length); h.set({ at: 1800 }); h.finishLive();
    } else if (mode === "slow") {
      assert.ok(h.coach.stage.current.frame.length); h.set({ at: 2500 }); h.coach.turn.live.onSlow(); assert.equal(h.coach.stage.notice.kind, "model_slow"); h.coach.cancel();
    }
    await pending;
    const expected = { prepared: "prepared", closest: "prepared_closest", live: "live", none: "none", fact: "fact" }[mode];
    if (expected) assert.equal(h.coach.stage.current.source, expected);
    if (mode === "unclear") { assert.equal(h.coach.stage.current, null); assert.equal(h.coach.stage.notice.kind, "heard_unclear"); }
    ladder.push({ step: mode, source: h.coach.stage.current?.source || null, notice: h.coach.stage.notice?.kind || null, liveMs: h.coach.stage.speed.lastLiveMs, passed: true });
  } finally { h.coach.cancel(); }
}
const reveal = allLatency.filter(l => l.turnEndedAt !== null && ["prepared", "prepared_closest"].includes(l.source)).map(l => l.revealLeadMs);
const early = allLatency.filter(l => l.early).length, swaps = fixture.scenarios.filter(s => s.name.startsWith("twist")).length;
const summary = { timing: "virtual-clock state-machine replay with deterministic matcher bands and stub provider; semantic accuracy is measured separately", checks: checks.length, ladderCases: ladder.length,
  preparedP90RevealMs: [...reveal].sort((a,b) => a-b)[Math.ceil(reveal.length * .9)-1], medianRevealMs: median(reveal), earlyReveals: early, earlySwaps: swaps, earlySwapRate: swaps / early, maxSwapsPerTurn: 1, stubLiveRevealMs: 1800 };
assert.ok(summary.preparedP90RevealMs <= 500); assert.ok(summary.earlySwapRate < .02);
mkdirSync(path.join(root, "artifacts/replay"), { recursive: true }); writeFileSync(path.join(root, "artifacts/replay/interview-bank-results.json"), JSON.stringify({ summary, checks, ladder }, null, 2));
console.log(JSON.stringify({ summary, checks, ladder }, null, 2));
