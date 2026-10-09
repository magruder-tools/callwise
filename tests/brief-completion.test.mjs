import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { CallController } from "../core/controller.mjs";
import { CoachEngine } from "../core/engine.mjs";
import { classifyTurn } from "../core/triggers.mjs";
import { modelOptions } from "../providers/openai.mjs";
import { providerError } from "../providers/errors.mjs";
import { readConfig } from "../core/config.mjs";
import { makePrompt } from "../core/prompts.mjs";
import { errorBanner } from "../ui/components/common.mjs";
import { sanitizeConnections } from "../core/connections.mjs";
import { publicConfig } from "../core/config.mjs";
import { runSelfTest } from "../desktop/self-test.mjs";
import { welcome } from "../ui/views/welcome.mjs";
import { settings } from "../ui/views/settings.mjs";
import { sanitizeSheets } from "../core/call-sheets.mjs";

const answer = {
  speak: true,
  kind: "say",
  lead: "I can explain my real experience.",
  points: [],
  sourceIds: [],
  covers: [],
};
const digest = {
  people: [],
  facts: [],
  likelyQuestions: [],
  myPoints: [],
  watchFor: [],
  glossary: [],
};

test("unchanged preparation is reused across unrelated settings and is rebuilt after either import path", async () => {
  let calls = 0;
  const c = new CallController({
    documentProvider: {
      generate: async () => {
        calls++;
        return digest;
      },
    },
  });
  try {
    await c.command("context.add", {
      title: "First",
      text: "Original material.",
    });
    await c.command("prep.refresh");
    assert.equal(calls, 1);
    await c.command("configure", { inputDevice: "another-mic", quiet: true });
    await c.command("prep.refresh");
    assert.equal(
      calls,
      1,
      "Audio/settings changes should not bill another preparation",
    );
    c.fireflies.importTranscript = async () => ({
      id: "past",
      title: "Past call",
      text: "Imported real evidence.",
    });
    await c.command("context.fireflies", { id: "past" });
    assert.equal(c.engine.prep, null);
    await c.command("prep.refresh");
    assert.equal(calls, 2);
    // Retain the provider's read-only contract; replace the transport in this unit test.
    const { ReadOnlyMcp } = await import("../providers/mcp.mjs");
    const original = ReadOnlyMcp.prototype.search;
    ReadOnlyMcp.prototype.search = async () => "Custom context evidence.";
    try {
      await c.command("context.mcp", { query: "Relevant notes" });
    } finally {
      ReadOnlyMcp.prototype.search = original;
    }
    assert.equal(c.engine.prep, null);
    await c.command("prep.refresh");
    assert.equal(calls, 3);
    await c.command("configure", { goal: "A genuinely different call" });
    await c.command("prep.refresh");
    assert.equal(calls, 4);
  } finally {
    c.close();
  }
});

test("starting a call cancels unfinished preparation and ignores its late result", async () => {
  let finish, signal;
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    documentProvider: {
      generate: (args) => {
        signal = args.signal;
        return new Promise((r) => {
          finish = r;
        });
      },
    },
  });
  try {
    await c.command("context.add", {
      title: "Notes",
      text: "Verified original context.",
    });
    const prep = c.command("prep.refresh");
    await c.command("start", { source: "manual", consent: true });
    assert.equal(signal.aborted, true);
    assert.equal(c.preparing, false);
    finish({ ...digest, people: ["LATE_PREPARATION"] });
    await prep;
    assert.doesNotMatch(JSON.stringify(c.engine.prep), /LATE_PREPARATION/);
    assert.equal(c.engine.prep.facts[0].text, "Verified original context.");
  } finally {
    c.close();
  }
});

test("Fireflies interruptions allow transport recovery, keep the call running, and expose the missing evidence", async () => {
  let status;
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY", firefliesKey: "TEST_ONLY" },
  });
  c.fireflies.connect = async (options) => {
    status = options.onStatus;
    status("connected");
  };
  try {
    await c.command("start", {
      source: "fireflies",
      consent: true,
      transcriptId: "meeting",
    });
    const generation = c.generation;
    status("disconnected");
    status("connection-error");
    assert.equal(c.engine.status, "running");
    assert.equal(c.generation, generation);
    assert.equal(c.capture.system, "reconnecting");
    assert.equal(
      [...c.engine.transcript.values()].filter((r) => r.gap).length,
      1,
    );
    status("connected");
    assert.equal(c.capture.system, "connected");
  } finally {
    c.close();
  }
});

test("a wrap-up question immediately surfaces only the points left to cover", () => {
  const e = new CoachEngine({
    providers: {
      fast: { generate: () => assert.fail("Local coverage needs no provider") },
    },
  });
  try {
    e.start();
    e.prep = {
      myPoints: [
        { id: "one", text: "Budget and reporting" },
        { id: "two", text: "Start date and owner" },
      ],
    };
    e.covered.add("one");
    assert.equal(
      classifyTurn({ channel: "system", text: "Do you have anything else?" }),
      "wrap_up",
    );
    e.ingest({ id: "wrap", channel: "system", text: "Anything else?" });
    assert.equal(e.cards.length, 1);
    assert.equal(e.cards[0].kind, "heads_up");
    assert.deepEqual(e.cards[0].points, [
      { label: "Cover", text: "Start date and owner" },
    ]);
    assert.equal(e.metrics.fastCalls, 0);
  } finally {
    e.end();
  }
});

test("Fireflies pause/resume reuses its meeting ID, and a new call clears it", async () => {
  const ids = [];
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY", firefliesKey: "TEST_ONLY" },
  });
  c.fireflies.connect = async ({ transcriptId }) => {
    ids.push(transcriptId);
  };
  try {
    await c.command("start", {
      source: "fireflies",
      consent: true,
      transcriptId: "current-meeting",
    });
    await c.command("pause");
    await c.command("start", { source: "fireflies", consent: true });
    assert.deepEqual(ids, ["current-meeting", "current-meeting"]);
    await c.command("new");
    assert.equal(c.firefliesTranscriptId, "");
  } finally {
    c.close();
  }
});

test("backchannels stay silent even when a background check is due", async () => {
  let now = 0;
  const e = new CoachEngine({
    clock: () => now,
    providers: { fast: { generate: async () => answer } },
  });
  try {
    e.start();
    now = 50000;
    e.ingest({
      id: "backchannel",
      channel: "system",
      text: "Right okay got it thanks",
    });
    await tick();
    assert.equal(e.metrics.fastCalls, 0);
    assert.equal(e.cards.length, 0);
  } finally {
    e.end();
  }
});

test("pause and end discard interrupted streaming drafts, including providers that ignore cancellation", async () => {
  for (const action of ["pause", "end"]) {
    let finish;
    const e = new CoachEngine({
      config: { autoCoach: false },
      providers: {
        fast: {
          generate: ({ onPartial }) => {
            onPartial(answer);
            return new Promise((r) => {
              finish = r;
            });
          },
        },
      },
    });
    try {
      e.start();
      const work = e.run("fast", "Help me answer");
      assert.equal(e.cards[0].streaming, true);
      e[action]();
      assert.equal(e.cards.length, 0);
      finish(answer);
      await work;
      assert.equal(e.cards.length, 0);
    } finally {
      e.end();
    }
  }
});

test("pin and Not useful survive more streamed tokens and completion", async () => {
  for (const dismissed of [false, true]) {
    let finish, partial;
    const e = new CoachEngine({
      config: { autoCoach: false },
      providers: {
        fast: {
          generate: ({ onPartial }) => {
            partial = onPartial;
            onPartial(answer);
            return new Promise((r) => {
              finish = r;
            });
          },
        },
      },
    });
    try {
      e.start();
      const work = e.run("fast", "Help me answer");
      if (dismissed) e.feedback(e.cards[0].id, "dismissed");
      else e.cards[0].pinned = true;
      partial({
        ...answer,
        lead: "I can explain my real experience in detail.",
      });
      finish(answer);
      await work;
      assert.equal(e.cards.length, 1);
      if (dismissed) assert.equal(e.cards[0].status, "dismissed");
      else assert.equal(e.cards[0].pinned, true);
    } finally {
      e.end();
    }
  }
});

test("a lead painted on time does not become late merely because completion is slow", async () => {
  let now = 0,
    partial,
    finish;
  const e = new CoachEngine({
    clock: () => now,
    config: { autoCoach: false },
    providers: {
      fast: {
        generate: ({ onPartial }) => {
          partial = onPartial;
          return new Promise((r) => {
            finish = r;
          });
        },
      },
    },
  });
  try {
    e.start();
    e.ingest({
      id: "question",
      channel: "system",
      text: "How did that campaign work?",
    });
    const work = e.run("fast");
    now = 1000;
    partial(answer);
    now = 2000;
    e.ingest({
      id: "me",
      channel: "mic",
      text: "I can explain my example",
      final: false,
    });
    now = 9000;
    finish(answer);
    await work;
    assert.equal(e.cards[0].late, false);
    assert.equal(e.cards[0].latency.firstPaintAt, 1000);
  } finally {
    e.end();
  }
});

test("explicit deeper-model requests expose their trigger in the main card while thinking", async () => {
  let finish;
  const e = new CoachEngine({
    providers: {
      strategy: {
        generate: () =>
          new Promise((r) => {
            finish = r;
          }),
      },
    },
  });
  try {
    e.start();
    const work = e.run("strategy", "What did my notes say?", {
      presentationLane: "fast",
    });
    assert.equal(e.snapshot().pendingTrigger.text, "What did my notes say?");
    assert.equal(e.snapshot().thinking.fast, true);
    finish(answer);
    await work;
  } finally {
    e.end();
  }
});

test("provider errors have a single human-readable action and never echo upstream bodies", () => {
  for (const [metadata, action, label] of [
    [{ status: 401 }, "replace-key", "Replace key"],
    [
      { status: 429, code: "insufficient_quota" },
      "open-billing",
      "Open billing",
    ],
    [{ status: 404 }, "reset-models", "Use recommended models"],
  ]) {
    const e = new CoachEngine();
    try {
      e.error(providerError(metadata));
      assert.equal(e.errors[0].action, action);
      assert.match(errorBanner(e.snapshot()), new RegExp(label));
      assert.doesNotMatch(errorBanner(e.snapshot()), /Connections/);
    } finally {
      e.end();
    }
  }
});

test("packaged configuration can ignore plaintext environment credentials and GPT-6.1 Sol receives a supported effort", () => {
  const config = readConfig([], { environment: {} });
  assert.equal(config.openaiKey, "");
  assert.equal(config.firefliesKey, "");
  assert.equal(config.mcpToken, "");
  assert.equal(modelOptions("gpt-6.1-sol").reasoning.effort, "low");
  assert.equal(modelOptions("gpt-6.1-sol-2026-10-09").reasoning.effort, "low");
});

test("prompt coverage and trigger classification are volatile data without changing the stable prefix", () => {
  const prompt = makePrompt({
    lane: "fast",
    mode: "client",
    goal: "Review the project",
    profile: "",
    transcript: [],
    sources: [],
    previousCards: [],
    prep: {
      myPoints: [
        { id: "a", text: "Budget" },
        { id: "b", text: "Owner" },
      ],
    },
    covered: ["a"],
    triggerKind: "wrap_up",
  });
  const data = JSON.parse(prompt.input);
  assert.deepEqual(data.uncoveredPoints, [{ id: "b", text: "Owner" }]);
  assert.equal(data.triggerKind, "wrap_up");
});

test("custom context settings are saved without plaintext configuration or weakening the server policy", () => {
  const config = sanitizeConnections({
    mcpUrl: "https://context.example/search",
    mcpToken: "PRIVATE_SERVER_TOKEN",
    mcpSearchTool: "notes.search",
    mcpSearchArguments: '{"query":"{{query}}"}',
  });
  assert.equal(config.mcpToken, "PRIVATE_SERVER_TOKEN");
  assert.equal(config.mcpSearchTool, "notes.search");
  assert.equal(publicConfig(config).mcpReady, true);
  assert.doesNotMatch(
    JSON.stringify(publicConfig(config)),
    /PRIVATE_SERVER_TOKEN|context\.example/,
  );
  assert.throws(
    () => sanitizeConnections({ mcpUrl: "http://remote.example/search" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      sanitizeConnections({
        mcpUrl: "https://user:password@context.example/search",
      }),
    /private token/,
  );
  assert.throws(
    () => sanitizeConnections({ mcpSearchArguments: "[]" }),
    /JSON object/,
  );
  const c = new CallController();
  try {
    const html = settings(c.snapshot(), { tab: "Advanced", testResults: [] });
    for (const field of [
      "mcpUrl",
      "mcpToken",
      "mcpSearchTool",
      "mcpSearchArguments",
    ])
      assert.ok(html.includes(`data-connection="${field}"`));
    assert.doesNotMatch(
      html,
      /credentials remain in development configuration/,
    );
  } finally {
    c.close();
  }
});

test("first-run results show latency and each failure's fix; microphone permissions have their own pane action", async () => {
  const results = await runSelfTest(
    { openaiKey: "TEST_ONLY" },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { message: "PRIVATE_UPSTREAM_BODY" } }),
          { status: 401 },
        ),
    },
  );
  assert.equal(results[0].action, "replace-key");
  const c = new CallController();
  try {
    const ui = {
      welcomeStep: 0,
      checking: false,
      testResults: [
        ...results,
        { label: "Fast answers", ok: true, detail: "Passed", elapsedMs: 123 },
      ],
      devices: [],
    };
    const html = welcome(c.snapshot(), ui);
    assert.match(html, /123 ms/);
    assert.match(html, /data-action="replace-key"/);
    assert.doesNotMatch(html, /PRIVATE_UPSTREAM_BODY/);
    assert.match(
      welcome(c.snapshot(), { ...ui, welcomeStep: 1 }),
      /data-action="permissions-mic"/,
    );
  } finally {
    c.close();
  }
});

test("reused call materials retain connector provenance without storing transcript or cards", () => {
  const saved = sanitizeSheets([
    {
      id: "call",
      materials: [
        {
          id: "source",
          text: "Verified excerpt",
          provenance: {
            provider: "codex",
            appId: "drive",
            appName: "Drive",
            action: "search",
            secret: "DROP_THIS",
          },
          retrievedAt: "2026-10-09T18:00:00Z",
        },
      ],
      history: [],
      transcript: "PRIVATE_CALL",
    },
  ]);
  assert.equal(saved[0].materials[0].provenance.action, "search");
  assert.equal(saved[0].materials[0].retrievedAt, "2026-10-09T18:00:00Z");
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_CALL|DROP_THIS/);
});
