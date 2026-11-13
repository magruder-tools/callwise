import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Tokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-node";
const manifest = JSON.parse(readFileSync(path.join(workerData.resources, "matcher-model.json")));
const directory = path.join(workerData.resources, "matcher");
for (const f of manifest.files) {
  const bytes = readFileSync(path.join(directory, f.file));
  if (bytes.length !== f.bytes || createHash("sha256").update(bytes).digest("hex") !== f.sha256) throw new Error("Offline matcher asset is damaged.");
}
const tokenizer = new Tokenizer(JSON.parse(readFileSync(path.join(directory, "tokenizer.json"))), JSON.parse(readFileSync(path.join(directory, "tokenizer_config.json"))));
const session = await ort.InferenceSession.create(path.join(directory, manifest.files.find((f) => f.file.endsWith(".onnx")).file), { executionProviders: ["cpu"], intraOpNumThreads: 1, interOpNumThreads: 1, graphOptimizationLevel: "all" });
async function embed(texts) {
  const encoded = texts.map((text) => tokenizer.encode(text).ids.slice(0, 256));
  const length = Math.max(...encoded.map((ids) => ids.length)), count = encoded.length;
  const ids = new BigInt64Array(count * length), masks = new BigInt64Array(count * length), types = new BigInt64Array(count * length);
  encoded.forEach((tokens, b) => tokens.forEach((id, i) => { ids[b * length + i] = BigInt(id); masks[b * length + i] = 1n; }));
  const feeds = { input_ids: new ort.Tensor("int64", ids, [count, length]), attention_mask: new ort.Tensor("int64", masks, [count, length]), token_type_ids: new ort.Tensor("int64", types, [count, length]) };
  const outputs = await session.run(Object.fromEntries(session.inputNames.map((name) => [name, feeds[name]])));
  const output = outputs.last_hidden_state || outputs[session.outputNames[0]], dim = output.dims[2];
  if (!dim) throw new Error("Unsupported offline matcher output.");
  return encoded.map((tokens, b) => {
    const result = new Float32Array(dim);
    if (manifest.pooling === "cls") for (let d = 0; d < dim; d++) result[d] = output.data[b * length * dim + d];
    else for (let i = 0; i < tokens.length; i++) for (let d = 0; d < dim; d++) result[d] += output.data[(b * length + i) * dim + d] / tokens.length;
    return result;
  });
}
// Serialize access so concurrent transcript updates cannot queue overlapping native inference calls.
let pending = Promise.resolve();
parentPort.on("message", ({ id, texts }) => {
  pending = pending.then(async () => {
    try { parentPort.postMessage({ id, vectors: await embed(texts) }); }
    catch { parentPort.postMessage({ id, error: "The offline sentence matcher is unavailable." }); }
  });
});
parentPort.postMessage({ ready: true, model: `${manifest.model} int8 (bundled, offline)` });
