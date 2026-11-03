// 0.5.1 re-check of M2: MeetingService.deleteAll() (called by main's desktop.delete) instead of the 0.5.0 store loop.
import { mkdtempSync, rmSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { CallController } = await import(`${R}/core/controller.mjs`);
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const { MeetingSearch } = await import(`${R}/desktop/meeting-search.mjs`);
const { startMeeting } = await import(`${R}/desktop/meeting-start.mjs`);
const { noticeHash } = await import(`${R}/core/meetings/notice.mjs`);
const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "keychain",
  encryptString: (s) => Buffer.from("x" + s), decryptString: (b) => Buffer.from(b).toString().slice(1) };
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-delall-"));
const store = new MeetingStore(path.join(dir, "meetings"), { storage });
const controller = new CallController({ preferences: { liveHelp: false, preferredSource: "manual" } });
const meetings = new MeetingService({ store, search: new MeetingSearch(store) });
controller.meetingService = meetings;
meetings.attach(controller);
await startMeeting({ meetings, controller, payload: { source: "manual", title: "Confidential salary talk", people: ["Dana Lee"],
  notice: { confirmed: true, method: "spoken", configHash: noticeHash({ ...controller.preferences, preferredSource: "manual" }), presentedAt: Date.now() } } });
const id = meetings.activeId;
controller.engine.ingest({ id: "manual:1", channel: "system", speaker: "Them", text: "My current salary is 180k.", final: true, startMs: 0, endMs: 2000 });
await meetings.command("meeting.notes", { meetingId: id, text: "Ask about the 180k figure", version: 0 });
await controller.command("end");
mkdirSync(path.join(dir, "meetings", "backups"), { recursive: true });
writeFileSync(path.join(dir, "meetings", "backups", "internal.cwbackup"), "x");
const keyBefore = store.keyId;
console.log("before: library", meetings.snapshot().library.map((m) => m.title), "| search", (await meetings.search.search("salary")).map((m) => m.title));
await meetings.deleteAll();
const snap = meetings.snapshot();
console.log("after deleteAll: library", snap.library.map((m) => m.title), "| current", snap.current, "| activeId", snap.activeId);
console.log("  search 'salary':", (await meetings.search.search("salary")).map((m) => m.title));
console.log("  rows in SQLite:", store.db.prepare("SELECT count(*) c FROM meetings").get().c, "| key replaced:", store.keyId !== keyBefore, "| files:", readdirSync(path.join(dir, "meetings")), "| internal backups:", existsSync(path.join(dir, "meetings", "backups")));
const edit = await meetings.command("meeting.edit", { meetingId: id, title: "Renamed", people: ["Dana Lee"] }).then(() => "accepted", (e) => e.message);
console.log("  editing the deleted meeting:", edit, "| header back in SQLite:", !!store.get("meetings", id));
controller.close(); meetings.close(); store.close(); rmSync(dir, { recursive: true, force: true });
