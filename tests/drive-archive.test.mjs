import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import lame from "@breezystack/lamejs";
import { MeetingStore } from "../core/meetings/store.mjs";
import { MeetingService } from "../core/meetings/service.mjs";
import { DriveArchive } from "../desktop/drive-archive.mjs";

function mp3() {
  const encoder = new lame.Mp3Encoder(1, 24000, 48),
    samples = new Int16Array(24000),
    parts = [];
  for (let i = 0; i < samples.length; i++)
    samples[i] = Math.round(Math.sin((i * 2 * Math.PI * 440) / 24000) * 2000);
  for (let i = 0; i < samples.length; i += 1152)
    parts.push(
      Buffer.from(encoder.encodeBuffer(samples.subarray(i, i + 1152))),
    );
  parts.push(Buffer.from(encoder.flush()));
  return Buffer.concat(parts);
}
function fixture(t, header = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "callwise-drive-")),
    key = randomBytes(32);
  const store = new MeetingStore(path.join(directory, "meetings"), { key });
  const meetings = new MeetingService({ store });
  store.put("meetings", "m", "m", {
    title: "Synthetic archive test",
    people: [],
    createdAt: Date.now() - 10000,
    status: "ended",
    saving: true,
    driveArchive: true,
    contentRevision: 1,
    ...header,
  });
  store.put("docs", "m", "notes:original", {
    text: "Synthetic notes",
    version: 1,
  });
  store.put("segments", "m", "line1", {
    text: "Synthetic transcript",
    speaker: "You",
    startMs: 0,
    endMs: 1000,
    final: true,
  });
  const audio = mp3();
  store.writeAudio("m", "mic", 0, audio, { startMs: 0, endMs: 1000 });
  const archive = new DriveArchive({
    meetings,
    directory: path.join(directory, "outbox"),
    folderId: "privateFolder1",
  });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, store, meetings, archive, key, audio };
}
function receipt(f, patch = {}) {
  const job = JSON.parse(
    readFileSync(path.join(f.archive.directory, "m", "job.json")),
  );
  const value = {
    verified: true,
    fileId: "remoteFile1",
    folderId: "privateFolder1",
    bytes: job.bytes,
    md5: job.md5,
    trashed: false,
    checkedAt: Date.now(),
    ...patch,
  };
  writeFileSync(
    path.join(f.archive.directory, "m", "verified-drive-receipt.json"),
    JSON.stringify(value),
  );
  return { job, value };
}
test("only ended meetings explicitly configured for Drive are exported", (t) => {
  for (const header of [
    { driveArchive: false },
    { status: "running" },
    { saving: false },
  ]) {
    const f = fixture(t, header);
    assert.equal(f.archive.prepare("m").skipped, true);
    assert.equal(f.archive.pending().length, 0);
  }
});
test("portable archive includes playable MP3 and readable notes, not database or library key", (t) => {
  const f = fixture(t),
    job = f.archive.prepare("m"),
    file = path.join(f.archive.directory, "m", job.fileName);
  const names = execFileSync("/usr/bin/tar", ["-tzf", file], {
    encoding: "utf8",
  });
  assert.match(names, /microphone\.mp3/);
  assert.match(names, /transcript-and-notes\.md/);
  assert.doesNotMatch(names, /library\.db|archive-key|preferences|connections/);
  const extracted = execFileSync("/usr/bin/tar", [
    "-xOzf",
    file,
    "./microphone.mp3",
  ]);
  assert.deepEqual(extracted, f.audio);
  assert.match(
    execFileSync("/usr/bin/tar", ["-xOzf", file, "./transcript-and-notes.md"], {
      encoding: "utf8",
    }),
    /Synthetic transcript/,
  );
  assert.equal(f.archive.prepare("m").queued, true);
  assert.equal(f.archive.pending().length, 1);
  assert.deepEqual(f.store.readAudio("m", "mic:0"), f.audio);
});
test("missing, mismatched or wrong-folder receipt never removes originals", (t) => {
  const f = fixture(t);
  f.archive.prepare("m");
  assert.equal(f.archive.acknowledge("m").waiting, true);
  for (const patch of [
    { md5: "wrong" },
    { folderId: "wrong" },
    { bytes: 0 },
    { trashed: true },
    { verified: false },
  ]) {
    receipt(f, patch);
    assert.throws(() => f.archive.acknowledge("m"), /verification/);
    assert.deepEqual(f.store.readAudio("m", "mic:0"), f.audio);
  }
});
test("verified upload removes original audio and outbox while preserving searchable notes and transcript", (t) => {
  const f = fixture(t);
  f.archive.prepare("m");
  receipt(f);
  const result = f.archive.acknowledge("m");
  assert.equal(result.removedLocalAudioChunks, 1);
  assert.equal(f.store.get("audio_chunks", "m", "mic:0").archived, true);
  assert.equal(
    existsSync(path.join(f.store.directory, "audio/m/mic/0.cwa")),
    false,
  );
  assert.equal(existsSync(path.join(f.archive.directory, "m")), false);
  assert.equal(
    f.store.get("docs", "m", "notes:original").text,
    "Synthetic notes",
  );
  assert.equal(
    f.store.get("segments", "m", "line1").text,
    "Synthetic transcript",
  );
  assert.equal(
    f.store.get("meetings", "m").driveArchived.fileId,
    "remoteFile1",
  );
});
test("audio altered after export prevents offload", (t) => {
  const f = fixture(t);
  f.archive.prepare("m");
  receipt(f);
  f.store.writeAudio("m", "mic", 0, Buffer.from("changed"), {
    startMs: 0,
    endMs: 1000,
  });
  assert.throws(() => f.archive.acknowledge("m"), /changed after export/);
  assert.equal(f.store.readAudio("m", "mic:0").toString(), "changed");
});
test("missing expected audio rejects export without publishing a job", (t) => {
  const f = fixture(t);
  rmSync(path.join(f.store.directory, "audio/m/mic/0.cwa"));
  assert.throws(() => f.archive.prepare("m"), /no longer available/);
  assert.equal(f.archive.pending().length, 0);
});
test("retention does not delete a meeting or audio awaiting verified Drive backup", (t) => {
  const f = fixture(t, { createdAt: Date.now() - 400 * 86400000 });
  f.store.prune({ meetingDays: 30, audioDays: 7 });
  assert.ok(f.store.get("meetings", "m"));
  assert.deepEqual(f.store.readAudio("m", "mic:0"), f.audio);
});
test("packaged-style export worker prepares outbox from encrypted readonly library", async (t) => {
  const f = fixture(t);
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../desktop/workers/drive-export-worker.mjs", import.meta.url),
      {
        workerData: {
          directory: f.store.directory,
          key: f.key,
          keyId: f.store.keyId,
          outbox: f.archive.directory,
          folderId: "privateFolder1",
          meetingId: "m",
        },
      },
    );
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  assert.equal(result.queued, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(f.store.readAudio("m", "mic:0"), f.audio);
});
test("deleting a queued meeting cancels its local upload job", async (t) => {
  const f = fixture(t);
  f.archive.prepare("m");
  await f.meetings.delete("m");
  assert.equal(f.archive.pending().length, 0);
  assert.equal(f.archive.cancelled("m"), true);
  assert.equal(existsSync(path.join(f.archive.directory, "m")), false);
});
test("delete all cancels queued archive jobs before resetting the library", async (t) => {
  const f = fixture(t);
  f.archive.prepare("m");
  await f.meetings.deleteAll();
  assert.equal(f.archive.pending().length, 0);
  assert.equal(f.archive.cancelled("m"), true);
});
