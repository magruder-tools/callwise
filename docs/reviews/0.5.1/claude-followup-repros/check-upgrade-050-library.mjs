// Compatibility check: a library written by 0.5.0 opens in 0.5.1 (v1 records, colon AAD), its audio plays,
// edits are written as v2 records, and the upgraded library round-trips through CWBACKUP2.
// Needs CALLWISE_050_ROOT pointing at a 0.5.0 tree (git archive 118decb).
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const OLD = process.env.CALLWISE_050_ROOT;
if (!OLD) throw new Error("Set CALLWISE_050_ROOT to a 0.5.0 source tree.");
const { MeetingStore: OldStore } = await import(`${OLD}/core/meetings/store.mjs`);
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const base = mkdtempSync(path.join(os.tmpdir(), "cw-upgrade-")), key = randomBytes(32), dir = path.join(base, "lib");
const old = new OldStore(dir, { key, keyId: "k" });
const id = "12121212-1212-4121-8121-121212121212", legacy = "legacy:abcdef";
old.put("meetings", id, id, { title: "Recorded in 0.5.0", people: ["Dana"], status: "ended", createdAt: 1 });
old.put("segments", id, "system:e1:0", { text: "Old transcript line.", speaker: "Them", channel: "system", final: true, startMs: 0, endMs: 1 });
old.writeAudio(id, "mic", 0, Buffer.from("old audio"), { startMs: 0, endMs: 10000 });
old.put("meetings", legacy, legacy, { title: "Migrated sheet", people: [], status: "ended", createdAt: 0 });
old.close();
const s = new MeetingStore(dir, { key, keyId: "k" });
const versionByte = () => s.db.prepare("SELECT data FROM meetings WHERE id=?").get(id).data[0];
console.log("this version opens the 0.5.0 library:", s.all("meetings").map((m) => m.title), "| segment:", s.get("segments", id, "system:e1:0")?.text, "| audio:", s.readAudio(id, "mic:0").toString());
console.log("header record version before/after an edit:", versionByte(), "->", (s.put("meetings", id, id, { ...s.get("meetings", id), title: "Edited after the upgrade" }), versionByte()));
const file = path.join(base, "upgraded.cwbackup");
s.backupToFile(file, "correct horse battery staple");
s.close();
const t = new MeetingStore(path.join(base, "restored"), { key: randomBytes(32), keyId: "t" });
t.restoreFile(file, "correct horse battery staple");
console.log("CWBACKUP2 of the upgraded library restores:", t.all("meetings").map((m) => m.title), "| audio:", t.readAudio(id, "mic:0").toString());
t.close();
rmSync(base, { recursive: true, force: true });
