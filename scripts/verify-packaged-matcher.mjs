// Run with ELECTRON_RUN_AS_NODE=1 using the signed app executable. Synthetic data only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2]), resources = path.resolve(process.argv[3]);
const { LocalEmbedding } = await import(pathToFileURL(path.join(root, "desktop/local-embedding.mjs")).href);
const { LocalMatcher } = await import(pathToFileURL(path.join(root, "core/local-matcher.mjs")).href);
const data = JSON.parse(readFileSync("fixtures/match/eval.json"));
const embedding = new LocalEmbedding({ resources });
try {
  const matcher = new LocalMatcher({ embed: texts => embedding.embed(texts) });
  await matcher.setCards(data.cards);
  assert.equal(matcher.available, true, matcher.error);
  assert.match(embedding.model, /bge-small/);
  const start = performance.now();
  const result = await matcher.match(data.cards[0].phrasings[0]);
  assert.equal(result.cardId, data.cards[0].id); assert.ok(result.score >= .6);
  const elapsed = performance.now() - start;
  console.log(`Packaged offline matcher passed: actual bundled worker, ONNX native library, verified local assets, ${embedding.model}, synthetic question matched in ${elapsed.toFixed(2)} ms. No network provider used.`);
} finally { embedding.close(); }
