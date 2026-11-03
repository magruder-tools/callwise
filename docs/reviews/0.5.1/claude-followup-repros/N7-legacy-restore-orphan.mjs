// New in 0.5.1: restoring a 0.5.0 (CWBACKUP1) backup that contains an orphan audio chunk (left by the 0.5.0 L12
// delete race) stops part-way with "Meeting not found.": records are already committed, later audio is skipped,
// recover() never runs, and a retry is refused because the library is no longer empty.
// Needs CALLWISE_050_ROOT pointing at a 0.5.0 tree (git archive 118decb) to write the old backup.
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const OLD = process.env.CALLWISE_050_ROOT;
if (!OLD) throw new Error("Set CALLWISE_050_ROOT to a 0.5.0 source tree.");
const { MeetingStore: OldStore } = await import(`${OLD}/core/meetings/store.mjs`);
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const base = mkdtempSync(path.join(os.tmpdir(), "cw-legacy-"));
const old = new OldStore(path.join(base, "old"), { key: randomBytes(32), keyId: "old" });
const kept = ["11111111-1111-4111-8111-111111111111", "77777777-7777-4777-8777-777777777777"], gone = "0aaaaaaa-0aaa-4aaa-8aaa-0aaaaaaaaaaa";
for (const id of [...kept, gone]) {
  old.put("meetings", id, id, { title: `Meeting ${id.slice(0, 1)}`, people: [], status: "ended", createdAt: 1 });
  old.put("docs", id, "notes:original", { text: `notes for ${id.slice(0, 1)}`, version: 1, lineTimes: [] });
  for (let i = 0; i < 2; i++) old.writeAudio(id, "mic", i, Buffer.alloc(100, i), { startMs: i, endMs: i + 1 });
}
old.deleteMeeting(gone);
old.writeAudio(gone, "mic", 2, Buffer.alloc(100, 9), { startMs: 0, endMs: 1 }); // L12: the final flush lands after Delete
const bytes = old.backup("correct horse battery staple");
console.log("0.5.0 backup:", bytes.subarray(0, 9).toString(), "| orphan chunk rows in source:", old.db.prepare("SELECT count(*) c FROM audio_chunks WHERE meeting_id=?").get(gone).c);
old.close();
const target = new MeetingStore(path.join(base, "new"), { key: randomBytes(32), keyId: "new" });
const tryRestore = () => { try { target.restore(bytes, "correct horse battery staple"); return "restored"; } catch (e) { return `FAILED -> ${e.message}`; } };
const first = tryRestore();
console.log("restore with this version:", first);
const count = (t) => target.db.prepare(`SELECT count(*) c FROM ${t}`).get().c;
console.log("library after the restore:", { meetings: count("meetings"), notes: count("docs"), audioChunks: count("audio_chunks"), expectedAudioChunks: 4 });
if (first !== "restored") console.log("retry:", tryRestore());
target.close();
rmSync(base, { recursive: true, force: true });
