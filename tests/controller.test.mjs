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
  await assert.rejects(c.command("start", { source: "demo" }), /new session/);
  c.close();
});
