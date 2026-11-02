// Measure per-state-event persistence cost late in a long meeting (MeetingService.observe hashes every row each time).
import { mkdtempSync, rmSync } from "node:fs"; import { randomBytes } from "node:crypto"; import os from "node:os"; import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const { CallController } = await import(`${R}/core/controller.mjs`);
const { noticeHash } = await import(`${R}/core/meetings/notice.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-perf-")), store = new MeetingStore(dir, { key: randomBytes(32), keyId: "k" });
const c = new CallController({ preferences: { liveHelp: false }, speechFactory: () => ({ connect: async () => {}, push() {}, finish: async () => {}, close() {} }) });
const svc = new MeetingService({ store }); c.meetingService = svc; svc.attach(c);
svc.begin({ preferences: c.preferences, notice: { confirmed: true, method: "spoken", configHash: noticeHash(c.preferences), presentedAt: Date.now() } });
await c.command("start", { source: "audio", consent: true });
const N = 3000;
for (let i = 0; i < N; i++) c.engine.ingest({ id: `system:e1:${i}`, channel: "system", speaker: "Them", text: `Sentence number ${i} about the quarterly plan and a few more words to be realistic here.`, final: true, startMs: i * 2400, endMs: i * 2400 + 2000, captureEpoch: 1 });
// Now time 50 state events caused by a single volatile update each (the common case while someone talks)
let t = process.hrtime.bigint();
for (let k = 0; k < 50; k++) c.engine.ingest({ id: `system:e1:${N}`, channel: "system", speaker: "Them", text: `partial ${k}`, final: false, startMs: N * 2400, captureEpoch: 1 });
const per = Number(process.hrtime.bigint() - t) / 1e6 / 50;
console.log(`rows=${N}: ${per.toFixed(1)} ms of main-thread work per transcript update (engine + controller + meeting service listeners)`);
c.close(); svc.close(); rmSync(dir, { recursive: true, force: true });
