import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const resources = path.resolve(import.meta.dirname, "../native/resources");
const manifest = JSON.parse(
  readFileSync(path.join(resources, "diarization-models.json")),
);
if (!/^[a-f0-9]{40}$/.test(manifest.revision))
  throw new Error("Speaker models require an immutable repository revision.");
for (const file of manifest.files) {
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(file.path) ||
    file.path.split("/").includes("..") ||
    file.path.startsWith("/") ||
    !/^[a-f0-9]{64}$/.test(file.sha256)
  )
    throw new Error("Invalid speaker model manifest.");
  const target = path.join(resources, "models", file.path);
  const valid = (bytes) =>
    bytes.length === file.size &&
    createHash("sha256").update(bytes).digest("hex") === file.sha256;
  if (existsSync(target) && valid(readFileSync(target))) continue;
  if (process.argv.includes("--verify-only"))
    throw new Error(`Missing or invalid speaker model: ${file.path}`);
  const url = `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${file.path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok)
    throw new Error(`Speaker model download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes))
    throw new Error(`Speaker model integrity check failed: ${file.path}`);
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.download`;
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, target);
  } finally {
    rmSync(temp, { force: true });
  }
  console.log(`Verified ${file.path}`);
}
console.log(
  `All ${manifest.files.length} speaker model files verified at ${manifest.revision}.`,
);
