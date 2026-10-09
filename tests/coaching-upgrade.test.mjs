import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { CoachEngine } from "../core/engine.mjs";
import {
  classifyTurn,
  consumeToken,
  editRatio,
  echoMatch,
} from "../core/triggers.mjs";
import { modelOptions, OpenAIProvider } from "../providers/openai.mjs";
import { partialAdvice } from "../providers/stream-json.mjs";
import { makePrompt } from "../core/prompts.mjs";
import { DEMO_TRANSCRIPT } from "../fixtures/demo.mjs";
const answer = {
  speak: true,
  kind: "say",
  lead: "I can explain my actual experience.",
  points: [],
  sourceIds: [],
  covers: [],
};
const tick = () => new Promise((r) => setImmediate(r));
test("turn patterns, playbooks, own speech and backchannels are deterministic", () => {
  for (const [text, mode, channel, wanted] of [
    ["How did you measure this result?", "interview", "system", "question"],
    ["Right okay got it", "client", "system", null],
    ["We tried the last agency already", "sales", "system", "concern"],
    ["Our budget is $10000 per month", "client", "system", "fact"],
    ["Our budget is $10000 per month", "interview", "system", null],
    ["I'll send the signed agreement", "general", "system", "commitment"],
    ["How did you measure this result?", "sales", "mic", null],
  ])
    assert.equal(
      classifyTurn({ text, channel, speaker: "Other" }, mode),
      wanted,
      text,
    );
  assert.equal(
    classifyTurn(
      {
        text: "How do we compare these numbers?",
        channel: "meeting",
        speaker: "Matthew Magruder",
      },
      "general",
      "Matthew Magruder",
    ),
    null,
  );
});
test("proactive bucket allows a burst of three, at most eight in a minute, and recovers", () => {
  let state;
  for (let i = 0; i < 3; i++) {
    const r = consumeToken(state, 0);
    assert.equal(r.allowed, true);
    state = r.state;
  }
  assert.equal(consumeToken(state, 0).allowed, false);
  for (let at = 7500; at <= 37500; at += 7500) {
    const r = consumeToken(state, at);
    assert.equal(r.allowed, true);
    state = r.state;
  }
  assert.equal(consumeToken(state, 45000).allowed, false);
  assert.equal(consumeToken(state, 61000).allowed, true);
});
test("every eligible fixture turn gets help promptly; own speech, backchannels and repeats get no request", async () => {
  for (const name of await readdir(
    new URL("../fixtures/replay/", import.meta.url),
  )) {
    const f = JSON.parse(
      await readFile(
        new URL(`../fixtures/replay/${name}`, import.meta.url),
        "utf8",
      ),
    );
    let now = 0,
      current;
    const e = new CoachEngine({
      clock: () => now,
      providers: {
        fast: {
          generate: async () => ({
            ...answer,
            lead: `I can help with ${current.id}.`,
            kind: current.expected,
            sourceIds:
              current.expected === "fact"
                ? f.materials.slice(0, 1).map((d) => d.id)
                : [],
          }),
        },
        strategy: { generate: async () => ({ speak: false }) },
      },
    });
    try {
      e.configure({ mode: f.type });
      f.materials.forEach((d) => e.context.add(d));
      e.start();
      for (const row of f.turns) {
        now = row.at;
        current = row;
        const calls = e.metrics.fastCalls;
        e.ingest({ ...row, startMs: now, final: true });
        await tick();
        const card = e.cards.find((c) => c.trigger.segmentId === row.id);
        if (row.mustSkip) assert.equal(e.metrics.fastCalls, calls, row.id);
        else if (row.expected !== "silent") {
          assert.ok(card, row.id);
          assert.ok(
            card.latency.firstPaintAt - card.latency.turnEndedAt < 1000,
            row.id,
          );
        }
      }
    } finally {
      e.end();
    }
  }
});
test("every client question in the original demo receives a card within one second", async () => {
  let now = 0;
  const e = new CoachEngine({
    clock: () => now,
    providers: {
      fast: {
        generate: async ({ transcript }) => ({
          ...answer,
          lead: `I would clarify question${transcript.at(-1).id.replace(/[^a-z0-9]/g, "")}.`,
        }),
      },
      strategy: { generate: async () => ({ speak: false }) },
    },
  });
  try {
    e.start();
    for (const [i, row] of DEMO_TRANSCRIPT.entries()) {
      now = row.at;
      e.ingest({ ...row, id: `original-${i}`, startMs: row.at });
      await tick();
      if (row.speaker !== "You" && row.text.endsWith("?"))
        assert.ok(
          e.cards.some(
            (c) =>
              c.trigger.segmentId === `original-${i}` &&
              c.latency.firstPaintAt - c.latency.turnEndedAt < 1000,
          ),
          row.text,
        );
    }
  } finally {
    e.end();
  }
});
test("a stable speculative question keeps one request; a changed final aborts and restarts", async () => {
  for (const changed of [false, true]) {
    let calls = 0,
      aborts = 0;
    const e = new CoachEngine({
      providers: {
        fast: {
          generate: ({ signal }) => {
            calls++;
            return new Promise((resolve) =>
              signal.addEventListener(
                "abort",
                () => {
                  aborts++;
                  resolve(answer);
                },
                { once: true },
              ),
            );
          },
        },
      },
    });
    try {
      e.start();
      e.ingest({
        id: "p",
        channel: "system",
        text: "Can you explain the results of that campaign?",
        final: false,
      });
      await wait(275);
      assert.equal(calls, 1);
      e.ingest({
        id: "p",
        channel: "system",
        text: changed
          ? "How do you choose an agency for this project?"
          : "Can you explain the results of that campaign?",
        final: true,
      });
      await tick();
      assert.equal(calls, changed ? 2 : 1);
      assert.equal(aborts, changed ? 1 : 0);
    } finally {
      e.end();
    }
  }
});
test("streamed lead paints before completion; unsupported fact citations never survive", async () => {
  let finish;
  const e = new CoachEngine({
    config: { autoCoach: false },
    providers: {
      fast: {
        generate: async ({ onPartial, onToken }) => {
          onToken(Date.now());
          onPartial({ ...answer, lead: "I can answer now." });
          await new Promise((r) => (finish = r));
          return { ...answer, lead: "I can answer now." };
        },
      },
    },
  });
  try {
    e.start();
    e.ingest({ id: "a", text: "How does the work happen?", speaker: "Other" });
    const task = e.run("fast");
    assert.equal(e.cards[0].streaming, true);
    assert.equal(e.cards[0].lead, "I can answer now.");
    finish();
    await task;
    assert.equal(e.cards[0].streaming, undefined);
    assert.ok(e.cards[0].latency.doneAt >= e.cards[0].latency.firstPaintAt);
  } finally {
    e.end();
  }
});
test("explicit help cancels proactive work across lanes, skips caps and always shows a fallback", async () => {
  let aborted = 0;
  const e = new CoachEngine({
    config: { autoCoach: false, maxFast: 0 },
    providers: {
      strategy: {
        generate: ({ signal }) =>
          new Promise((r) =>
            signal.addEventListener("abort", () => {
              aborted++;
              r(answer);
            }),
          ),
      },
      fast: { generate: async () => ({ speak: false }) },
    },
  });
  try {
    e.start();
    e.ingest({ id: "a", text: "How should we decide?", speaker: "Other" });
    const auto = e.run("strategy");
    await e.run("fast", "What should I say?");
    await auto;
    assert.equal(aborted, 1);
    assert.equal(e.cards.at(-1).origin, "asked");
    assert.match(e.cards.at(-1).lead, /verified context/);
  } finally {
    e.end();
  }
});
test("late proactive help stays in history and explicit help remains visible", async () => {
  let now = 0,
    finish;
  const e = new CoachEngine({
    clock: () => now,
    config: { autoCoach: false },
    providers: { fast: { generate: () => new Promise((r) => (finish = r)) } },
  });
  try {
    e.start();
    e.ingest({
      id: "them",
      channel: "system",
      speaker: "Other",
      text: "What should we decide?",
    });
    const p = e.run("fast");
    now = 1000;
    e.ingest({
      id: "you",
      channel: "mic",
      speaker: "You",
      text: "I would take the smaller option.",
      final: false,
    });
    now = 7001;
    finish(answer);
    await p;
    assert.equal(e.cards.at(-1).late, true);
    const asked = e.run("fast", "What did I miss?");
    now = 14000;
    finish(answer);
    await asked;
    assert.equal(e.cards.at(-1).late, false);
  } finally {
    e.end();
  }
});
test("echo removal prioritizes call audio and keeps unrelated own speech", () => {
  const e = new CoachEngine({ config: { autoCoach: false } });
  try {
    e.start();
    const a = {
      id: "m",
      channel: "mic",
      speaker: "You",
      text: "Could you walk me through the plan?",
      startMs: 1000,
      endMs: 4000,
    };
    e.ingest(a);
    e.ingest({ ...a, id: "s", channel: "system", speaker: "Other" });
    assert.equal(e.transcript.has("m"), false);
    assert.equal(e.transcript.has("s"), true);
    e.ingest({
      ...a,
      id: "own",
      text: "I suggest a different approach for this project.",
    });
    assert.equal(e.transcript.has("own"), true);
  } finally {
    e.end();
  }
});
test("prompt prefix remains identical across turns and oversized materials use excerpts", () => {
  const args = {
    lane: "fast",
    mode: "client",
    goal: "Call",
    profile: "About me",
    transcript: [],
    sources: [],
    materials: [{ id: "m", title: "Notes", text: "Full material" }],
    previousCards: [],
  };
  const a = makePrompt(args),
    b = makePrompt({
      ...args,
      transcript: [{ speaker: "Other", text: "New turn", startMs: 10 }],
    });
  const da = JSON.parse(a.input),
    db = JSON.parse(b.input);
  assert.deepEqual(da.materials, db.materials);
  assert.equal(da.materials[0].text, "Full material");
  assert.equal(a.instructions, b.instructions);
  const huge = makePrompt({
    ...args,
    materials: [{ id: "m", title: "Huge", text: "x".repeat(80001) }],
    sources: [{ id: "m", title: "Huge", excerpt: "Relevant excerpt" }],
  });
  assert.equal(huge.materialBudget.full, false);
  assert.equal(JSON.parse(huge.input).materials[0].text, "Relevant excerpt");
});
function stream(chunks) {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const chunk of chunks)
          c.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`),
          );
        c.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
test("Responses SSE decodes split JSON and cancels speak:false", async () => {
  let partials = [];
  const p = new OpenAIProvider({
    apiKey: "TEST_ONLY",
    model: "gpt-6-luna",
    fetchImpl: async () =>
      stream([
        {
          type: "response.output_text.delta",
          delta: '{"speak":true,"kind":"say","lead":"I can ',
        },
        {
          type: "response.output_text.delta",
          delta: 'help.","points":[],"sourceIds":[],"covers":[]}',
        },
        {
          type: "response.completed",
          response: {
            status: "completed",
            usage: { input_tokens: 10, output_tokens: 12 },
          },
        },
      ]),
  });
  const result = await p.generate({
    prompt: { instructions: "Test", input: "Data" },
    onPartial: (x) => partials.push(x),
  });
  assert.equal(partials[0].lead, "I can ");
  assert.equal(result.lead, "I can help.");
  assert.equal(result.usage.output_tokens, 12);
  p.fetch = async () =>
    stream([
      { type: "response.output_text.delta", delta: '{"speak":false' },
      { type: "response.output_text.delta", delta: "PRIVATE_INVALID" },
    ]);
  assert.equal((await p.generate({ prompt: {} })).speak, false);
});
test("a transient server failure retries once; authentication failures never retry", async () => {
  let calls = 0;
  const p = new OpenAIProvider({
    apiKey: "TEST_ONLY",
    model: "gpt-6-luna",
    fetchImpl: async () =>
      ++calls === 1
        ? new Response("{}", { status: 503 })
        : new Response(JSON.stringify({ output_text: JSON.stringify(answer) })),
  });
  await p.generate({ prompt: {} });
  assert.equal(calls, 2);
  calls = 0;
  p.fetch = async () => {
    calls++;
    return new Response("{}", { status: 401 });
  };
  await assert.rejects(p.generate({ prompt: {} }), (e) => e.status === 401);
  assert.equal(calls, 1);
});

test("Astra setup uses its supported lowest effort, while Luna can use none", () => {
  assert.equal(modelOptions("gpt-6-astra").reasoning.effort, "low");
  assert.equal(modelOptions("gpt-6-luna").reasoning.effort, "none");
  assert.equal(modelOptions("gpt-5.6-luna").reasoning.effort, "none");
});
