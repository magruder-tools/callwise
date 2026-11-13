import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import AdmZip from "adm-zip";
import { CallController } from "../core/controller.mjs";
import { CoachEngine } from "../core/engine.mjs";
import { PackBank, prepGuide } from "../core/packs.mjs";
import { LocalMatcher, MATCH_BANDS } from "../core/local-matcher.mjs";
import { Rehearsal } from "../core/rehearsal.mjs";
import { Preflight, preflightState, matchingEvent } from "../core/preflight.mjs";
import { PackInbox, readPackPath, imageData } from "../desktop/pack-import.mjs";
import { MeetingMcp, MEETING_TOOLS, PREP_TOOLS } from "../desktop/meeting-mcp.mjs";
import { captureSmoke } from "../desktop/smoke-capture.mjs";
import { diagnosticFields } from "../desktop/diagnostics.mjs";
import { uiOwnershipViolations } from "../scripts/check-ui-ownership.mjs";
const root = path.resolve(import.meta.dirname, ".."), read = (file) => JSON.parse(readFileSync(path.join(root, file)));
const example = () => read("fixtures/pack/appendix-b.json");
const validate = new Ajv({ strict: false }).compile(read("core/ui-contract.schema.json"));

test("all 19 required Stage and functional-screen snapshots validate the exact contract", () => {
  const entries = read("fixtures/ui/index.json"); assert.ok(entries.length >= 19);
  for (const e of entries) { const value = read(`fixtures/ui/${e.file}`); assert.equal(validate(value), true, `${e.name}: ${JSON.stringify(validate.errors)}`); assert.equal("debrief" in value, false); }
});
test("every full controller emission validates while packs, review and lifecycle change", async () => {
  const c = new CallController({ demoOnly: true }); const snapshots = [];
  c.on("state", (s) => { snapshots.push(s); assert.equal(validate(s), true, JSON.stringify(validate.errors)); });
  try {
    await c.command("pack.import", { pack: example() }); await c.command("bank.open", { packId: example().id });
    await c.command("bank.approveAll"); await c.command("bank.close");
    await c.command("start", { source: "demo" }); await c.command("pause"); await c.command("end");
    assert.ok(snapshots.length > 6);
  } finally { c.close(); }
});
test("the selected local matcher meets the bar on frozen vectors including 30 novel paraphrases", async () => {
  const data = read("fixtures/match/eval.json"), frozen = JSON.parse(gunzipSync(readFileSync(path.join(root, "fixtures/match/matcher-vectors.json.gz"))));
  assert.match(frozen.model, /bge-small/); assert.equal(Object.values(frozen.vectors)[0].length, 384);
  const m = new LocalMatcher({ embed: async texts => texts.map(t => { assert.ok(frozen.vectors[t], `Missing vector ${t}`); return frozen.vectors[t]; }) });
  await m.setCards(data.cards); let correct = 0, total = 0, rejected = 0;
  for (const c of data.cards) for (const q of [...c.phrasings, ...c.novelPhrasings]) { const r = await m.match(q); total++; if (r.cardId === c.id && r.score >= MATCH_BANDS.middle) correct++; }
  for (const q of data.offBank) if ((await m.match(q)).score < MATCH_BANDS.middle) rejected++;
  assert.ok(correct / total >= .9, `${correct}/${total}`); assert.ok(rejected / data.offBank.length >= .95);
});
test("Appendix B imports by folder, zip/drop route, watched folder and the assistant write tool", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "callwise-pack-routes-")), bank = new PackBank();
  const folder = path.join(dir, "Example prep"); mkdirSync(path.join(folder, "tiles"), { recursive: true });
  const json = JSON.stringify(example()); writeFileSync(path.join(folder, "pack.json"), json);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect x="5" y="5" width="20" height="30" fill="#4338ca"/></svg>';
  writeFileSync(path.join(folder, "tiles/ojo.svg"), svg);
  const zip = new AdmZip(); zip.addFile("Example prep/pack.json", Buffer.from(json)); zip.addFile("Example prep/tiles/ojo.svg", Buffer.from(svg)); const zipPath = path.join(dir, "example.zip"); zip.writeZip(zipPath);
  const inbox = new PackInbox({ bank, onError: e => { throw e; } });
  try {
    assert.equal(readPackPath(folder).pack.id, example().id); assert.equal(inbox.import(zipPath).cards, 1);
    inbox.start(dir); assert.equal(bank.list()[0].cards, 1); inbox.close();
    const server = new MeetingMcp({ enabled: () => false, prepEnabled: () => true, packs: bank, store: {}, search: {} });
    const assistantPack = example(); assistantPack.id += "-assistant";
    const result = await server.call("prep_pack_save", { pack: assistantPack }); assert.equal(result.status, "needs_review");
    const listing = await server.call("prep_pack_list", {}); assert.equal(listing.packs.length, 2); assert.equal(JSON.stringify(listing).includes(assistantPack.cards[0].say), false);
    assert.equal(readFileSync(path.join(folder, "pack.json"), "utf8"), json); assert.equal(readFileSync(path.join(folder, "tiles/ojo.svg"), "utf8"), svg);
  } finally { inbox.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("assistant prep write access is separate from completed-meeting read consent", async () => {
  let writes = 0;
  const server = new MeetingMcp({ enabled: () => true, prepEnabled: () => false, packs: { import: () => writes++ }, store: { get: () => ({ status: "running" }) }, search: {} });
  assert.equal(MEETING_TOOLS.length, 4); assert.equal(PREP_TOOLS.length, 3);
  assert.equal(PREP_TOOLS.find(t => t.name === "prep_pack_save").annotations.readOnlyHint, false);
  await assert.rejects(server.call("prep_pack_save", { pack: example() }), /Prep pack access is off/); assert.equal(writes, 0);
  await assert.rejects(server.call("meeting_get", { meetingId: "active" }), /still in progress/);
  server.prepEnabled = () => true; server.enabled = () => false;
  await server.call("prep_pack_save", { pack: example() }); assert.equal(writes, 1);
  await assert.rejects(server.call("meeting_get", { meetingId: "active" }), /Saved meeting access is off/);
});
test("the copyable guide preserves Appendix A verbatim and appends a usable schema", () => {
  const source = readFileSync(path.join(root, "docs/CALLWISE_ROUND_3.md"), "utf8").match(/## Appendix A[\s\S]*?```text\n([\s\S]*?)\n```/)[1];
  const guide = prepGuide(new Date("2026-11-12T00:00:00Z")); assert.equal(guide.prompt, source + "\n"); assert.equal(guide.today, "2026-11-12");
  assert.equal(new Ajv({ strict: false }).validate(guide.schema, example()), true);
});
test("an idle imported pack cannot be rebuilt with the sample provider", async () => {
  const c = new CallController({ preferences: { liveHelp: false } });
  try {
    const p = example(); await c.command("pack.import", { pack: p });
    await c.command("bank.gap.answer", { packId: p.id, gapId: "g1", answer: "I chose the channel mix." });
    assert.equal(c.round3.bank.record(p.id).pack.cards[0].say, p.cards[0].say);
    assert.equal(c.round3.bank.record(p.id).answers.g1.provenance, "user");
  } finally { c.close(); }
});
test("production explicit-help adapters guard streamed self notes and regenerate once", async () => {
  let calls = 0;
  const engine = new CoachEngine({ providers: { fast: { generate: async ({ onPartial }) => {
    calls++; onPartial?.({ speak: true, kind: "say", lead: "I need to recall the specific example." });
    return { speak: true, kind: "say", lead: calls === 1 ? "I need to recall the specific example." : "I can start with the measured result.", points: [{ label: "Recall", text: "Add one specific decision" }], sourceIds: [], covers: [] };
  } } } });
  engine.stageCoach = { enabled: () => false }; engine.start({ source: "manual", consent: true });
  try { await engine.run("fast", "How should I answer?", { origin: "asked" }); assert.equal(calls, 2); assert.equal(engine.cards.at(-1).lead, "I can start with the measured result."); assert.equal(engine.cards.at(-1).points.length, 0); }
  finally { engine.end(); }
});
test("active SVG content and traversal archives are rejected without fetching URLs or extracting files", () => {
  assert.throws(() => imageData(Buffer.from('<svg><script>alert(1)</script></svg>'), "x.svg"), /self-contained/);
  assert.throws(() => imageData(Buffer.from('<svg><image href="https://example.com/x"/></svg>'), "x.svg"), /self-contained/);
  const dir = mkdtempSync(path.join(os.tmpdir(), "cw-bad-zip-"));
  try { const zip = new AdmZip(); zip.addFile("pack.json", Buffer.from(JSON.stringify({ ...example(), callwisePack: 2 }))); const filename = path.join(dir, "bad.zip"); zip.writeZip(filename); assert.throws(() => readPackPath(filename), /unsupported version/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test("rehearsal speaks before opening only the microphone, covers cues and keeps no meeting", async () => {
  const bank = new PackBank(); bank.import(example()); await bank.command("bank.approveAll", { packId: example().id });
  const before = JSON.stringify(bank.records()), events = []; let deliver;
  const r = new Rehearsal({ bank, speak: async () => events.push("speech"), startListening: async cb => { deliver = cb; events.push("mic"); }, stopListening: async () => events.push("stop-mic") });
  await r.start(example().id); assert.deepEqual(events.slice(-2), ["speech", "mic"]);
  const cue = r.state.cues[0]; if (cue) { deliver({ id: "s", channel: "system", text: cue.text }); assert.equal(cue.covered, false); deliver({ id: "m", channel: "mic", text: cue.text }); assert.equal(cue.covered, true); }
  await r.next(); assert.equal(r.state.status, "done"); await r.stop(); assert.equal(r.state.status, "idle"); assert.equal(JSON.stringify(bank.records()), before);
});
test("pre-flight is opt-in, uses cached checks and notifies only once per meeting across restarts", () => {
  const now = Date.parse("2026-11-12T20:00:00Z"), packs = [{ title: "Interview", meetingStart: new Date(now + 240000).toISOString(), approved: 0, gaps: 1 }];
  assert.equal(preflightState({ packs, now }).state, "off"); let notices = 0, persisted;
  const p = new Preflight({ clock: () => now, notify: () => notices++, onNotified: keys => persisted = keys });
  p.update({ enabled: true, packs, readiness: {} }); p.update({ enabled: true, packs, readiness: {} }); assert.equal(notices, 1); assert.ok(p.state.reasons.includes("No approved cards"));
  const next = new Preflight({ clock: () => now, notify: () => notices++ }); next.notified = new Set(persisted); next.update({ enabled: true, packs, readiness: {} }); assert.equal(notices, 1);
  assert.equal(persisted[0].length, 64); assert.equal(persisted[0].includes("Interview"), false);
  const ready = preflightState({ enabled: true, packs: [{ ...packs[0], approved: 3, gaps: 0 }], readiness: { mic: true, system: true, speech: true }, now }); assert.equal(ready.state, "ready");
  assert.ok(matchingEvent(packs[0], [{ title: "Interview", start: now + 240000 }]));
});
test("smoke screenshots retry UnknownVizError exactly once and do not hide real failures", async () => {
  let calls = 0, waits = [];
  const window = { webContents: { executeJavaScript: async () => {}, capturePage: async () => { if (++calls === 1) throw new Error("UnknownVizError"); return { isEmpty: () => false }; } } };
  await captureSmoke(window, { settle: async ms => waits.push(ms) }); assert.equal(calls, 2); assert.ok(waits.includes(350));
  window.webContents.capturePage = async () => { throw new Error("Permanent compositor failure"); };
  await assert.rejects(captureSmoke(window, { settle: async () => {} }), /Permanent compositor/);
});
test("finish branch exception permits only its named screens and keeps Stage protected", () => {
  assert.deepEqual(uiOwnershipViolations("codex/round-3-finish", ["ui/views/bank.mjs", "ui/round3.css"]), []);
  assert.deepEqual(uiOwnershipViolations("codex/round-3-finish", ["ui/components/stage.mjs", "ui/tokens.css", "ui/other.css"]), ["ui/components/stage.mjs", "ui/tokens.css", "ui/other.css"]);
  assert.deepEqual(uiOwnershipViolations("codex/unrelated", ["ui/views/bank.mjs"]), ["ui/views/bank.mjs"]);
});
test("latency diagnostics preserve early negative lead time and strip private content", () => {
  assert.deepEqual(diagnosticFields({ matchedAt: 1, revealedAt: 2, turnEndedAt: 3, source: "prepared", revealLeadMs: -1, question: "private text", cue: "private detail" }), { matchedAt: 1, revealedAt: 2, turnEndedAt: 3, source: "prepared", revealLeadMs: -1 });
});
test("the icon preserves the mark and uses only the new theme palette", () => {
  const icon = readFileSync(path.join(root, "assets/icon.svg"), "utf8"), tokens = readFileSync(path.join(root, "ui/tokens.css"), "utf8");
  for (const color of icon.match(/#[a-f0-9]{6}/gi)) assert.ok(tokens.includes(color));
  assert.equal((icon.match(/rx="40"/g) || []).length, 4);
  const digest = createHash("sha256").update(readFileSync(path.join(root, "assets/icon.png"))).digest("hex"); assert.equal(digest.length, 64);
});
