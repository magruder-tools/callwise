import { readFile, readdir } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { CoachEngine } from "../core/engine.mjs";
import { OpenAIProvider } from "../providers/openai.mjs";
const args = process.argv.slice(2),
  live = args.includes("--live"),
  compare = args.includes("--compare"),
  delay = Number(
    args.find((a) => a.startsWith("--delay="))?.split("=")[1] || 50,
  );
if (compare && !live)
  throw new Error(
    "Use --live --compare explicitly to make billed model requests.",
  );
if (live && !process.env.OPENAI_API_KEY)
  throw new Error(
    "Live replay needs OPENAI_API_KEY. Offline replay never reads credentials.",
  );
const models = compare
  ? ["gpt-5.6-luna", "gpt-6-luna"]
  : [
      args.find((a) => a.startsWith("--model="))?.split("=")[1] ||
        "gpt-5.6-luna",
    ];
let failed = false;
for (const model of models) {
  const samples = [];
  for (const name of (
    await readdir(new URL("../fixtures/replay/", import.meta.url))
  ).filter((n) => n.endsWith(".json"))) {
    const fixture = JSON.parse(
      await readFile(
        new URL(`../fixtures/replay/${name}`, import.meta.url),
        "utf8",
      ),
    );
    let offset = 0,
      expected;
    const clock = () => offset + performance.now();
    const provider = live
      ? new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY, model, clock })
      : {
          generate: async ({ sources, onToken, onPartial, lane }) => {
            await wait(delay);
            onToken?.(clock());
            const result = {
              speak: expected.expected !== "silent",
              kind: lane === "strategy" ? "bigger_picture" : expected.expected,
              lead: `I can help with ${expected.id} using the supplied notes.`,
              points: [],
              sourceIds:
                expected.expected === "fact"
                  ? sources.slice(0, 1).map((s) => s.id)
                  : [],
              covers: [],
            };
            onPartial?.(result);
            return result;
          },
        };
    const engine = new CoachEngine({
      clock,
      providers: { fast: provider, strategy: provider },
    });
    engine.configure({ mode: fixture.type, goal: fixture.line });
    for (const d of fixture.materials) engine.context.add(d);
    engine.start();
    console.log(`\n${name} — ${live ? model : "offline stub"}`);
    for (const turn of fixture.turns) {
      expected = turn;
      offset = turn.at - performance.now();
      const before = engine.metrics.fastCalls;
      if (turn.partial) {
        engine.ingest({
          ...turn,
          text: turn.partial,
          final: false,
          startMs: turn.at,
        });
        await wait(280);
      }
      engine.ingest({ ...turn, final: true, startMs: turn.at });
      const until = performance.now() + (live ? 16000 : 1000);
      while (engine.inflight.fast && performance.now() < until) await wait(5);
      const card = engine.cards.find((c) => c.trigger?.segmentId === turn.id),
        requested = engine.metrics.fastCalls > before;
      const timing = card
        ? Math.round(card.latency.firstPaintAt - card.latency.turnEndedAt)
        : null;
      if (card && turn.expected !== "silent") samples.push(timing);
      const ok = turn.mustSkip
        ? !requested
        : turn.expected === "silent"
          ? !card
          : !!card;
      if (!ok) failed = true;
      console.log(
        JSON.stringify({
          turn: turn.id,
          expected: turn.expected,
          requested,
          appeared: !!card,
          delayMs: timing,
          kind: card?.kind,
          lead: card?.lead,
          ok,
        }),
      );
    }
    engine.end();
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] ?? null,
    p90 =
      samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.9))] ??
      null;
  console.log(
    JSON.stringify({
      model: live ? model : "stub",
      samples: samples.length,
      medianMs: median,
      p90Ms: p90,
      scope:
        "turn-trigger to engine first paint; excludes real transcription and browser rendering",
    }),
  );
  if (!live && (median === null || median >= 300)) failed = true;
}
if (failed) process.exitCode = 1;
