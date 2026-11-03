// New in 0.5.1 (incomplete M6): the objection guard lives only in startMeeting(). The menu-bar "Resume" item and the
// paused-state global shortcuts (Control+Alt+P, and Control+Alt+Space "help") call controller.command("start") directly
// (desktop/main.mjs tray menu and SessionShortcuts actions), so capture resumes and is saved into the objected meeting.
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
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-objection-bypass-"));
const store = new MeetingStore(dir, { key: randomBytes(32) });
const c = new CallController({ preferences: { liveHelp: false },
  speechFactory: () => ({ connect: async () => {}, push() {}, finish: async () => {}, close() {} }) });
const meetings = new MeetingService({ store });
c.meetingService = meetings;
meetings.attach(c);
await startMeeting({ meetings, controller: c, payload: { source: "audio", title: "Customer call",
  notice: { confirmed: true, method: "spoken", configHash: noticeHash(c.preferences), presentedAt: Date.now() } } });
const id = meetings.activeId;
await meetings.command("meeting.notice", { objection: true });
const blocked = await startMeeting({ meetings, controller: c, payload: { source: "audio" } }).then(() => "resumed", (e) => e.message);
console.log("in-window Resume after the objection:", blocked);
// desktop/main.mjs tray menu "Resume" click handler (same call as the Control+Alt+P shortcut when paused)
const state = c.snapshot();
const tray = await c.command(state.status === "paused" ? "start" : "pause", { source: c.mode, consent: true, backend: c.strategyBackend })
  .then(() => "resumed", (e) => `refused: ${e.message}`);
console.log("menu-bar Resume / Control+Alt+P:", tray, { engine: c.engine.status, header: store.get("meetings", id).status, objection: store.get("meetings", id).objection });
c.engine.ingest({ id: "system:e2:0:run:r", channel: "system", speaker: "Them", text: "I said I did not want this recorded.", final: true, startMs: 9000, endMs: 11000, captureEpoch: c.captureEpoch });
console.log("transcript rows saved to the objected meeting after resuming:", store.all("segments", id).filter((r) => !r.gap).map((r) => r.text));
await c.command("end");
c.close(); meetings.close(); store.close(); rmSync(dir, { recursive: true, force: true });
