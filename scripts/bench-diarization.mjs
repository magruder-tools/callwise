// Smoke-test bundled speaker models with a synthetic file, never a live microphone.
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { NativeHost } from "../desktop/native-host.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  dir = mkdtempSync(path.join(os.tmpdir(), "callwise-diarization-"));
const host = new NativeHost({
  binary: path.join(root, "native/build/callwise-native"),
  resources: path.join(root, "native/resources"),
  mode: "diarize",
});
try {
  const file = path.join(dir, "voice.wav");
  const result = spawnSync(
    "/usr/bin/say",
    [
      "--file-format=WAVE",
      "--data-format=LEI16@24000",
      "-r",
      "150",
      "-o",
      file,
      "We should review the launch plan together. I will send the revised proposal on Friday. The budget discussion can wait until our next meeting. Please bring your notes and the latest design.",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error("Could not create synthetic audio.");
  const wav = readFileSync(file);
  let pcm;
  for (let at = 12; at + 8 < wav.length; ) {
    const size = wav.readUInt32LE(at + 4);
    if (wav.toString("ascii", at, at + 4) === "data") {
      pcm = wav.subarray(at + 8, at + 8 + size);
      break;
    }
    at += 8 + size + (size % 2);
  }
  await host.request("start");
  for (let offset = 0; offset < pcm.length; offset += 4800)
    host.send({
      op: "push",
      audio: pcm.subarray(offset, offset + 4800).toString("base64"),
      startMs: offset / 48,
    });
  const started = Date.now(),
    data = await host.request("finish", {}, { timeout: 120000 });
  if (!Array.isArray(data.turns) || !data.turns.length)
    throw new Error("Bundled models returned no speaker turns.");
  const report = {
    syntheticOnly: true,
    audioSeconds: pcm.length / 48000,
    processingMs: Date.now() - started,
    turns: data.turns,
    note: "One synthetic voice: verifies offline model loading and inference, not real group-call diarization accuracy.",
  };
  mkdirSync(path.join(root, "artifacts"), { recursive: true });
  writeFileSync(
    path.join(root, "artifacts/local-diarization-benchmark.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  host.close();
  rmSync(dir, { recursive: true, force: true });
}
