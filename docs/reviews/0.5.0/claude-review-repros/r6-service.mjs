import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os"; import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const { CallController } = await import(`${R}/core/controller.mjs`);
const { noticeHash } = await import(`${R}/core/meetings/notice.mjs`);
const { validateDocument, chunksForModel, LocalDocuments } = await import(`${R}/core/meetings/recaps.mjs`);
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "cw-svc-"));
const seg = (i, text, ch = "system") => ({ text, speaker: ch === "mic" ? "You" : "Them", channel: ch, final: true, startMs: i * 4000, endMs: i * 4000 + 3000 });
const ended = (s, id, title) => { s.put("meetings", id, id, { title, titleSource: "auto", people: ["Dana Lee"], status: "ended", createdAt: Date.now(), durationMs: 60000, contentRevision: 0, saving: true });
  s.put("docs", id, "notes:original", { text: "", version: 0, lineTimes: [] }); };

console.log("== 1. Delete all Callwise data (store-level loop from desktop/main.mjs) leaves content in the running service");
{ const dir = tmp(), store = new MeetingStore(dir, { key: randomBytes(32), keyId: "k" }), svc = new MeetingService({ store });
  const id = "33333333-3333-4333-8333-333333333333";
  svc.snapshot();                                   // History opened earlier in this session
  ended(svc, id, "Confidential salary talk");       // meeting saved during this session (through the service)
  svc.put("segments", id, "system:e1:0", seg(0, "My current salary is 180k."));
  svc.selectedId = id; svc.current(id); svc.invalidate(); svc.snapshot();
  for (const m of store.all("meetings")) store.deleteMeeting(m.id);          // exactly what desktop.delete does
  console.log("  rows left in SQLite:", store.db.prepare("SELECT count(*) c FROM meetings").get().c, "+", store.db.prepare("SELECT count(*) c FROM segments").get().c, "segments");
  const snap = svc.snapshot();
  console.log("  History list still shows:", snap.library.map((m) => m.title), "| open meeting transcript:", snap.current?.segments?.map((r) => r.text));
  await svc.command("meeting.edit", { meetingId: id, title: "Renamed" });
  const back = store.get("meetings", id);
  console.log("  after editing the title, SQLite has the meeting header again:", !!back, back && { title: back.title, people: back.people });
  svc.close(); rmSync(dir, { recursive: true, force: true }); }

console.log("== 2. The first recap becomes a hidden draft if notes are typed while it is generated");
{ const dir = tmp(), store = new MeetingStore(dir, { key: randomBytes(32), keyId: "k" });
  let release; const gate = new Promise((r) => (release = r));
  const native = { run: async () => { await gate; return { title: "Pricing decision", summary: [{ text: "Pricing rises in March.", segmentIds: ["system:e1:0"] }], decisions: [], openQuestions: [],
    actions: [{ text: "Send the new price list", ownerQuote: "I will send the new price list", dueQuote: "", segmentIds: ["system:e1:0"] }] }; } };
  const svc = new MeetingService({ store, native }), id = "44444444-4444-4444-8444-444444444444";
  ended(store, id, "Untitled meeting"); store.put("segments", id, "system:e1:0", seg(0, "Pricing rises in March. I will send the new price list."));
  const job = svc.generate(id, "recap");
  svc.saveNotes(id, { text: "typed right after the call", version: 0 });       // user keeps typing notes
  release(); await job;
  const m = svc.current(id);
  console.log("  recap:", m.recap ? "present" : "missing", "| recap:draft:", m.recapDraft ? "present" : "missing", "| actions:", m.actions.length, "| title:", m.title);
  svc.close(); rmSync(dir, { recursive: true, force: true }); }

console.log("== 3. A suggested owner is stored as the supporting quote, not a person");
{ const rows = [{ id: "r1", final: true, text: "I will send the proposal on Friday.", speaker: "Dana" }];
  const d = validateDocument({ actions: [{ text: "Send the proposal", ownerQuote: "I will send the proposal", dueQuote: "on Friday", segmentIds: ["r1"] }] }, rows);
  console.log("  owner:", JSON.stringify(d.actions[0].owner), "| due:", JSON.stringify(d.actions[0].due)); }

console.log("== 4. begin() accepts a notes-only meeting with audio as the source, and accepts caller-supplied preferences");
{ const dir = tmp(), store = new MeetingStore(dir, { key: randomBytes(32), keyId: "k" });
  const controller = new CallController({ preferences: { liveHelp: true, retainAudio: true, speechEngine: "openai" }, openaiKey: "sk-test",
    speechFactory: () => ({ connect: async () => {}, push() {}, finish: async () => {}, close() {} }) });
  const svc = new MeetingService({ store }); controller.meetingService = svc; svc.attach(controller);
  const a = svc.begin({ preferences: controller.preferences, source: "audio", captureMode: "notes-only", consent: true });
  await controller.command("start", { source: "audio", consent: true });
  console.log("  notes-only header:", { notice: a.notice, captureMode: a.captureMode }, "| engine:", controller.engine.status, controller.mode);
  await controller.command("end"); await controller.command("new");
  const receipt = { confirmed: true, method: "spoken", configHash: noticeHash({}), presentedAt: Date.now() };
  const b = svc.begin({ preferences: controller.preferences, source: "audio", ...{ preferences: {} }, notice: receipt });
  console.log("  notice accepted for defaults while real preferences are", JSON.stringify(controller.preferences), "->", JSON.stringify(b.notice.text));
  controller.close(); svc.close(); rmSync(dir, { recursive: true, force: true }); }

console.log("== 5. 'Ask your meeting history' runs the local model over every segment of the top 5 meetings");
{ let calls = 0; const docs = new LocalDocuments({ run: async () => { calls++; return { summary: [], decisions: [], openQuestions: [], actions: [], answer: "", answerSegmentIds: [] }; } });
  const rows = []; for (let m = 0; m < 5; m++) for (let i = 0; i < 700; i++) rows.push({ id: `m${m}:system:e1:${i}`, final: true, speaker: "Them", text: "Words from an hour-long meeting, about a dozen of them per final row here." });
  const t = Date.now(); await docs.generate(rows, { task: "answer", question: "What did we agree?" });
  console.log(`  5 meetings x 700 rows -> ${chunksForModel(rows).length} chunks, ${calls} sequential local-model calls for one question (each spawns callwise-native llm)`); }

console.log("== 6. Pause, then End while the pause is still draining: End is ignored");
{ const c = new CallController({ preferences: { liveHelp: false }, speechFactory: () => ({ connect: async () => {}, push() {}, finish: () => new Promise((r) => setTimeout(r, 400)), close() {} }) });
  await c.command("start", { source: "audio", consent: true });
  const pause = c.command("pause"); await new Promise((r) => setTimeout(r, 20));
  await c.command("end"); await pause;
  console.log("  status after End:", c.engine.status); c.close(); }

console.log("== 7. Read-only open after the app closed (no -wal/-shm files): MCP/search path");
{ const dir = tmp(), key = randomBytes(32), w = new MeetingStore(dir, { key, keyId: "k" }), id = "55555555-5555-4555-8555-555555555555";
  ended(w, id, "Closed library"); w.close();
  console.log("  files after app close:", readdirSync(dir).filter((f) => f.startsWith("library")).join(", "));
  try { const r = new MeetingStore(dir, { key, keyId: "k", readOnly: true }); console.log("  read-only open ok, title:", r.get("meetings", id).title); r.close(); }
  catch (e) { console.log("  read-only open failed:", e.message); }
  rmSync(dir, { recursive: true, force: true }); }
