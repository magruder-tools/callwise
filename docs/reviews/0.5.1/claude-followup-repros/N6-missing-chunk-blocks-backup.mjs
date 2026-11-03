// New in 0.5.1: recover() no longer marks audio rows whose file is gone as `missing`, and backupRecords() reads
// every non-missing chunk, so one absent file makes every later backup fail. The absent file here comes from
// prune()'s two-step delete (rmSync(file), then remove(row)) interrupted between the steps.
// Run with CALLWISE_ROOT pointing at a 0.5.0 tree to compare (0.5.0 marked the row missing and backed up).
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-missing-")), key = randomBytes(32);
const s = new MeetingStore(dir, { key, keyId: "k" });
const mid = "33333333-3333-4333-8333-333333333333";
s.put("meetings", mid, mid, { title: "Recorded call", people: [], status: "ended", createdAt: 1 });
for (let i = 0; i < 3; i++) s.writeAudio(mid, "mic", i, Buffer.alloc(1000, i), { startMs: i * 10000, endMs: i * 10000 + 10000 });
rmSync(path.join(dir, s.get("audio_chunks", mid, "mic:1").path)); // prune() step 1 ran; the app quit before step 2
s.close();
const reopened = new MeetingStore(dir, { key, keyId: "k" }); // next launch runs recover()
console.log("after relaunch, mic:1 row (0.5.0 marked it missing at launch; 0.5.2 handles it when read or backed up):", { exists: !!reopened.get("audio_chunks", mid, "mic:1"), missing: reopened.get("audio_chunks", mid, "mic:1")?.missing });
const backup = path.join(dir, "..", path.basename(dir) + ".cwbackup");
try {
  if (reopened.backupToFile) reopened.backupToFile(backup, "correct horse battery staple");
  else reopened.backup("correct horse battery staple");
  console.log("backup: saved");
} catch (e) {
  console.log("backup: FAILED ->", e.message);
}
try { reopened.readAudio(mid, "mic:1"); } catch (e) { console.log("playback of mic:1 ->", e.message); }
reopened.close();
rmSync(dir, { recursive: true, force: true });
rmSync(backup, { force: true });

// Part 2 (0.5.1 only): the same failure when a meeting is deleted while the archive worker is mid-backup.
if (MeetingStore.prototype.backupRecords) {
  const d2 = mkdtempSync(path.join(os.tmpdir(), "cw-race-")), k2 = randomBytes(32);
  const writer = new MeetingStore(d2, { key: k2, keyId: "k" });
  const a = "44444444-4444-4444-8444-444444444444", b = "55555555-5555-4555-8555-555555555555";
  for (const m of [a, b]) {
    writer.put("meetings", m, m, { title: m.slice(0, 4), people: [], status: "ended", createdAt: 1 });
    for (let i = 0; i < 3; i++) writer.writeAudio(m, "mic", i, Buffer.alloc(1000, i), { startMs: i, endMs: i + 1 });
  }
  const worker = new MeetingStore(d2, { key: k2, keyId: "k", readOnly: true }); // archive-worker.mjs connection
  const frames = worker.backupRecords();
  frames.next(); // header: the snapshot is fixed here
  writer.backupStarted?.(); // 0.5.2: desktop/meeting-commands.mjs marks the backup before starting the worker
  let t = Date.now();
  writer.deleteMeeting(b); // user deletes a meeting from History while the backup runs
  const blocked = Date.now() - t;
  try { let end; for (const f of frames) end = f; console.log("backup during delete: saved", end?.missingAudio !== undefined ? `(audio pieces saved as missing: ${end.missingAudio})` : ""); }
  catch (e) { console.log("backup during delete: FAILED ->", e.message.replace(d2, "<library>")); }
  worker.close();
  writer.backupFinished?.();
  t = Date.now();
  writer.deleteMeeting(a); // same delete with no backup snapshot open
  console.log(`deleteMeeting() blocked the calling thread for ${blocked} ms during the backup (wal_checkpoint(TRUNCATE) waits for busy_timeout) vs ${Date.now() - t} ms without one`);
  writer.close(); rmSync(d2, { recursive: true, force: true });
}
