// Repro: after a restart, MeetingService.all(table) with no meetingId never reads SQLite
// (meetingId === this.unsavedMeeting is undefined === undefined), so History is empty and queued jobs never resume.
import { mkdtempSync, rmSync } from "node:fs"; import { randomBytes } from "node:crypto"; import os from "node:os"; import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-lib-")), key = randomBytes(32);
// Session 1: a meeting is saved and its recap job is queued (e.g. the app quit before the recap ran)
const s1 = new MeetingStore(dir, { key, keyId: "k" }), id = "66666666-6666-4666-8666-666666666666";
s1.put("meetings", id, id, { title: "Quarterly planning", people: ["Dana"], status: "ended", createdAt: Date.now(), durationMs: 3600000 });
s1.put("jobs", id, "recap", { status: "queued", basedOn: { revision: 0 } });
s1.close();
// Session 2: relaunch
const store = new MeetingStore(dir, { key, keyId: "k" });
let llmCalls = 0;
const svc = new MeetingService({ store, native: { run: async () => { llmCalls++; return {}; } } });
svc.attach({ on() {}, engine: { emitState() {} } });
await new Promise((r) => setTimeout(r, 400)); // attach() resumes queued jobs after 250 ms
console.log("meetings in SQLite:", store.db.prepare("SELECT count(*) c FROM meetings").get().c);
console.log("History list (snapshot().library):", svc.snapshot().library.map((m) => m.title));
console.log("svc.all('jobs'):", svc.all("jobs").length, "| store.all('jobs'):", store.all("jobs").length, "| local-model calls for the queued recap:", llmCalls);
console.log("meeting still opens by id:", svc.get("meetings", id)?.title);
svc.close(); rmSync(dir, { recursive: true, force: true });
