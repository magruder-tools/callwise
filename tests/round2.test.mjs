import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate as tick } from "node:timers/promises";
import { CallController } from "../core/controller.mjs";
import { CoachEngine } from "../core/engine.mjs";
import { classifyTurn, commitmentCue, isOwnTurn } from "../core/triggers.mjs";
import { concise } from "../core/prompts.mjs";
import { localPrep, localRecap, validateRecap } from "../core/preparation.mjs";
import { card } from "../ui/components/card.mjs";
import { sanitizePreferences } from "../core/preferences.mjs";
import { shortcutKey } from "../ui/shortcuts.mjs";
import { SnapshotStream } from "../core/snapshot-stream.mjs";
import { LiveTranscriber } from "../providers/transcription.mjs";
import { EventEmitter } from "node:events";
import { runSelfTest } from "../desktop/self-test.mjs";
const answer = {
  speak: true,
  kind: "say",
  lead: "Use the evidence from the notes.",
  points: [],
  sourceIds: [],
  covers: [],
};
const digest = {
  people: [],
  facts: [],
  likelyQuestions: [],
  myPoints: [{ text: "A real talking point" }],
  watchFor: [],
  glossary: ["Northstar"],
};
const lines = JSON.parse(
  readFileSync(
    new URL("../fixtures/replay/trigger-lines.json", import.meta.url),
  ),
);
for (const [kind, list] of Object.entries(lines))
  test(`Appendix A: ${kind}`, () => {
    for (const row of list) {
      const result = classifyTurn(
        { ...row, speaker: "Them", channel: "system" },
        row.mode,
      );
      assert.equal(!!result, kind === "needsHelp", row.text);
    }
  });
test("long logistics stay silent after the background delay, while a mixed question still requests help", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 50000 });
  const e = new CoachEngine({
    providers: { fast: { generate: async () => answer } },
  });
  try {
    e.start();
    for (const [index, text] of [
      "Okay, can you hear me with these headphones on now?",
      "Give me one second while I find the right window.",
      "Hold on while I get the audio settings sorted out.",
    ].entries()) {
      e.ingest({
        id: `logistics-${index}`,
        speaker: "Them",
        text,
        startMs: index * 10000,
      });
      t.mock.timers.tick(10000);
      await tick();
      assert.equal(e.metrics.fastCalls, 0, text);
    }
    e.ingest({
      id: "real-question",
      speaker: "Them",
      text: "Can you hear me? So, how would you approach the first month?",
      startMs: 40000,
    });
    assert.equal(e.metrics.fastCalls, 1);
    await tick();
  } finally {
    e.end();
  }
});
test("a wrap-up question calls the model immediately with uncovered points", async () => {
  let prompt;
  const e = new CoachEngine({
    providers: {
      fast: {
        generate: async (args) => {
          prompt = args.prompt;
          return answer;
        },
      },
    },
  });
  try {
    e.start();
    e.prep = { myPoints: [{ id: "one", text: "Reporting owner" }] };
    e.rate = { tokens: 0, at: Date.now(), requests: [] };
    e.ingest({
      id: "wrap",
      speaker: "Them",
      text: "We're at time, so do you have any questions for us?",
    });
    assert.equal(e.metrics.fastCalls, 1);
    assert.match(prompt.input, /wrap_up/);
    assert.match(prompt.input, /Reporting owner/);
    await tick();
    assert.equal(e.cards[0].kind, "say");
  } finally {
    e.end();
  }
});
test("consecutive split segments form one question and receive one request", async () => {
  const e = new CoachEngine({
    providers: { fast: { generate: async () => answer } },
  });
  try {
    e.start();
    e.ingest({
      id: "a",
      speaker: "Them",
      text: "I guess my question",
      startMs: 0,
    });
    assert.equal(e.metrics.fastCalls, 0);
    e.ingest({
      id: "b",
      speaker: "Them",
      text: "is whether you can guarantee results.",
      startMs: 600,
    });
    assert.equal(e.metrics.fastCalls, 1);
    e.ingest({
      id: "c",
      speaker: "Them",
      text: "Or how you would measure success.",
      startMs: 1000,
    });
    assert.equal(e.metrics.fastCalls, 1);
    await tick();
  } finally {
    e.end();
  }
});
test("a delayed quiet check keeps the previous card unchanged", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 50000 });
  let complete;
  const c = new CallController({ demoOnly: true });
  try {
    await c.command("start");
    c.stopInputs();
    c.engine.cards.push({
      ...answer,
      id: "kept",
      origin: "auto",
      lane: "fast",
      status: "new",
      sources: [],
      otherTurn: 0,
    });
    c.engine.providers.fast = {
      generate: () =>
        new Promise((r) => {
          complete = r;
        }),
    };
    c.engine.lastBackground = 0;
    const ui = {};
    const before = card(c.snapshot(), ui);
    c.engine.ingest({
      id: "remark",
      speaker: "Them",
      text: "Our team is working through the reporting details this week.",
    });
    assert.equal(c.engine.metrics.fastCalls, 0);
    t.mock.timers.tick(1200);
    assert.equal(c.engine.metrics.fastCalls, 1);
    assert.equal(card(c.snapshot(), ui), before);
    t.mock.timers.tick(1500);
    complete({ speak: false });
    await tick();
    assert.equal(card(c.snapshot(), ui), before);
  } finally {
    c.close();
  }
});
test("timed notices emit their expiry without any other activity", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const e = new CoachEngine();
  let last;
  e.on("state", (s) => {
    last = s;
  });
  e.error("Temporary warning", { severity: "warning", lifetimeMs: 5000 });
  assert.equal(last.errors.length, 1);
  t.mock.timers.tick(5001);
  assert.equal(last.errors.length, 0);
  e.reset();
});
test("explicit provider failures retain the last card and show an error, not a context fallback", async () => {
  const e = new CoachEngine({
    providers: {
      fast: {
        generate: async () => {
          throw new Error("Network unavailable");
        },
      },
    },
  });
  try {
    e.start();
    e.cards.push({ id: "kept", lane: "fast", lead: "Last good answer" });
    await e.run("fast", "What next?");
    assert.deepEqual(
      e.cards.map((c) => c.id),
      ["kept"],
    );
    assert.equal(e.snapshot().errors[0].message, "Network unavailable");
  } finally {
    e.end();
  }
});
test("failed and cancelled starts emit a usable final connecting state", async () => {
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    transcriberFactory: () => ({
      connect: async () => {
        throw new Error("Rejected key");
      },
      close() {},
    }),
  });
  let last;
  c.on("state", (s) => {
    last = s;
  });
  try {
    await assert.rejects(
      c.command("start", { source: "audio", consent: true }),
      /Rejected key/,
    );
    assert.equal(last.connecting, false);
    c.transcriberFactory = () => {
      let finish;
      return {
        connect: () =>
          new Promise((r) => {
            finish = r;
          }),
        close() {
          finish?.();
        },
      };
    };
    const starting = c.command("start", { source: "audio", consent: true });
    await tick();
    await c.command("pause");
    await starting;
    assert.equal(last.connecting, false);
  } finally {
    c.close();
  }
});
test("the first connection times out in ten seconds, independently of the recovery window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  class HungSocket extends EventEmitter {
    readyState = 0;
    terminate() {}
    close() {}
  }
  const transcriber = new LiveTranscriber({
    apiKey: "TEST_ONLY",
    channel: "mic",
    WebSocketClass: HungSocket,
    onSegment() {},
  });
  const connection = assert.rejects(
    transcriber.connect(),
    /Couldn't reach OpenAI/,
  );
  t.mock.timers.tick(10001);
  await connection;
  assert.equal(transcriber.stopped, true);
});
test("capture failures reach both windows; silent system audio clears when signal returns", async () => {
  const c = new CallController({ demoOnly: true });
  try {
    await c.command("start");
    await c.command("capture.error", {
      message: "Microphone permission refused",
      channel: "mic",
      pause: true,
    });
    assert.equal(c.engine.status, "paused");
    assert.equal(
      c.snapshot().errors.at(-1).message,
      "Microphone permission refused",
    );
    assert.equal(c.snapshot().errors.at(-1).action, "settings");
    c.captureStatus("system", "No signal yet — verify audio");
    c.captureStatus("mic", "receiving");
    assert.ok(c.snapshot().errors.some((e) => e.condition === "silent-system"));
    c.captureStatus("system", "receiving");
    assert.ok(
      !c.snapshot().errors.some((e) => e.condition === "silent-system"),
    );
  } finally {
    c.close();
  }
});
test("network self-tests use a useful connection message", async () => {
  const results = await runSelfTest(
    { openaiKey: "TEST_ONLY" },
    {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    },
  );
  assert.equal(
    results[0].detail,
    "Couldn't reach OpenAI. Check your internet connection.",
  );
});
test("Practice and Another call restore the edited goal and materials", async () => {
  const c = new CallController({ demoOnly: true });
  try {
    await c.command("configure", { goal: "My interview", mode: "interview" });
    await c.command("context.add", { title: "Résumé", text: "My real work" });
    assert.equal(c.sheets[0].line, "My interview");
    await c.command("practice");
    assert.ok(c.engine.context.list().every((d) => d.id.startsWith("demo-")));
    await c.command("end");
    await c.command("new", { clearContext: true });
    assert.equal(c.engine.settings.goal, "My interview");
    assert.equal(c.engine.context.list()[0].title, "Résumé");
  } finally {
    c.close();
  }
});
test("prep retries after a fallback; a 25-second result is adopted with glossary hints", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let finish;
  let fail = true;
  const hints = [];
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    documentProvider: {
      generate: async () => {
        if (fail) throw new Error("Offline");
        return new Promise((r) => {
          finish = r;
        });
      },
    },
  });
  try {
    await c.command("context.add", { title: "Notes", text: "A real example" });
    await c.command("prep.refresh");
    assert.equal(c.engine.prep.fallback, true);
    fail = false;
    const prep = c.command("prep.refresh");
    await c.command("start", { source: "manual", consent: true });
    c.transcribers.set("test", {
      updateHints: (value) => hints.push(value),
      close() {},
    });
    t.mock.timers.tick(25000);
    finish(digest);
    await prep;
    assert.equal(c.engine.prep.fallback, undefined);
    assert.deepEqual(hints[0].keywords, ["Northstar"]);
  } finally {
    c.close();
  }
});
test("late preparation after the adoption window cannot change a call", async () => {
  let finish;
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    documentProvider: {
      generate: () =>
        new Promise((r) => {
          finish = r;
        }),
    },
  });
  try {
    await c.command("context.add", {
      title: "Notes",
      text: "Original evidence",
    });
    const prep = c.command("prep.refresh");
    await c.command("start", { source: "manual", consent: true });
    c.engine.activeMs = 121000;
    finish(digest);
    await prep;
    assert.equal(c.engine.prep.fallback, true);
  } finally {
    c.close();
  }
});
test("a delayed prep failure cannot replace the call's current notes or show a stale notice", async () => {
  let rejectPrep;
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    documentProvider: {
      generate: () =>
        new Promise((_, reject) => {
          rejectPrep = reject;
        }),
    },
  });
  try {
    await c.command("context.add", {
      title: "Notes",
      text: "Original evidence",
    });
    const preparing = c.command("prep.refresh");
    await c.command("start", { source: "manual", consent: true });
    c.engine.activeMs = 121000;
    const notes = c.engine.prep;
    rejectPrep(new Error("Provider failed late"));
    await preparing;
    assert.equal(c.engine.prep, notes);
    assert.equal(
      c.engine.snapshot().errors.some((e) => e.condition === "prep"),
      false,
    );
  } finally {
    c.close();
  }
});
test("local fallbacks do not invent coverage or an email", () => {
  assert.deepEqual(localPrep([], "First interview").myPoints, []);
  assert.equal(
    localRecap(
      [{ id: "one", final: true, text: "Thank you", speaker: "Them" }],
      [],
      "interview",
    ).email,
    "",
  );
  assert.equal(
    localRecap(
      [],
      [
        {
          owner: "Other",
          what: "Send the report",
          due: "Friday",
          segmentId: "one",
        },
      ],
      "client",
    ).whoOwesWhat[0].owner,
    "Them",
  );
});
test("recap accepts model-selected promises with final evidence even without a regex candidate", () => {
  const rows = [
    {
      id: "one",
      final: true,
      speaker: "Them",
      text: "The report will reach you Friday.",
    },
    { id: "partial", final: false, text: "Maybe a promise" },
  ];
  const result = validateRecap(
    {
      whoOwesWhat: [
        {
          owner: "Other",
          what: "Deliver report",
          due: "Friday",
          segmentIds: ["one"],
        },
        { owner: "Them", what: "Made up", due: "", segmentIds: ["partial"] },
      ],
    },
    rows,
    [],
  );
  assert.equal(result.whoOwesWhat.length, 1);
  assert.equal(result.whoOwesWhat[0].owner, "Them");
  assert.equal(result.whoOwesWhat[0].what, "Deliver report");
  assert.equal(result.whoOwesWhat[0].evidence[0].text, rows[0].text);
});
test("Appendix B records only real promises and the optional conditional introduction", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../fixtures/replay/interview-long.json", import.meta.url),
    ),
  );
  assert.deepEqual(
    fixture.turns.filter((r) => commitmentCue(r.text)).map((r) => r.at / 1000),
    [240, 350, 363],
  );
});
test("leads allow complete sentences up to 24 words and trim at a boundary after that", () => {
  const lead =
    "In two weeks, we can give you a decision memo and a small test plan. Can we get those three data sets?";
  assert.equal(concise(lead, 24), lead);
  assert.equal(
    concise(
      lead + " And this additional sentence should not be cut midway.",
      24,
    ),
    lead,
  );
});
test("panel preferences remember width and position, migrate height and the stock goal", () => {
  assert.deepEqual(
    sanitizePreferences({
      panelBounds: { 1: { x: 10, y: 20, width: 440, height: 900 } },
    }).panelBounds[1],
    { x: 10, y: 20, width: 440 },
  );
  assert.equal(
    sanitizePreferences({
      goal: "Have a useful conversation and agree on clear next steps.",
    }).goal,
    "",
  );
  assert.equal(isOwnTurn({ speaker: "Matt" }), false);
  assert.equal(isOwnTurn({ speaker: "Alex" }, "Alex"), true);
});
test("transcript streams send additions, changes, deletions and reset across calls", () => {
  const stream = new SnapshotStream();
  const row = { id: "one", text: "First", final: false };
  assert.ok(stream.pack({ sessionId: "a", transcript: [row] }).transcript);
  assert.deepEqual(
    stream.pack({ sessionId: "a", transcript: [row] }).transcriptDelta,
    [],
  );
  assert.equal(
    stream.pack({ sessionId: "a", transcript: [{ ...row, text: "Changed" }] })
      .transcriptDelta[0].text,
    "Changed",
  );
  assert.deepEqual(
    stream.pack({ sessionId: "a", transcript: [] }).transcriptRemoved,
    ["one"],
  );
  assert.deepEqual(
    stream.pack({ sessionId: "b", transcript: [] }).transcript,
    [],
  );
});
test("a recap fallback can be retried and remains usable while a 25-second model works", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let finish,
    failing = true;
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    documentProvider: {
      generate: async ({ schema }) => {
        if (!schema.properties.email) return digest;
        if (failing) throw new Error("Offline");
        return new Promise((r) => {
          finish = r;
        });
      },
    },
  });
  try {
    await c.command("start", { source: "manual", consent: true });
    c.engine.settings.quiet = true;
    c.engine.ingest({
      id: "promise",
      speaker: "You",
      text: "I'll send the notes by Friday.",
    });
    await c.command("end");
    await tick();
    assert.equal(c.recap.fallback, true);
    assert.equal(c.recap.email, "");
    failing = false;
    const retry = c.command("recap.retry");
    t.mock.timers.tick(25000);
    assert.equal(c.recapping, true);
    assert.equal(c.recap.fallback, true);
    finish({
      whatHappened: ["Agreed the next step"],
      whoOwesWhat: [
        {
          owner: "You",
          what: "Send the notes",
          due: "Friday",
          segmentIds: ["promise"],
        },
      ],
      stillOpen: [],
      email: "Thank you.",
      interview: [],
    });
    await retry;
    assert.equal(c.recapping, false);
    assert.equal(c.recap.fallback, undefined);
    assert.equal(c.recap.whoOwesWhat[0].what, "Send the notes");
  } finally {
    c.close();
  }
});
test("an echo final removes an unfinished microphone row with the same id", () => {
  const e = new CoachEngine({ config: { autoCoach: false } });
  try {
    e.start();
    e.ingest({
      id: "mic",
      channel: "mic",
      text: "The budget should",
      final: false,
      startMs: 0,
    });
    e.ingest({
      id: "system",
      channel: "system",
      text: "The budget should stay the same",
      final: true,
      startMs: 0,
    });
    e.ingest({
      id: "mic",
      channel: "mic",
      text: "The budget should stay the same",
      final: true,
      startMs: 0,
    });
    assert.equal(e.transcript.has("mic"), false);
    assert.equal(e.transcript.size, 1);
  } finally {
    e.end();
  }
});

test("shortcut recording uses physical keys, including Option-modified letters and arrow keys", () => {
  for (const [code, key] of [
    ["KeyP", "P"],
    ["ArrowRight", "Right"],
    ["ArrowLeft", "Left"],
    ["BracketLeft", "["],
    ["BracketRight", "]"],
    ["Space", "Space"],
  ]) {
    const accelerator = `Control+Alt+${shortcutKey(code)}`;
    assert.equal(accelerator, `Control+Alt+${key}`);
    assert.equal(
      sanitizePreferences({ hotkeys: { pause: accelerator } }).hotkeys.pause,
      accelerator,
    );
  }
  assert.equal(shortcutKey("AltLeft"), "");
});
