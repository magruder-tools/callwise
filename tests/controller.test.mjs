import test from "node:test";
import assert from "node:assert/strict";
import { CallController } from "../core/controller.mjs";
import { publicConfig } from "../core/config.mjs";
test("browser demo cannot activate live providers even with credentials present", async () => {
  const c = new CallController({
    demoOnly: true,
    config: { openaiKey: "TEST_ONLY", firefliesKey: "TEST_ONLY" },
  });
  await assert.rejects(
    c.command("start", { source: "audio", consent: true }),
    /browser demo/,
  );
  assert.equal(c.engine.status, "idle");
  c.close();
});
test("demo starts, coaches with source context, pauses, and clears fictional context on new", async () => {
  const c = new CallController({ demoOnly: true });
  await c.command("start", { source: "demo" });
  assert.equal(c.engine.context.list().length, 3);
  await c.command("transcript", {
    text: "Should we compare attribution windows?",
    speaker: "Client",
  });
  await c.command("nudge");
  assert.ok(c.snapshot().cards[0].demo);
  assert.ok(c.snapshot().cards[0].sources.length);
  await c.command("pause");
  assert.equal(c.demoTimers.length, 0);
  assert.equal(c.snapshot().status, "paused");
  await c.command("new");
  assert.equal(c.engine.context.list().length, 0);
  assert.equal(c.engine.transcript.size, 0);
  c.close();
});
test("live mode fails clearly without keys and does not silently use demo advice", async () => {
  const c = new CallController();
  await assert.rejects(
    c.command("start", { source: "manual", consent: true }),
    /OpenAI API key/,
  );
  assert.equal(c.engine.cards.length, 0);
  assert.equal(c.engine.status, "idle");
  c.close();
});
test("public configuration never exposes credentials or private paths", () => {
  const config = publicConfig({
    openaiKey: "SECRET_A",
    firefliesKey: "SECRET_B",
    mcpToken: "SECRET_C",
    codexBin: "/private/path",
    fastModel: "test",
  });
  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, /SECRET|private/);
  assert.equal(config.openaiReady, true);
});
test("a live session cannot be relabeled as demo after transcripts exist", async () => {
  const c = new CallController({ config: { openaiKey: "TEST_ONLY" } });
  await c.command("start", { source: "manual", consent: true });
  c.engine.configure = () => {};
  await c.command("transcript", { text: "Real conversation" });
  await c.command("pause");
  await assert.rejects(c.command("start", { source: "demo" }), /another call/);
  c.close();
});

test("a Fireflies transcript can be imported before starting a call but not during the fictional demo", async () => {
  const c = new CallController({ config: { firefliesKey: "TEST_ONLY" } });
  let imports = 0;
  c.fireflies.importTranscript = async (id) => {
    imports++;
    return {
      id,
      title: "Past call",
      text: "Verified past notes",
      kind: "meeting",
    };
  };
  try {
    await c.command("context.fireflies", { id: "past" });
    assert.equal(c.engine.context.list().length, 1);
    assert.equal(imports, 1);
    await c.command("start", { source: "demo" });
    await assert.rejects(
      c.command("context.fireflies", { id: "past" }),
      /unavailable during Practice/,
    );
    assert.equal(imports, 1);
  } finally {
    c.close();
  }
});
test("typed questions stay in the main lane and help hotkeys bypass the proactive confidence gate", async () => {
  const c = new CallController({ demoOnly: true });
  try {
    await c.command("configure", { quiet: true });
    await c.command("start", { source: "demo" });
    const generate = async ({ question }) => ({
      cards: [
        {
          title: "Direct answer",
          body: question,
          say: "A useful answer",
          kind: "answer",
          confidence: 0.1,
          sourceIds: [],
          reason: "Requested",
        },
      ],
    });
    c.engine.providers = { fast: { generate }, strategy: { generate } };
    await c.command("ask", { question: "What is next?", lane: "strategy" });
    assert.equal(c.engine.cards.at(-1).lane, "fast");
    assert.equal(c.engine.cards.at(-1).computedLane, "strategy");
    assert.equal(c.engine.cards.at(-1).origin, "asked");
    assert.equal(c.engine.cards.at(-1).question, "What is next?");
    await c.command("nudge");
    assert.equal(c.engine.cards.at(-1).origin, "nudge");
    assert.equal(c.engine.cards.length, 2);
  } finally {
    c.close();
  }
});
