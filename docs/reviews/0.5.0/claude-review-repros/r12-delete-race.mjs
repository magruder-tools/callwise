// Deleting a recorded meeting right after End: the recorder's final flush still writes audio for the deleted meeting.
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs"; import { randomBytes } from "node:crypto"; import os from "node:os"; import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const { MeetingRecorder } = await import(`${R}/desktop/meeting-recorder.mjs`);
const { CallController } = await import(`${R}/core/controller.mjs`);
const { noticeHash } = await import(`${R}/core/meetings/notice.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-del-")), store = new MeetingStore(dir, { key: randomBytes(32), keyId: "k" });
const c = new CallController({ preferences: { liveHelp: false, retainAudio: true }, speechFactory: () => ({ connect: async () => {}, push() {}, finish: async () => {}, close() {} }) });
const svc = new MeetingService({ store, recorder: new MeetingRecorder() }); c.meetingService = svc; svc.attach(c);
const header = svc.begin({ preferences: c.preferences, notice: { confirmed: true, method: "spoken", configHash: noticeHash(c.preferences), presentedAt: Date.now() } });
await c.command("start", { source: "audio", consent: true });
const pcm = Buffer.alloc(4800, 1);
for (let i = 0; i < 30; i++) { c.audio("mic", pcm); await new Promise((r) => setTimeout(r, 5)); } // ~3 s of audio, below one 10 s chunk
await c.command("end");                                   // recorder.finish() now flushes in the background
svc.delete(header.id);                                    // user deletes the meeting straight away
await new Promise((r) => setTimeout(r, 1500));
const rows = store.db.prepare("SELECT count(*) c FROM audio_chunks WHERE meeting_id=?").get(header.id).c;
const folder = path.join(dir, "audio", header.id);
console.log("meeting header exists:", !!store.get("meetings", header.id), "| audio rows for the deleted meeting:", rows, "| audio files:", existsSync(folder) ? readdirSync(folder, { recursive: true }).filter((f) => f.endsWith(".cwa")) : []);
c.close(); svc.close(); rmSync(dir, { recursive: true, force: true });
