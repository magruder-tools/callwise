// New in 0.5.1: "Delete transcript and audio; continue with notes only" deletes the whole meeting,
// including the notes the user typed and the actions they added. Mirrors ui/meetings.mjs m-objection-delete.
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { CallController } = await import(`${R}/core/controller.mjs`);
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const { startMeeting } = await import(`${R}/desktop/meeting-start.mjs`);
const { noticeHash } = await import(`${R}/core/meetings/notice.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-objection-"));
const store = new MeetingStore(dir, { key: randomBytes(32) });
const c = new CallController({ preferences: { liveHelp: false },
  speechFactory: () => ({ connect: async () => {}, push() {}, finish: async () => {}, close() {} }) });
const meetings = new MeetingService({ store });
c.meetingService = meetings;
meetings.attach(c);
await startMeeting({ meetings, controller: c, payload: { source: "audio", title: "Vendor negotiation", people: ["Dana"],
  notice: { confirmed: true, method: "spoken", configHash: noticeHash(c.preferences), presentedAt: Date.now() } } });
const id = meetings.activeId;
c.engine.ingest({ id: "system:e1:0:run:r", channel: "system", speaker: "Them", text: "Our renewal price is 40k.", final: true, startMs: 0, endMs: 2000, captureEpoch: c.captureEpoch });
await meetings.command("meeting.notes", { meetingId: id, text: "My own notes: walk-away price 35k, ask for 3-year term", version: 0 });
await meetings.command("meeting.action", { meetingId: id, text: "Email legal about the term sheet" });
console.log("before objection:", { title: store.get("meetings", id).title, notes: store.get("docs", id, "notes:original").text, actions: store.all("actions", id).map((a) => a.text), segments: store.all("segments", id).length });
// UI: "Someone objected — pause now", then "Delete transcript and audio; continue with notes only"
await meetings.command("meeting.notice", { objection: true });
await meetings.command("meeting.objection.resolve", { choice: "delete" });
await c.command("new", { clearContext: true });
const kept = store.get("meetings", id);
console.log("after 'Delete transcript and audio':", kept
  ? { meeting: kept.title, captureDeleted: kept.captureDeleted, notes: store.get("docs", id, "notes:original")?.text, actions: store.all("actions", id).map((a) => a.text), segments: store.all("segments", id).length }
  : { meeting: null, notes: null, actions: [], segments: store.all("segments", id).length });
// ui/meetings.mjs then starts the notes-only continuation (0.5.2 also passes continueFrom; 0.5.1 ignores it).
await startMeeting({ meetings, controller: c, payload: { source: "manual", captureMode: "notes-only", continueFrom: id } });
const next = store.get("meetings", meetings.activeId);
console.log("continuation meeting:", { title: next.title, people: next.people, notes: store.get("docs", next.id, "notes:original").text, actions: store.all("actions", next.id).map((a) => a.text) });
console.log("objected meeting still listed separately:", !!store.get("meetings", id));
c.close(); meetings.close(); store.close(); rmSync(dir, { recursive: true, force: true });
