// Low (also in 0.5.0): when the helper dies mid-utterance, the old run's partial line stays in the transcript and is
// finalized as "unfinalized" at End, while the replayed audio produces the full line again under the new run ID.
import { EventEmitter } from "node:events";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { CallController } = await import(`${R}/core/controller.mjs`);
const { AppleSpeechSession } = await import(`${R}/providers/apple-speech.mjs`);
const hosts = [];
class FakeHost extends EventEmitter { constructor() { super(); hosts.push(this); this.n = 0; } async request(op, a) { if (op === "start") this.epoch = a.epoch; return { ready: true }; } send() {} close() {}
  say(text, final) { this.emit("message", { type: "segment", row: { id: `system:e${this.epoch}:${this.n}`, channel: "system", speaker: "Them", text, startMs: 1000, endMs: 2500, final } }); if (final) this.n++; } }
let session;
const c = new CallController({ preferences: { liveHelp: false }, speechFactory: (o) => { if (!session || session.stopped || session.captureEpoch !== o.captureEpoch) { session?.close(); session = new AppleSpeechSession({ binary: "f", resources: "f", epoch: o.captureEpoch, hostFactory: () => new FakeHost() }); session.captureEpoch = o.captureEpoch; } return session.adapter(o); } });
await c.command("start", { source: "audio", consent: true });
for (let i = 0; i < 5; i++) c.audio("system", Buffer.alloc(4800)); // audio arrives before its first result
hosts[0].say("We can offer forty", false);       // volatile result, then the helper dies
hosts[0].emit("exit"); await new Promise((r) => setTimeout(r, 30));
hosts[1].say("We can offer forty thousand for the renewal.", true); // replayed audio, re-transcribed by the new run
await c.command("end");
console.log([...c.engine.transcript.values()].filter((r) => !r.gap).map((r) => ({ text: r.text, final: r.final, unfinalized: r.unfinalized })));
c.close();
