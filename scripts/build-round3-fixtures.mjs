import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CallController } from "../core/controller.mjs";
import { PackBank } from "../core/packs.mjs";
import { preparedCard } from "../core/cards.mjs";
const root = path.resolve(import.meta.dirname, ".."), directory = path.join(root, "fixtures/ui");
const c = new CallController({ demoOnly: true, preferences: { setupDismissed: true, liveHelp: true, mode: "interview", earlyReveal: true } });
const base = c.snapshot(); c.close();
const pack = JSON.parse(readFileSync(path.join(root, "fixtures/replay/interview-bank.json"))).pack;
const bank = new PackBank({ clock: () => 1000 }); bank.import(pack);
bank.record(pack.id).pack.gaps.push({ id: "role", storyId: "client-result", ask: "Which decision did you personally own?" });
bank.openId = pack.id;
const metadata = bank.list(), review = bank.snapshot();
const card = preparedCard(pack.cards[0], pack, 1000);
const meeting = { id: "synthetic-meeting", title: "Synthetic interview", people: ["Jordan"], createdAt: 1000, durationMs: 45000, status: "running", saving: true,
  captureMode: "transcribe", engine: "apple", retainAudio: false, notes: { text: "Synthetic notes", version: 1 }, speakers: [{ id: "you", label: "You" }, { id: "them", label: "Them" }], segments: [], actions: [], audio: [], jobs: [], events: [], processing: [], recap: null, enhanced: null, debrief: null };
const idle = { ...base, source: "manual", status: "idle", libraryPath: "/Synthetic/Callwise/meetings", settings: { ...base.settings, mode: "interview" },
  preferences: { ...base.preferences, setupDismissed: true, liveHelp: true, earlyReveal: true },
  desktop: { packaged: true, version: "0.6.0", platform: "darwin", readiness: { core: true, mic: true, system: true, ai: true }, native: { speech: true, installedLocales: ["en-US"] } },
  meetings: { current: null, activeId: null, library: [], warning: "", locked: false, processing: [], archiveOperation: null, libraryRevision: 0 }, packs: metadata, bank: null,
  watchFolder: { enabled: true, path: "/Synthetic/Callwise Prep" }, matcher: { available: true, model: "Bundled offline sentence model", error: null } };
const active = { ...structuredClone(idle), status: "running", meetings: { ...structuredClone(idle.meetings), current: meeting, activeId: meeting.id } };
active.stage = { phase: "final", question: { clean: "Tell me about a client result.", raw: "Okay, so, tell me about a client result." }, current: card, earlier: [], readyNext: [], notice: null, speed: { lastRevealLeadMs: -500, medianRevealMs: -400, lastLiveMs: 1700 } };
const manifest = [];
function save(name, snapshot, screen = "live", tab) {
  const file = `stage/${name}.json`; mkdirSync(path.join(directory, "stage"), { recursive: true });
  writeFileSync(path.join(directory, file), JSON.stringify(snapshot, null, 2) + "\n"); manifest.push({ name, file, screen, ...(tab ? { tab } : {}) });
}
for (const phase of ["listening", "held", "early"]) { const s = structuredClone(active); s.stage.phase = phase; if (phase !== "early") s.stage.current = null; save(phase, s); }
for (const [name, source] of [["prepared", "prepared"], ["closest", "prepared_closest"], ["live", "live"], ["fact", "fact"]]) { const s = structuredClone(active); s.stage.current.source = source; save(name, s); }
for (const name of ["frame", "none"]) { const s = structuredClone(active); Object.assign(s.stage.current, { source: "none", say: "", frame: ["Situation", "Your move", "Result"], cues: [], askBack: "Which part would be most useful to explore?" }); save(name, s); }
{ const s = structuredClone(active); s.stage.current = null; s.stage.notice = { kind: "heard_unclear", text: "[inaudible] customer" }; save("unclear", s); }
{ const s = structuredClone(active); s.stage.current.source = "prepared_closest"; s.stage.notice = { kind: "model_slow", text: "The model is slow. Showing your prepared answer." }; save("model-slow", s); }
{ const s = structuredClone(active); Object.assign(s.stage.current, { id: "wrapup-synthetic", say: "", cues: pack.questionsForThem.map(text => ({ icon: "ask", text })) }); save("wrapup-questions", s); }
save("settings-midcall", structuredClone(active), "settings", "Prep");
{ const s = structuredClone(idle); s.bank = review; save("review-cards", s, "ready"); }
save("ready-packs", structuredClone(idle), "ready");
for (const status of ["asking", "listening", "done"]) { const s = structuredClone(idle); s.rehearsal = { status, packId: pack.id, index: status === "done" ? 3 : 0, total: 3, question: pack.cards[0].questions[0], cues: [{ text: "Customer growth", covered: true }], results: [{ question: pack.cards[0].questions[0], covered: 1, total: 1 }] }; save(`rehearsal-${status}`, s, "ready"); }
{ const s = structuredClone(active); s.status = "ended"; s.meetings.activeId = null; s.meetings.current.status = "ended"; s.meetings.current.debrief = {
  meetingId: meeting.id, promises: [{ id: "p1", who: "You", what: "I will send the results.", due: "Friday" }],
  surprises: [{ id: "s1", question: "How did you measure the result?", shown: "I reviewed the source data.", draftCardId: null, added: false }], cardsShown: [{ id: card.id, question: "Tell me about a result.", source: "prepared", pinned: true, dismissed: false }],
  speed: { medianRevealMs: -400, medianLiveMs: 1700, earlyReveals: 3, swaps: 0 } }; save("debrief", s); }
writeFileSync(path.join(directory, "index.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Built ${manifest.length} synthetic round 3 UI states.`);
