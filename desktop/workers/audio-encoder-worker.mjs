import { parentPort, workerData } from "node:worker_threads";
import lame from "@breezystack/lamejs";
import path from "node:path";
import { seal } from "../../core/meetings/crypto.mjs";
import { atomicWrite } from "../../core/meetings/store.mjs";
const key = Buffer.from(workerData.key),
  channels = new Map();
function flush(channel) {
  const state = channels.get(channel);
  if (!state?.samples.length) return;
  const samples = Int16Array.from(state.samples),
    encoder = new lame.Mp3Encoder(1, 24000, 48),
    pieces = [];
  for (let i = 0; i < samples.length; i += 1152) {
    const encoded = encoder.encodeBuffer(samples.subarray(i, i + 1152));
    if (encoded.length) pieces.push(Buffer.from(encoded));
  }
  pieces.push(Buffer.from(encoder.flush()));
  const bytes = Buffer.concat(pieces),
    sequence = state.sequence++,
    id = `${channel}:${sequence}`;
  const relative = `audio/${workerData.meetingId}/${channel}/${sequence}.cwa`;
  atomicWrite(
    path.join(workerData.directory, relative),
    seal(key, bytes, `audio:${workerData.meetingId}:${id}`, workerData.keyId),
  );
  parentPort.postMessage({
    type: "chunk",
    id,
    record: {
      channel,
      sequence,
      startMs: state.startMs,
      endMs: state.startMs + samples.length / 24,
      bytes: bytes.length,
      path: relative,
    },
  });
  samples.fill(0);
  state.samples.fill(0);
  state.samples = [];
  state.startMs = null;
}
parentPort.on("message", (m) => {
  try {
    if (m.op === "push") {
      let state = channels.get(m.channel);
      if (!state) {
        state = { samples: [], startMs: null, sequence: 0 };
        channels.set(m.channel, state);
      }
      const bytes = Buffer.from(m.bytes);
      const expected =
        state.startMs === null
          ? m.startMs
          : state.startMs + state.samples.length / 24;
      if (state.samples.length && Math.abs(m.startMs - expected) > 100)
        flush(m.channel);
      for (let i = 0; i < bytes.length; i += 2) {
        if (state.startMs === null) state.startMs = m.startMs + i / 48;
        state.samples.push(bytes.readInt16LE(i));
        if (state.samples.length >= 240000) flush(m.channel);
      }
      parentPort.postMessage({ type: "ack" });
    } else if (m.op === "flush") {
      for (const ch of channels.keys()) flush(ch);
      parentPort.postMessage({ type: "flushed", request: m.request });
    }
  } catch {
    parentPort.postMessage({ type: "error", code: "audio_save_failed" });
  }
});
