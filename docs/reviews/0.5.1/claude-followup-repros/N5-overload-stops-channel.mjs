// New in 0.5.1: one `speech_input_overloaded` line from the helper (main.swift .dropped, emitted with a channel)
// now marks that channel failed for the rest of the capture epoch. The Swift analyzer keeps running, but
// AppleSpeechSession.push() drops all further audio for the channel, and "Retry audio" cannot restart it.
// Run with CALLWISE_ROOT pointing at a 0.5.0 tree to compare: 0.5.0 restarted the helper and kept transcribing.
import { EventEmitter } from "node:events";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { CallController } = await import(`${R}/core/controller.mjs`);
const { AppleSpeechSession } = await import(`${R}/providers/apple-speech.mjs`);
const hosts = [];
class FakeHost extends EventEmitter {
  constructor() { super(); this.pushes = { mic: 0, system: 0 }; hosts.push(this); }
  async request(op) { return op === "start" ? { ready: true } : { ok: true }; }
  send(m) { if (m.op === "push") this.pushes[m.channel]++; }
  close() { this.closed = true; }
}
let session;
const controller = new CallController({
  preferences: { liveHelp: false },
  // Same factory logic as desktop/main.mjs speechFactory
  speechFactory: (options) => {
    if (!session || session.stopped || session.captureEpoch !== options.captureEpoch) {
      session?.close();
      session = new AppleSpeechSession({ binary: "fake", resources: "fake", epoch: options.captureEpoch, hostFactory: () => new FakeHost() });
      session.captureEpoch = options.captureEpoch;
    }
    return session.adapter(options);
  },
});
await controller.command("start", { source: "audio", consent: true });
controller.captureStatus("mic", "receiving");
controller.captureStatus("system", "receiving");
const packet = Buffer.alloc(4800); // 100 ms at 24 kHz, as ui/audio-worklet.js posts
const pushBoth = async (n) => { for (let i = 0; i < n; i++) { controller.audio("mic", packet); controller.audio("system", packet); await new Promise((r) => setTimeout(r, 5)); } };
const sent = () => hosts.reduce((t, h) => ({ mic: t.mic + h.pushes.mic, system: t.system + h.pushes.system }), { mic: 0, system: 0 });
await pushBoth(10);
const before = sent();
hosts.at(-1).emit("message", { type: "error", channel: "system", code: "speech_input_overloaded" });
await new Promise((r) => setTimeout(r, 50));
await pushBoth(20);
const after = sent();
console.log("helper processes started:", hosts.length);
console.log("packets delivered after the single overload line:", { mic: after.mic - before.mic, system: after.system - before.system }, "(20 pushed per channel)");
console.log("capture status:", controller.capture, "| error:", controller.engine.snapshot?.().errors?.map?.((e) => e.message) ?? "");
// desktop/main.mjs "desktop.capture.retry" decision for audio mode (0.5.2 moved it to speechNeedsRestart()):
let restarts;
try { restarts = (await import(`${R}/desktop/meeting-start.mjs`)).speechNeedsRestart?.(controller); } catch {}
if (restarts === undefined) restarts = [...controller.transcribers.values()].some((t) => t.stopped);
const reroutes = ["mic", "system"].filter((ch) => controller.captureInputs[ch] === "failed");
console.log("Retry audio would", restarts ? "pause and restart speech" : reroutes.length ? `re-open capture for ${reroutes}` : "do nothing");
controller.close();
