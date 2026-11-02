// Repro: a helper restart reuses the next capture epoch's segment IDs, so a later utterance overwrites an earlier one.
import { EventEmitter } from "node:events";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { CallController } = await import(`${R}/core/controller.mjs`);
const { AppleSpeechSession } = await import(`${R}/providers/apple-speech.mjs`);
const hosts = [];
class FakeHost extends EventEmitter {
  constructor(o) { super(); this.o = o; this.n = { mic: 0, system: 0 }; hosts.push(this); }
  async request(op, args) {
    if (op === "start") { this.epoch = args.epoch; return { ready: true }; }
    return { ok: true };
  }
  send() {}
  close() { this.closed = true; }
  // Mirrors main.swift report(): id = "<channel>:e<epoch>:<utterance>", utterance += 1 on final
  say(channel, text, final = true) {
    this.emit("message", { type: "segment", row: { id: `${channel}:e${this.epoch}:${this.n[channel]}`, channel, speaker: channel === "mic" ? "You" : "Them", text, startMs: 1000 * hosts.length, endMs: 1000 * hosts.length + 900, final, epoch: this.epoch } });
    if (final) this.n[channel]++;
  }
}
let speechSession;
// Same factory logic as desktop/main.mjs speechFactory
const controller = new CallController({
  preferences: { liveHelp: false },
  speechFactory: (options) => {
    if (!speechSession || speechSession.stopped || speechSession.captureEpoch !== options.captureEpoch) {
      speechSession?.close();
      speechSession = new AppleSpeechSession({ binary: "fake", resources: "fake", language: "en-US", hints: options.keywords, epoch: options.captureEpoch, hostFactory: (o) => new FakeHost(o) });
      speechSession.captureEpoch = options.captureEpoch;
    }
    return speechSession.adapter(options);
  },
});
const tick = () => new Promise((r) => setTimeout(r, 20));
await controller.command("start", { source: "audio", consent: true });
hosts.at(-1).say("mic", "Alpha: said before the helper restarted.");
hosts.at(-1).emit("exit", 1); // helper crash or watchdog restart -> AppleSpeechSession.recover() -> epoch++
await tick();
hosts.at(-1).say("mic", "Bravo: said after the restart, before pausing.");
await controller.command("pause");
await controller.command("start", { source: "audio", consent: true }); // resume -> captureEpoch 2 -> new session epoch 2
hosts.at(-1).say("mic", "Charlie partial", false);
const afterVolatile = controller.engine.transcript.get("mic:e2:0")?.text;
hosts.at(-1).say("mic", "Charlie: said after resuming.");
const rows = [...controller.engine.transcript.values()].filter((r) => !r.gap).map((r) => `${r.id} => ${r.text}`);
console.log("host epochs:", hosts.map((h) => h.epoch).join(", "));
console.log("text of mic:e2:0 right after the resumed volatile result:", JSON.stringify(afterVolatile));
console.log("transcript rows:\n  " + rows.join("\n  "));
console.log("Bravo still present:", rows.some((r) => r.includes("Bravo")));
controller.close();
