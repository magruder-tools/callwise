// Repro: a second "start" while the first is still connecting marks the new meeting ended, so the live call is never saved.
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os"; import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { CallController } = await import(`${R}/core/controller.mjs`);
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const { noticeHash } = await import(`${R}/core/meetings/notice.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-start-"));
const store = new MeetingStore(dir, { key: randomBytes(32), keyId: "k1" });
const options = [];
const controller = new CallController({
  preferences: { liveHelp: false },
  speechFactory: (o) => { options.push(o); return { connect: () => new Promise((r) => setTimeout(r, 300)), push() {}, finish: async () => {}, close() {} }; },
});
const meetings = new MeetingService({ store });
controller.meetingService = meetings; meetings.attach(controller);
// Verbatim logic of the "start" branch and the catch block in desktop/main.mjs (callwise:command handler)
async function handle(name, payload) {
  if (meetings && name === "start" && payload.source !== "demo") {
    const resuming = controller.engine.status === "paused" && meetings.activeId;
    if (!resuming && controller.engine.status !== "running") meetings.begin({ preferences: controller.preferences, ...payload });
  }
  try { return await controller.command(name, payload); }
  catch (error) {
    if (meetings && name === "start" && meetings.activeId && controller.engine.status !== "running") {
      const m = meetings.get("meetings", meetings.activeId);
      if (m) { meetings.put("meetings", m.id, m.id, { ...m, status: "ended", interrupted: true, endedAt: Date.now() }); meetings.event(m.id, "capture.start-failed"); meetings.invalidate(); controller.engine.emitState(); }
    }
    throw error;
  }
}
const payload = { source: "audio", backend: "openai", title: "Client call", people: [], consent: true,
  notice: { confirmed: true, method: "spoken", configHash: noticeHash(controller.preferences), presentedAt: Date.now() } };
const first = handle("start", payload);                       // click 1 on "Start listening"
await new Promise((r) => setTimeout(r, 50));
const second = await handle("start", payload).then(() => "ok", (e) => e.message); // click 2 while connecting
await first;
console.log("second click result:", second);
console.log("engine status after first start:", controller.engine.status);
for (const o of options.slice(0, 2)) o.onSegment({ id: `${o.channel}:e1:0`, channel: o.channel, speaker: o.channel === "mic" ? "You" : "Them", text: `${o.channel} words during the live call`, startMs: 0, endMs: 900, final: true });
await handle("end", {});
const id = meetings.activeId, header = store.get("meetings", id);
console.log("engine transcript rows:", controller.engine.transcript.size);
console.log("saved meeting:", { status: header.status, interrupted: header.interrupted, savedSegments: store.all("segments", id).length, recapJob: !!store.get("jobs", id, "recap") });
console.log("events:", store.all("events", id).map((e) => e.kind).join(", "));
controller.close(); meetings.close(); rmSync(dir, { recursive: true, force: true });
