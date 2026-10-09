import test from "node:test";
import assert from "node:assert/strict";
import { CoachEngine } from "../core/engine.mjs";
import { makePrompt } from "../core/prompts.mjs";
import { sanitizeConnections, checkModelAccess } from "../core/connections.mjs";

const card = {
  cards: [
    {
      title: "Answer",
      body: "Useful",
      say: "",
      kind: "answer",
      confidence: 0.9,
      sourceIds: [],
      reason: "Asked directly",
    },
  ],
};
const engine = (generate = async () => card, config = {}) =>
  new CoachEngine({
    providers: { fast: { generate }, strategy: { generate } },
    config: {
      autoCoach: false,
      fastDelay: 100000,
      strategyDelay: 100000,
      ...config,
    },
  });

test("a final transcript segment never regresses to a late partial", () => {
  const e = engine();
  e.start();
  e.ingest({
    id: "x",
    text: "Final answer",
    speaker: "Other",
    final: true,
    startMs: 10,
  });
  assert.equal(
    e.ingest({
      id: "x",
      text: "Final",
      speaker: "Other",
      final: false,
      startMs: 10,
    }),
    false,
  );
  assert.equal(e.transcript.get("x").text, "Final answer");
  e.end();
});
test("typed question preempts an automatic request instead of being dropped", async () => {
  let firstResolve;
  let calls = 0;
  const e = engine(({ signal, question }) => {
    calls++;
    if (calls === 1)
      return new Promise((resolve) => {
        firstResolve = resolve;
        signal.addEventListener("abort", () => resolve(card), { once: true });
      });
    return Promise.resolve({
      ...card,
      cards: [{ ...card.cards[0], body: question || "missing" }],
    });
  });
  e.start();
  e.ingest({
    id: "x",
    text: "Call text",
    speaker: "Other",
    final: true,
    startMs: 0,
  });
  const automatic = e.run("fast");
  await new Promise((r) => setImmediate(r));
  const explicit = e.run("fast", "What should I say?");
  await Promise.all([automatic, explicit]);
  assert.equal(calls, 2);
  assert.equal(e.cards.at(-1).body, "What should I say?");
  e.end();
});
test("elapsed session limit is enforced again on resume", () => {
  let now = 0;
  const e = new CoachEngine({
    clock: () => now,
    providers: {
      fast: { generate: async () => card },
      strategy: { generate: async () => card },
    },
    config: {
      maxSessionMs: 100,
      autoCoach: false,
      fastDelay: 100000,
      strategyDelay: 100000,
    },
  });
  e.start();
  now = 101;
  e.pause();
  assert.throws(() => e.start(), /time limit/i);
  e.end();
});
test("prompt preserves a bounded sample of early decisions", () => {
  const transcript = [
    {
      speaker: "Client",
      text: "We decided budget is $10k and Friday is the deadline.",
      startMs: 0,
    },
    ...Array.from({ length: 70 }, (_, i) => ({
      speaker: "Other",
      text: `Routine line ${i}`,
      startMs: i + 1,
    })),
  ];
  const prompt = makePrompt({
    lane: "strategy",
    goal: "Close next steps",
    mode: "strategy",
    profile: "",
    transcript,
    sources: [],
    question: "",
    previousCards: [],
  });
  const data = JSON.parse(prompt.input);
  assert.ok(data.historicalHighlights.some((x) => x.text.includes("$10k")));
  assert.ok(data.conversation.length <= 60);
});
test("connection settings keep existing secrets when blank and reject malformed values", () => {
  const prior = { openaiKey: "sk-existing-key-value", fastModel: "gpt-fast" };
  const next = sanitizeConnections(
    { openaiKey: "", fastModel: "gpt-new" },
    prior,
  );
  assert.equal(next.openaiKey, prior.openaiKey);
  assert.equal(next.fastModel, "gpt-new");
  assert.throws(() => sanitizeConnections({ openaiKey: "short" }), /complete/);
  assert.throws(
    () => sanitizeConnections({ fastModel: "https://bad" }),
    /model name/,
  );
});
test("model readiness check never sends inference content", async () => {
  const calls = [];
  const result = await checkModelAccess(
    {
      openaiKey: "sk-test-key-value",
      fastModel: "fast",
      strategyModel: "strategy",
      transcriptionModel: "transcribe",
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200, body: { cancel: async () => {} } };
      },
    },
  );
  assert.equal(
    result.every((x) => x.ok),
    true,
  );
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      (c) =>
        c.options.method === undefined &&
        c.options.body === undefined &&
        c.url.includes("/v1/models/"),
    ),
  );
});
