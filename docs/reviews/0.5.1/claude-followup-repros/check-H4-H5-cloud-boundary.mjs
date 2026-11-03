// 0.5.1 re-check of H4 and H5 with the notebook service attached, as in the desktop app.
// Network is stubbed; every outgoing request body is inspected.
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const requests = [];
globalThis.fetch = async (url, init) => { requests.push(String(init?.body || "")); return new Response(JSON.stringify({ error: { message: "stub" } }), { status: 500 }); };
const { CallController } = await import(`${R}/core/controller.mjs`);
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const { startMeeting } = await import(`${R}/desktop/meeting-start.mjs`);
const { noticeHash, noticeText } = await import(`${R}/core/meetings/notice.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-cloud-"));
const store = new MeetingStore(dir, { key: randomBytes(32) });
// A prior meeting recorded under a local-only notice.
const prior = "99999999-9999-4999-8999-999999999999";
store.put("meetings", prior, prior, { title: "Last week", people: ["Dana"], status: "ended", createdAt: 1, durationMs: 60000 });
store.put("segments", prior, "system:e1:0:run:r", { text: "RAW-TRANSCRIPT-SENTINEL the merger closes in March", speaker: "Them", channel: "system", final: true, startMs: 0, endMs: 2000 });
store.put("docs", prior, "notes:original", { text: "RAW-NOTES-SENTINEL private note", version: 1, lineTimes: [] });
store.put("docs", prior, "recap", { summary: [{ id: "s1", text: "Summary: pricing review planned", refs: [] }], decisions: [{ id: "d1", text: "Decision: keep the current tier", refs: [] }], openQuestions: [{ id: "q1", text: "OPEN-QUESTION-SENTINEL", refs: [] }] });
store.put("actions", prior, "a1", { text: "Confirmed: send the deck", state: "confirmed", refs: [], owner: { name: null }, due: { text: null } });
store.put("actions", prior, "a2", { text: "PROPOSED-ACTION-SENTINEL", state: "proposed", refs: [], owner: { name: null }, due: { text: null } });
const c = new CallController({
  config: { openaiKey: "sk-test-key", fastModel: "m", strategyModel: "m" },
  preferences: { liveHelp: true },
  speechFactory: () => ({ connect: async () => {}, push() {}, finish: async () => {}, close() {} }),
});
const meetings = new MeetingService({ store });
c.meetingService = meetings;
meetings.attach(c);
await startMeeting({ meetings, controller: c, payload: { source: "audio", prior: [prior],
  notice: { confirmed: true, method: "spoken", configHash: noticeHash(c.preferences), presentedAt: Date.now() } } });
console.log("notice:", JSON.stringify(noticeText(c.preferences)));
console.log("H5 context material from the prior meeting:", JSON.stringify([...c.engine.context.docs.values()].map((d) => d.text)));
const lines = ["Our budget for next year is 2.4 million.", "Please keep the merger confidential until March.", "We will cut the agency retainer if results slip.", "Let us revisit this in two weeks."];
const say = (i) => c.engine.ingest({ id: `system:e1:${i}:run:r`, channel: "system", speaker: "Them", text: lines[i], final: true, startMs: i * 5000, endMs: i * 5000 + 4000, captureEpoch: c.captureEpoch });
for (let i = 0; i < 3; i++) say(i);
c.engine.activeStartedAt -= 181000;
say(3);
await new Promise((r) => setTimeout(r, 300));
const kind = (b) => { try { return String(JSON.parse(b).instructions || "").slice(0, 50); } catch { return "?"; } };
const summarize = (list) => ({ requests: list.length, kinds: [...new Set(list.map(kind))],
  runningSummaryOrRecap: list.filter((b) => /running call summary|call recap/i.test(kind(b))).length,
  sentinels: ["RAW-NOTES-SENTINEL", "RAW-TRANSCRIPT-SENTINEL", "OPEN-QUESTION-SENTINEL", "PROPOSED-ACTION-SENTINEL"].filter((s) => list.some((b) => b.includes(s))) });
console.log("H4 during the call:", summarize(requests.splice(0)));
await c.command("pause");
await c.command("end");
await new Promise((r) => setTimeout(r, 300));
console.log("H4 after Pause -> End:", summarize(requests));
c.close(); meetings.close(); store.close(); rmSync(dir, { recursive: true, force: true });
