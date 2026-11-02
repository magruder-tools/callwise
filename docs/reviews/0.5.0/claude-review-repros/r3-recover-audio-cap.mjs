// Repro: MeetingStore.recover() builds its "valid audio" set from all("audio_chunks"), which stops at 100,000 rows,
// then deletes every file under audio/ that is not in that set.
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os"; import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-audio-"));
const key = randomBytes(32), keyId = "key-a";
const s = new MeetingStore(dir, { key, keyId });
const mid = "22222222-2222-4222-8222-222222222222", N = 100010; // one channel of 10 s chunks for speed; 100,000 chunk rows = about 139 h of two-channel recording
s.put("meetings", mid, mid, { title: "Recorded", people: [], status: "ended", createdAt: 1 });
let t = Date.now();
s.transaction(() => { for (let i = 0; i < N; i++) s.writeAudio(mid, "mic", i, Buffer.from([1, 2, 3]), { startMs: i * 10000, endMs: i * 10000 + 10000 }); });
const files = () => readdirSync(path.join(dir, "audio", mid, "mic")).length;
console.log(`wrote ${N} chunk rows + files in ${Date.now() - t} ms; files on disk = ${files()}`);
s.close();
t = Date.now();
const reopened = new MeetingStore(dir, { key, keyId }); // normal launch: recover = true
console.log(`after relaunch recovery (${Date.now() - t} ms): files on disk = ${files()}, rows = ${reopened.db.prepare("SELECT count(*) c FROM audio_chunks").get().c}`);
try { reopened.readAudio(mid, `mic:${N - 1}`); console.log("last chunk readable"); } catch (e) { console.log("last chunk:", e.code || e.message); }
reopened.close(); rmSync(dir, { recursive: true, force: true });
