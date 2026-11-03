// 0.5.1 re-check of H1: after a relaunch, History lists saved meetings and queued recap jobs resume one at a time.
// (r7 used a meeting without transcript rows, which never reaches the local model; this one has rows.)
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-lib51-")), key = randomBytes(32);
const s1 = new MeetingStore(dir, { key, keyId: "k" });
const ids = ["66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"];
for (const [i, id] of ids.entries()) {
  s1.put("meetings", id, id, { title: `Planning ${i + 1}`, titleSource: "user", people: ["Dana"], status: "ended", createdAt: Date.now() + i, durationMs: 3600000, contentRevision: 1 });
  s1.put("segments", id, "system:e1:0:run:r", { text: `We agreed to ship phase ${i + 1} in March.`, speaker: "Them", channel: "system", final: true, startMs: 0, endMs: 3000 });
  s1.put("jobs", id, "recap", { status: "queued", basedOn: { revision: 1 } });
}
s1.close();
const store = new MeetingStore(dir, { key, keyId: "k" });
let running = 0, maxParallel = 0, calls = 0;
const native = { run: async () => { calls++; running++; maxParallel = Math.max(maxParallel, running); await new Promise((r) => setTimeout(r, 100)); running--; return { summary: [], decisions: [], openQuestions: [], actions: [] }; } };
const svc = new MeetingService({ store, native });
svc.attach({ on() {}, engine: { emitState() {} } });
console.log("History after relaunch:", svc.snapshot().library.map((m) => m.title));
await new Promise((r) => setTimeout(r, 1500));
console.log("queued recaps resumed:", { localModelCalls: calls, maxParallel, jobs: ids.map((id) => store.get("jobs", id, "recap")?.status) });
svc.close(); store.close(); rmSync(dir, { recursive: true, force: true });
