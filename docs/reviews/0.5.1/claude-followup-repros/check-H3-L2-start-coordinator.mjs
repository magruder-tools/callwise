// 0.5.1 re-check of H3 and L2 through the production start coordinator (desktop/meeting-start.mjs),
// replacing r4's copy of the 0.5.0 main.mjs handler.
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
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-start-"));
const store = new MeetingStore(dir, { key: randomBytes(32) });
const options = [];
const controller = new CallController({
  preferences: { liveHelp: false, retainAudio: false },
  speechFactory: (o) => {
    options.push(o);
    return { connect: () => new Promise((r) => setTimeout(r, 300)), push() {}, finish: async () => {}, close() {} };
  },
});
const meetings = new MeetingService({ store });
controller.meetingService = meetings;
meetings.attach(controller);
const notice = (p) => ({ confirmed: true, method: "spoken", configHash: noticeHash(p), presentedAt: Date.now() });
const payload = { source: "audio", title: "Client call", notice: notice(controller.preferences) };

console.log("== H3: double click on Start while the first start is connecting");
const first = startMeeting({ meetings, controller, payload });
await new Promise((r) => setTimeout(r, 50));
const second = await startMeeting({ meetings, controller, payload }).then(() => "accepted", (e) => e.message);
await first;
console.log("  second click:", second);
const id = meetings.activeId;
console.log("  engine:", controller.engine.status, "| meeting header:", store.get("meetings", id).status, "| meetings created:", store.all("meetings").length);
const words = { mic: "Thanks for joining, shall we start with pricing?", system: "Sure, our renewal budget is fixed until March." };
for (const [i, o] of options.slice(0, 2).entries())
  o.onSegment({ id: `${o.channel}:e1:0:run:x`, channel: o.channel, speaker: o.channel === "mic" ? "You" : "Them", text: words[o.channel], startMs: i * 5000, endMs: i * 5000 + 3000, final: true });
await controller.command("end");
const h = store.get("meetings", id);
console.log("  saved:", { status: h.status, interrupted: !!h.interrupted, segments: store.all("segments", id).filter((r) => !r.gap).length, recapJob: !!store.get("jobs", id, "recap") });

console.log("== L2: injected preferences and a notes-only/audio mix are ignored");
await controller.command("new", { clearContext: true });
const injected = { source: "audio", captureMode: "notes-only", preferences: { liveHelp: true, retainAudio: true } };
await startMeeting({ meetings, controller, payload: injected });
const n = store.get("meetings", meetings.activeId);
console.log("  notes-only header:", { captureMode: n.captureMode, engine: n.engine, notice: n.notice, liveHelp: n.liveHelp, retainAudio: n.retainAudio }, "| controller source:", controller.mode);
await controller.command("end");
controller.close(); meetings.close(); store.close(); rmSync(dir, { recursive: true, force: true });
