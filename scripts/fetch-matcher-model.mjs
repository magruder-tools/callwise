import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."), directory = path.join(root, "native/resources/matcher");
const manifestPath = path.join(root, "native/resources/matcher-model.json");
const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath)) : null;
const bge = process.argv.includes("--bge") || (!process.argv.includes("--minilm") && existing?.model.startsWith("Xenova/"));
const model = bge ? "Xenova/bge-small-en-v1.5" : "sentence-transformers/all-MiniLM-L6-v2";
const revision = bge ? "ea104dacec62c0de699686887e3f920caeb4f3e3" : "1110a243fdf4706b3f48f1d95db1a4f5529b4d41";
const names = [bge ? "onnx/model_int8.onnx" : "onnx/model_qint8_arm64.onnx", "tokenizer.json", "tokenizer_config.json", "README.md"];
const recorded = existing?.model === model ? existing : null;
if (!recorded && !process.argv.includes("--record")) throw new Error("Missing matcher model manifest.");
mkdirSync(directory, { recursive: true });
const files = [];
for (const name of names) {
  const filename = path.join(directory, path.basename(name));
  const prior = process.argv.includes("--refresh") ? null : recorded?.files.find((f) => f.file === path.basename(name));
  let bytes = existsSync(filename) ? readFileSync(filename) : null;
  if (!bytes || !prior || createHash("sha256").update(bytes).digest("hex") !== prior.sha256) {
    const response = await fetch(`https://huggingface.co/${model}/resolve/${revision}/${name}`);
    if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 50 * 1024 * 1024) throw new Error("Matcher asset exceeds its size limit.");
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (prior && hash !== prior.sha256) throw new Error("Matcher checksum mismatch; original asset kept.");
    writeFileSync(filename + ".next", bytes); renameSync(filename + ".next", filename);
  }
  files.push({ file: path.basename(name), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
if (process.argv.includes("--record")) writeFileSync(manifestPath, JSON.stringify({ model, revision, license: bge ? "MIT" : "Apache-2.0", pooling: bge ? "cls" : "mean", files }, null, 2) + "\n");
console.log("Verified the bundled offline sentence model.");
