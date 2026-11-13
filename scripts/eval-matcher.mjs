import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";
import { LocalEmbedding } from "../desktop/local-embedding.mjs";
import { NativeServices } from "../desktop/native-host.mjs";
import { LocalMatcher, MATCH_BANDS } from "../core/local-matcher.mjs";
import { median } from "../core/cards.mjs";
const root = path.resolve(import.meta.dirname, ".."), data = JSON.parse(readFileSync(path.join(root, "fixtures/match/eval.json")));
const native = process.argv.includes("--native") || process.argv.includes("--record");
const services = native ? new NativeServices({ binary: path.join(root, "native/build/callwise-native"), resources: path.join(root, "native/resources") }) : null;
const local = native ? new LocalEmbedding({ native: services, resources: path.join(root, "native/resources"), preferNative: process.argv.includes("--apple") }) : null;
const vectorsFile = path.join(root, "fixtures/match/matcher-vectors.json.gz");
const captured = native ? {} : JSON.parse(gunzipSync(readFileSync(vectorsFile))).vectors;
const embed = async (texts) => {
  if (!native) return texts.map((t) => { if (!captured[t]) throw new Error(`Missing frozen vector: ${t}`); return captured[t]; });
  const values = await local.embed(texts);
  texts.forEach((t, i) => captured[t] = Array.from(values[i], (v) => +v.toFixed(7)));
  return values;
};
try {
  const matcher = new LocalMatcher({ embed });
  await matcher.setCards(data.cards);
  if (!matcher.available) throw new Error(matcher.error || "Sentence matcher unavailable.");
  const results = [], times = [];
  for (const c of data.cards) for (const [i, q] of [...c.phrasings, ...(c.novelPhrasings || [])].entries()) {
    const start = performance.now(), m = await matcher.match(q);
    times.push(performance.now() - start);
    results.push({ question: q, expected: c.id, chosen: m.score >= MATCH_BANDS.middle ? m.cardId : null, score: m.score, margin: m.margin, split: i >= c.phrasings.length ? "novel" : i % 2 ? "holdout" : "calibration" });
  }
  const negatives = [];
  for (const [kind, questions] of [["offBank", data.offBank], ["nearMiss", data.nearMisses]]) for (const q of questions) {
    const start = performance.now(), m = await matcher.match(q); times.push(performance.now() - start);
    negatives.push({ kind, question: q, chosen: m.score >= MATCH_BANDS.middle ? m.cardId : null, score: m.score, top: m.cardId, margin: m.margin });
  }
  // Real 100-card timing: exact duplicates are distinct IDs only for this latency benchmark.
  const hundred = Array.from({ length: 100 }, (_, i) => ({ ...data.cards[i % data.cards.length], id: `bench-${i}` }));
  await matcher.setCards(hundred); const hundredTimes = [];
  for (const c of data.cards) { const start = performance.now(); await matcher.match(c.phrasings[0]); hundredTimes.push(performance.now() - start); }
  const accuracy = (rows) => rows.filter((r) => r.chosen === r.expected).length / rows.length;
  const reject = (kind) => { const rows = negatives.filter((r) => r.kind === kind); return rows.filter((r) => r.chosen === null).length / rows.length; };
  const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
  const summary = { model: (native ? local.model : JSON.parse(gunzipSync(readFileSync(vectorsFile))).model) + (native ? " (live)" : " (frozen synthetic vectors)"),
    bands: MATCH_BANDS, cards: data.cards.length, onBank: results.length, calibrationAccuracy: accuracy(results.filter((r) => r.split === "calibration")),
    holdoutAccuracy: accuracy(results.filter((r) => r.split === "holdout")), novelParaphraseAccuracy: accuracy(results.filter((r) => r.split === "novel")), onBankAccuracy: accuracy(results), offBankRejection: reject("offBank"), nearMissRejection: reject("nearMiss"),
    medianMs: median(times), p90Ms: percentile(times, .90), hundredCardMedianMs: median(hundredTimes), hundredCardP90Ms: percentile(hundredTimes, .9), hundredCardMaxMs: Math.max(...hundredTimes) };
  if (process.argv.includes("--record")) writeFileSync(vectorsFile, gzipSync(JSON.stringify({ model: local.model, vectors: captured }), { level: 9 }));
  mkdirSync(path.join(root, "artifacts/match"), { recursive: true });
  writeFileSync(path.join(root, "artifacts/match/results.json"), JSON.stringify({ summary, results, negatives }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.onBankAccuracy < .90 || summary.offBankRejection < .95) process.exitCode = 1;
} finally { local?.close(); services?.close(); }
