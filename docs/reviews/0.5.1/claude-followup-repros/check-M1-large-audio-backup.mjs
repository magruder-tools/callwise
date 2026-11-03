// 0.5.1 check of M1: a library holding ~11 hours of two-channel audio (well past the 0.5.0 single-string limit at
// about 9.3 h) is backed up to CWBACKUP2 and restored. Reports time and peak RSS, and compares every restored chunk
// byte-for-byte with what was written.
// Uses ~1.6 GB of temporary disk. Pass CALLWISE_ROOT=<0.5.0 tree> to see the 0.5.0 behaviour (in-memory backup()).
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const base = mkdtempSync(path.join(os.tmpdir(), "cw-m1-"));
const a = new MeetingStore(path.join(base, "a"), { key: randomBytes(32), keyId: "a" });
const mid = "66666666-6666-4666-8666-666666666666";
a.put("meetings", mid, mid, { title: "Long retained recordings", people: [], status: "ended", createdAt: 1 });
const CHUNK = 60000; // one 10 s chunk at 48 kbps
const N = Math.ceil((11 * 43.2e6) / CHUNK); // 11 h of two channels
let t = Date.now();
const sample = randomBytes(CHUNK);
for (let i = 0; i < N; i++) {
  sample.writeUInt32LE(i, 0);
  a.writeAudio(mid, i % 2 ? "system" : "mic", i >> 1, sample, { startMs: (i >> 1) * 10000, endMs: (i >> 1) * 10000 + 10000 });
}
console.log(`wrote ${N} chunks (${((N * CHUNK) / 1e6).toFixed(0)} MB, ~${((N * CHUNK) / 43.2e6).toFixed(1)} h) in ${((Date.now() - t) / 1000).toFixed(0)} s`);
const file = path.join(base, "library.cwbackup");
t = Date.now();
try {
  if (a.backupToFile) a.backupToFile(file, "correct horse battery staple");
  else a.backup("correct horse battery staple");
  console.log(`backup: ${a.backupToFile ? (statSync(file).size / 1e6).toFixed(0) + " MB file" : "ok"} in ${((Date.now() - t) / 1000).toFixed(0)} s; peak RSS so far ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
} catch (e) {
  console.log(`backup FAILED after ${((Date.now() - t) / 1000).toFixed(0)} s -> ${e.constructor.name}: ${e.message}`);
  a.close(); rmSync(base, { recursive: true, force: true }); process.exit(0);
}
a.close();
const b = new MeetingStore(path.join(base, "b"), { key: randomBytes(32), keyId: "b" });
t = Date.now();
b.restoreFile(file, "correct horse battery staple");
const restoredIn = ((Date.now() - t) / 1000).toFixed(0);
let mismatched = 0;
for (let i = 0; i < N; i++) {
  sample.writeUInt32LE(i, 0); // the exact bytes written for chunk i
  if (!b.readAudio(mid, `${i % 2 ? "system" : "mic"}:${i >> 1}`).equals(sample)) mismatched++;
}
console.log(`restore: ${b.db.prepare("SELECT count(*) c FROM audio_chunks").get().c} chunks in ${restoredIn} s; chunks differing from the originals byte-for-byte: ${mismatched} of ${N}; peak RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
b.close();
rmSync(base, { recursive: true, force: true });
