// New in 0.5.1 (Low): recover() no longer forgets old restarts (0.5.0 kept only the last 60 s), so the fourth helper
// restart in one capture epoch stops speech on both channels however far apart the restarts are.
// Run with CALLWISE_ROOT pointing at a 0.5.0 tree to compare.
import { EventEmitter } from "node:events";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { AppleSpeechSession } = await import(`${R}/providers/apple-speech.mjs`);
class FakeHost extends EventEmitter {
  async request(op) { return op === "start" ? { ready: true } : { ok: true }; }
  send() {}
  close() {}
}
// Four helper exits, 20 minutes apart (the clock is advanced; no waiting).
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const statuses = [];
const s2 = new AppleSpeechSession({ binary: "fake", resources: "fake", epoch: 1, hostFactory: () => new FakeHost() });
for (const channel of ["mic", "system"]) s2.adapter({ channel, onSegment() {}, onStatus: (st) => statuses.push(`${channel}:${st}`), onDiscard() {} });
await s2.connect();
for (let i = 1; i <= 4; i++) {
  offset += 20 * 60000;
  s2.host.emit("exit");
  await new Promise((r) => setTimeout(r, 20));
}
Date.now = realNow;
console.log("after 4 helper exits 20 minutes apart:", { stopped: s2.stopped, lastStatuses: statuses.slice(-2) });
s2.close();
