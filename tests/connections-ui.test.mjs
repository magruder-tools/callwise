import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { settings } from "../ui/views/settings.mjs";
import { CallController } from "../core/controller.mjs";
import { runSelfTest } from "../desktop/self-test.mjs";
const prefs = { tab: "Advanced", devices: [], testResults: [] };
test("advanced connections only offer ready apps and preserve actual app IDs", async () => {
  const c = new CallController({
    contextProvider: {
      cancel() {},
      close() {},
      async inspect() {
        return {
          apps: [
            { id: "mail-id", name: "Mail", ready: true },
            { id: "unavailable", name: "Unavailable", ready: false },
          ],
        };
      },
    },
  });
  try {
    await c.command("context.discover");
    await c.command("configure", {
      contextBackend: "codex",
      contextApps: ["mail-id"],
      contextConsent: true,
    });
    const { document } = parseHTML(settings(c.snapshot(), prefs));
    const mail = document.querySelector('[data-context-app="mail-id"]'),
      unavailable = document.querySelector('[data-context-app="unavailable"]');
    assert.ok(mail.hasAttribute("checked"));
    assert.ok(unavailable.hasAttribute("disabled"));
    await assert.rejects(
      c.command("configure", { contextApps: ["unavailable"] }),
      /ready/,
    );
  } finally {
    c.close();
  }
});
test("AI settings explain real tiny requests and never render credentials", () => {
  const c = new CallController({
    config: { openaiKey: "PRIVATE_TEST_KEY", fastModel: "gpt-5.6-luna" },
  });
  try {
    const html = settings(c.snapshot(), { ...prefs, tab: "AI" });
    assert.doesNotMatch(html, /PRIVATE_TEST_KEY/);
    assert.match(html, /tiny billed/);
    assert.match(html, /Save and test/);
    assert.doesNotMatch(html, /Check model access/);
  } finally {
    c.close();
  }
});
test("setup test performs inference and waits for transcription readiness without capturing audio", async () => {
  let inference = 0,
    connects = 0,
    closes = 0;
  const result = await runSelfTest(
    {
      openaiKey: "TEST_ONLY_KEY",
      fastModel: "gpt-5.6-luna",
      strategyModel: "gpt-6-astra",
      transcriptionModel: "gpt-live-transcribe",
    },
    {
      fetchImpl: async (url, options) => {
        if (url.endsWith("/models")) return new Response("{}", { status: 200 });
        const body = JSON.parse(options.body);
        assert.equal(body.store, false);
        assert.equal(body.stream, true);
        inference++;
        return new Response(JSON.stringify({ output_text: '{"ok":true}' }), {
          headers: { "Content-Type": "application/json" },
        });
      },
      transcriberFactory: () => ({
        async connect() {
          connects++;
        },
        close() {
          closes++;
        },
        push() {
          assert.fail("setup API test must not record");
        },
      }),
    },
  );
  assert.equal(result.length, 4);
  assert.ok(result.every((r) => r.ok));
  assert.equal(inference, 2);
  assert.equal(connects, 1);
  assert.equal(closes, 1);
});
test("a rejected API key names the failure and avoids billable checks", async () => {
  let calls = 0;
  const result = await runSelfTest(
    { openaiKey: "TEST_ONLY_KEY" },
    {
      fetchImpl: async () => {
        calls++;
        return new Response("{}", { status: 401 });
      },
      transcriberFactory: () => assert.fail("must not connect"),
    },
  );
  assert.equal(calls, 1);
  assert.equal(result[0].ok, false);
  assert.match(result[0].detail, /didn't accept/);
});
