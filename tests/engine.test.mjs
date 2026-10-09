import test from "node:test";
import assert from "node:assert/strict";
import { CoachEngine } from "../core/engine.mjs";
import { ContextStore, safeUrl } from "../core/context.mjs";
import { makePrompt } from "../core/prompts.mjs";
const advice = (overrides = {}) => ({
  cards: [
    {
      title: "Check attribution windows",
      body: "Ask whether both reports use the same attribution window.",
      say: "Are these comparable?",
      kind: "question",
      confidence: 0.9,
      sourceIds: [],
      reason: "The reports may differ.",
      ...overrides,
    },
  ],
});
const row = (id, text = "Should we change the channel budget?") => ({
  id,
  text,
  speaker: "Client",
  final: true,
});
const engine = (generate, config = {}) =>
  new CoachEngine({
    providers: { fast: { generate }, strategy: { generate } },
    config: { fastDelay: 100000, strategyDelay: 100000, ...config },
  });
test("live input requires explicit consent, demo does not", () => {
  const e = engine(async () => advice());
  assert.throws(() => e.start({ source: "audio" }), /Confirm/);
  assert.equal(e.status, "idle");
  e.start({ source: "demo" });
  assert.equal(e.status, "running");
  e.end();
});
test("pause stops ingestion and aborts in-flight work; late completion is not displayed", async () => {
  let resolve, signal;
  const e = engine((args) => {
    signal = args.signal;
    return new Promise((r) => (resolve = r));
  });
  e.start();
  e.ingest(row("1"));
  const task = e.run("fast");
  assert.equal(e.snapshot().thinking.fast, true);
  e.pause();
  assert.equal(signal.aborted, true);
  assert.equal(e.ingest(row("2")), false);
  resolve(advice());
  await task;
  assert.equal(e.cards.length, 0);
  assert.equal(e.transcript.size, 1);
  assert.equal(e.snapshot().thinking.fast, false);
  e.end();
});
test("transcript updates replace by ID, duplicates do not create revisions", () => {
  const e = engine(async () => advice());
  e.start();
  e.ingest({ ...row("a", "Search"), final: false });
  assert.equal(e.revision, 0);
  e.ingest(row("a", "Search has a higher ROAS."));
  assert.equal(e.revision, 1);
  assert.equal(e.ingest(row("a", "Search has a higher ROAS.")), false);
  assert.equal(e.transcript.size, 1);
  assert.equal(e.revision, 1);
  e.end();
});
test("one request per lane; fast and strategy can run independently", async () => {
  const resolvers = [];
  const e = engine(() => new Promise((r) => resolvers.push(r)));
  e.start();
  e.ingest(row("a"));
  const fast = e.run("fast"),
    strategy = e.run("strategy");
  assert.deepEqual(await e.run("fast"), { busy: true });
  assert.equal(resolvers.length, 2);
  resolvers[0](advice());
  resolvers[1](
    advice({
      title: "Strategic recommendation",
      body: "Choose a small reversible experiment.",
    }),
  );
  await Promise.all([fast, strategy]);
  assert.equal(e.cards.length, 2);
  e.end();
});
test("outdated advice is suppressed after the call has substantially advanced", async () => {
  let resolve;
  const e = engine(() => new Promise((r) => (resolve = r)));
  e.start();
  e.ingest(row("a"));
  const task = e.run("fast");
  for (let i = 0; i < 6; i++) e.ingest(row(`next-${i}`, `New topic ${i}`));
  resolve(advice());
  await task;
  assert.equal(e.cards.length, 0);
  assert.equal(e.metrics.discarded, 1);
  e.end();
});
test("fresh source-linked advice is accepted; invented citations are discarded", async () => {
  let result = advice({ sourceIds: ["made-up"] });
  const e = engine(async () => result);
  e.start();
  e.ingest(row("a", "The attribution windows differ."));
  e.context.add({
    id: "real",
    title: "Attribution",
    text: "Search attribution is 30 days. Social attribution is 7 days.",
  });
  await e.run();
  assert.equal(e.cards.length, 0);
  result = advice({ sourceIds: ["real"] });
  await e.run();
  assert.equal(e.cards.length, 1);
  assert.equal(e.cards[0].sources[0].id, "real");
  e.end();
});
test("dismissal prevents repetition, and low-confidence proactive cards are withheld", async () => {
  let result = advice();
  const e = engine(async () => result);
  e.start();
  e.ingest(row("a"));
  await e.run();
  e.feedback(e.cards[0].id, "dismissed");
  await e.run();
  assert.equal(e.cards.length, 1);
  result = advice({
    title: "An uncertain new idea",
    body: "A different suggestion",
    confidence: 0.3,
  });
  await e.run();
  assert.equal(e.cards.length, 1);
  e.end();
});
test("per-session call caps block repeated billable requests", async () => {
  const e = engine(async () => advice(), { maxFast: 1 });
  e.start();
  e.ingest(row("a"));
  await e.run();
  await e.run();
  assert.equal(e.metrics.fastCalls, 1);
  assert.match(e.errors.at(-1).message, /limit/);
  e.end();
});
test("quiet mode does not schedule automatic calls", () => {
  const e = engine(async () => advice());
  e.configure({ quiet: true });
  e.start();
  e.ingest(row("a"));
  assert.equal(Object.keys(e.timers).length, 0);
  e.end();
});
test("an old request cannot clear a newer request after reset", async () => {
  const resolves = [];
  const e = engine(() => new Promise((r) => resolves.push(r)));
  e.start();
  e.ingest(row("a"));
  const first = e.run();
  e.end();
  e.reset();
  e.start();
  e.ingest(row("b"));
  const second = e.run();
  resolves[0](advice());
  await first;
  assert.equal(e.snapshot().thinking.fast, true);
  resolves[1](advice());
  await second;
  assert.equal(e.cards.length, 1);
  e.end();
});
test("context search respects project boundaries and rejects unsafe URLs", () => {
  const store = new ContextStore();
  store.add({
    id: "a",
    project: "A",
    title: "Budget",
    text: "Budget attribution report",
    url: "javascript:alert(1)",
  });
  store.add({
    id: "b",
    project: "B",
    title: "Budget",
    text: "Budget for another client",
  });
  assert.deepEqual(
    store.search("budget", { project: "A" }).map((r) => r.id),
    ["a"],
  );
  assert.equal(store.get("a").url, "");
  assert.equal(safeUrl("https://user:secret@example.com"), "");
});
test("prompt treats evidence as data and bounds repeated conversation input", () => {
  const prompt = makePrompt({
    lane: "fast",
    goal: "Clarify",
    mode: "general",
    profile: "",
    question: "",
    transcript: Array.from({ length: 60 }, () => ({
      speaker: "Other",
      text: "x".repeat(20000),
      startMs: 0,
    })),
    sources: [],
    previousCards: [],
  });
  assert.ok(prompt.input.length < 19000);
  assert.match(prompt.instructions, /UNTRUSTED DATA/);
  assert.equal(JSON.parse(prompt.input).conversation.length, 1);
});
test("export preserves transcript and provenance while omitting dismissed advice", async () => {
  const e = engine(async () => advice());
  e.start();
  e.ingest(row("a"));
  await e.run();
  const exported = e.exportMarkdown();
  assert.match(exported, /DEMO/);
  assert.match(exported, /Client/);
  e.feedback(e.cards[0].id, "dismissed");
  assert.doesNotMatch(e.exportMarkdown(), /### Check attribution/);
  e.end();
});
test("background retrieval feeds strategic advice but cannot add data after pause", async () => {
  let resolve;
  const e = engine(async () => advice({ sourceIds: ["retrieved"] }));
  e.retriever = () => new Promise((r) => (resolve = r));
  e.configure({ autoSearch: true });
  e.start();
  e.ingest(row("a", "We need attribution evidence."));
  const task = e.run("strategy");
  e.pause();
  resolve([
    {
      id: "retrieved",
      title: "Attribution evidence",
      text: "The attribution windows differ.",
    },
  ]);
  await task;
  assert.equal(e.context.list().length, 0);
  assert.equal(e.cards.length, 0);
  e.end();
});
test("background retrieval is cited in the same strategic request", async () => {
  let seen;
  const e = engine(async (args) => {
    seen = args.sources;
    return advice({ sourceIds: ["retrieved"] });
  });
  e.retriever = async () => [
    {
      id: "retrieved",
      title: "Attribution evidence",
      text: "The attribution windows differ.",
    },
  ];
  e.configure({ autoSearch: true });
  e.start();
  e.ingest(row("a", "We need attribution evidence."));
  await e.run("strategy");
  assert.equal(seen[0].id, "retrieved");
  assert.equal(e.cards[0].sources[0].id, "retrieved");
  e.end();
});
test("factual cards without a source are withheld", async () => {
  const e = engine(async () => advice({ kind: "fact" }));
  e.start();
  e.ingest(row("a"));
  await e.run();
  assert.equal(e.cards.length, 0);
  e.end();
});

test("active call time and transcript timestamps exclude pauses, including multiple resumes", () => {
  let now = 0;
  const e = new CoachEngine({
    clock: () => now,
    config: { fastDelay: 100000, strategyDelay: 100000 },
  });
  try {
    e.start();
    now = 10000;
    e.ingest(row("a"));
    e.pause();
    now = 110000;
    assert.equal(e.snapshot().activeTimeMs, 10000);
    e.start();
    now = 120000;
    e.ingest(row("b"));
    e.pause();
    assert.equal(e.transcript.get("b").startMs, 20000);
    now = 220000;
    e.start();
    now = 225000;
    e.end();
    assert.equal(e.snapshot().activeTimeMs, 25000);
  } finally {
    e.end();
  }
});
test("two active hours warn without pausing; four active hours end the call", () => {
  let now = 0;
  const e = new CoachEngine({
    clock: () => now,
    config: { fastDelay: 100000, strategyDelay: 100000 },
  });
  try {
    e.start();
    now = 2 * 60 * 60 * 1000;
    e.ingest(row("a"));
    assert.equal(e.status, "running");
    assert.equal(e.errors.at(-1).severity, "warning");
    e.ingest(row("b"));
    assert.equal(e.errors.length, 1);
    now = 4 * 60 * 60 * 1000;
    assert.equal(e.ingest(row("c")), false);
    assert.equal(e.status, "ended");
  } finally {
    e.end();
  }
});
test("errors have IDs, expire or dismiss, and connection errors clear on a successful resume", () => {
  let now = 0;
  const e = new CoachEngine({ clock: () => now });
  try {
    e.start();
    e.error("Connection failed", {
      condition: "connection:mic",
      lifetimeMs: null,
    });
    const id = e.snapshot().errors[0].id;
    assert.ok(id);
    e.pause();
    e.start();
    assert.equal(e.snapshot().errors.length, 0);
    e.error("Try again");
    now = 30001;
    assert.equal(e.snapshot().errors.length, 0);
    e.error("Dismiss this");
    e.clearErrors({ id: e.errors.at(-1).id });
    assert.equal(e.snapshot().errors.length, 0);
  } finally {
    e.end();
  }
});
test("explicit asks still explain missing evidence when the model chooses silence", async () => {
  const e = engine(async () => ({ cards: [] }));
  try {
    e.start();
    await e.run("fast", "What should I say?");
    assert.equal(e.cards.length, 1);
    assert.equal(e.cards[0].origin, "asked");
    assert.match(e.cards[0].body, /verified context/);
  } finally {
    e.end();
  }
});
