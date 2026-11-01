// Synthetic file input only. This script never opens a microphone or captures a call.
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppleSpeechSession } from "../providers/apple-speech.mjs";
import { NativeHost, NativeServices } from "../desktop/native-host.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  directory = mkdtempSync(path.join(os.tmpdir(), "callwise-synthetic-"));
const expected =
  "Thanks for joining our meeting today. We agreed to send the updated proposal on Friday. Taylor will review the budget and Morgan will prepare the launch notes. Our next conversation is about the design and the schedule. Please keep the original notes and check every action before sharing it.";
const paths = {
  binary: path.join(root, "native/build/callwise-native"),
  resources: path.join(root, "native/resources"),
};
function pcmFromWav(bytes) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", offset, offset + 4),
      length = bytes.readUInt32LE(offset + 4);
    if (kind === "data") return bytes.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  throw new Error("Synthetic WAV did not contain PCM.");
}
function wer(reference, hypothesis) {
  const words = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean);
  const a = words(reference),
    b = words(hypothesis),
    dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1]),
      );
  return dp[a.length][b.length] / a.length;
}
let speech;
try {
  const file = path.join(directory, "synthetic.wav");
  const say = spawnSync(
    "/usr/bin/say",
    [
      "--file-format=WAVE",
      "--data-format=LEI16@24000",
      "-r",
      "170",
      "-o",
      file,
      expected,
    ],
    { encoding: "utf8" },
  );
  if (say.status !== 0)
    throw new Error("Synthetic speech could not be created.");
  const pcm = pcmFromWav(readFileSync(file)),
    rows = new Map(),
    latencies = [],
    started = Date.now();
  speech = new AppleSpeechSession({
    ...paths,
    channels: process.argv.includes("--dual") ? ["mic", "system"] : ["system"],
    language: "en-US",
    hostFactory: (options) => {
      const h = new NativeHost(options);
      h.on("message", (m) => {
        if (m.type === "error") console.log("native_error", m);
      });
      h.on("exit", (code) => console.log("native_exit", code));
      return h;
    },
  });
  const adapters = speech.channels.map((channel) =>
    speech.adapter({
      channel,
      onSegment: (row) => rows.set(row.id, row),
      onStatus: (status) => console.log(channel, status),
    }),
  );
  await Promise.all(adapters.map((adapter) => adapter.connect()));
  const connected = Date.now();
  for (let offset = 0; offset < pcm.length; offset += 4800) {
    const packet = pcm.subarray(offset, offset + 4800);
    for (const adapter of adapters)
      adapter.push(packet, (offset + packet.length) / 48);
    const target = connected + (offset + packet.length) / 48;
    const remaining = target - Date.now();
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  }
  const end = Date.now();
  await Promise.all(
    adapters.map((adapter) => adapter.finish({ timeoutMs: 8000 })),
  );
  const asrDrainMs = Date.now() - end;
  const transcript = [...rows.values()]
    .filter((r) => r.channel === "system" && r.final && !r.gap)
    .map((r) => r.text)
    .join(" ");
  if (!transcript.trim() || speech.stopped)
    throw new Error("The local speech test produced no final transcript.");
  const channelFinals = Object.fromEntries(
    speech.channels.map((channel) => [
      channel,
      [...rows.values()].filter(
        (r) => r.channel === channel && r.final && !r.gap,
      ).length,
    ]),
  );
  if (Object.values(channelFinals).some((count) => count < 1))
    throw new Error("A speech channel produced no final words.");
  speech.close();
  const native = new NativeServices(paths);
  const capabilities = await native.run("capabilities");
  let document;
  try {
    document = await native.run(
      "llm",
      {
        prompt: JSON.stringify({
          task: "recap",
          evidence: [...rows.values()]
            .filter((r) => r.final)
            .map(({ id, text }) => ({ id, text })),
        }),
      },
      { timeout: 60000 },
    );
  } finally {
    native.close();
  }
  const report = {
    syntheticOnly: true,
    channelFinals,
    expected,
    transcript,
    wordErrorRate: wer(expected, transcript),
    audioSeconds: pcm.length / 48000,
    asrDrainMs,
    finalRows: [...rows.values()].filter((r) => r.final).length,
    capabilities,
    localDocument: document,
    note: "Synthetic TTS file input; not evidence of real-call accuracy, speaker diarization quality, battery life or sustained performance.",
  };
  mkdirSync(path.join(root, "artifacts"), { recursive: true });
  writeFileSync(
    path.join(
      root,
      process.argv.includes("--dual")
        ? "artifacts/local-speech-dual-benchmark.json"
        : "artifacts/local-speech-benchmark.json",
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      ...report,
      capabilities: undefined,
      localDocument: undefined,
    }),
  );
} finally {
  speech?.close();
  rmSync(directory, { recursive: true, force: true });
}
