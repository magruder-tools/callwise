import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { MeetingStore } from "../core/meetings/store.mjs";
import { MeetingService } from "../core/meetings/service.mjs";
import { FolderArchive } from "../desktop/folder-archive.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
function fixture(t, options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "callwise-folder-")),
    destination = path.join(dir, "cloud");
  mkdirSync(destination);
  const store = new MeetingStore(path.join(dir, "library"), {
      key: randomBytes(32),
    }),
    meetings = new MeetingService({ store }),
    calls = [];
  store.put("meetings", "m", "m", {
    title: "Synthetic folder archive",
    people: [],
    createdAt: Date.now(),
    status: "ended",
    saving: true,
    iCloudArchive: { folder: destination },
    contentRevision: 1,
  });
  store.put("docs", "m", "notes:original", {
    text: "Synthetic notes only",
    version: 1,
  });
  store.put("segments", "m", "s", {
    text: "Synthetic transcript only",
    speaker: "You",
    startMs: 0,
    endMs: 1000,
    final: true,
  });
  store.writeAudio("m", "mic", 0, Buffer.from("synthetic audio bytes"), {
    startMs: 0,
    endMs: 1000,
  });
  const native = {
    run: async (mode, args, opts = {}) => {
      calls.push(args);
      if (options.run)
        return options.run(mode, args, opts, {
          dir,
          store,
          meetings,
          destination,
        });
      if (args.op === "pdf") {
        writeFileSync(args.output, "%PDF-synthetic-test-double");
        return { saved: true };
      }
      if (args.op === "wait-upload") return { uploaded: true };
      if (args.op === "verify-and-evict")
        return { verified: true, audioEvicted: true };
      if (args.op === "cancel-pending")
        return { alreadyUploaded: true, trashed: false };
    },
  };
  const archive = new FolderArchive({
    meetings,
    native,
    directory: path.join(dir, "jobs"),
    ...options,
  });
  const states = [];
  archive.on("status", (s) => states.push(s));
  t.after(() => {
    archive.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, destination, store, meetings, archive, calls, states };
}
async function defaultRun(args) {
  if (args.op === "pdf") {
    writeFileSync(args.output, "%PDF-synthetic-test-double");
    return { saved: true };
  }
  if (args.op === "wait-upload") return { uploaded: true };
  if (args.op === "verify-and-evict")
    return { verified: true, audioEvicted: true };
}
test("finished export includes separate readable files and verifies manifest before removing only local audio", async (t) => {
  const f = fixture(t);
  await f.archive.enqueue("m");
  const folder = path.join(f.destination, readdirSync(f.destination)[0]);
  assert.deepEqual(readdirSync(folder).sort(), [
    "manifest.json",
    "meeting.json",
    "microphone.mp3",
    "transcript-and-notes.md",
    "transcript-and-notes.pdf",
    "transcript-and-notes.txt",
  ]);
  const verification = f.calls.find((c) => c.op === "verify-and-evict"),
    manifest = verification.files.find((c) => c.file === "manifest.json");
  assert.equal(
    manifest.sha256,
    hash(readFileSync(path.join(folder, "manifest.json"))),
  );
  assert.equal(
    existsSync(path.join(f.store.directory, "audio/m/mic/0.cwa")),
    false,
  );
  assert.equal(existsSync(path.join(f.archive.directory, "m")), false);
  assert.equal(
    f.store.get("docs", "m", "notes:original").text,
    "Synthetic notes only",
  );
  assert.equal(
    f.store.get("segments", "m", "s").text,
    "Synthetic transcript only",
  );
  assert.equal(f.states.at(-1).state, "archived");
});
for (const [name, result] of [
  ["unconfirmed upload", { uploaded: false }],
  ["unconfirmed eviction", { verified: true, audioEvicted: false }],
])
  test(name + " keeps the original recording", async (t) => {
    const f = fixture(t, {
      run: async (_mode, args) => {
        if (
          (name === "unconfirmed upload" && args.op === "wait-upload") ||
          (name === "unconfirmed eviction" && args.op === "verify-and-evict")
        )
          return result;
        return defaultRun(args);
      },
    });
    await f.archive.enqueue("m");
    assert.equal(
      f.store.readAudio("m", "mic:0").toString(),
      "synthetic audio bytes",
    );
    assert.equal(f.store.get("meetings", "m").folderArchived, undefined);
    assert.equal(f.states.at(-1).state, "waiting");
  });
test("an original recording changed after export is retained", async (t) => {
  const f = fixture(t, {
    run: async (_mode, args, _opts, { store }) => {
      if (args.op === "wait-upload")
        store.writeAudio("m", "mic", 0, Buffer.from("changed"), {
          startMs: 0,
          endMs: 1000,
        });
      return defaultRun(args);
    },
  });
  await f.archive.enqueue("m");
  assert.equal(f.store.readAudio("m", "mic:0").toString(), "changed");
  assert.equal(f.states.at(-1).state, "waiting");
});
test("crash after publication resumes the saved exact job without overwriting its export", async (t) => {
  let first = true;
  const f = fixture(t, {
    publish: (from, to) => {
      renameSync(from, to);
      if (first) {
        first = false;
        throw new Error("synthetic crash after rename");
      }
    },
  });
  await f.archive.enqueue("m");
  assert.equal(f.states.at(-1).state, "waiting");
  assert.equal(readdirSync(f.destination).length, 1);
  await f.archive.enqueue("m");
  assert.equal(f.states.at(-1).state, "archived");
  assert.equal(readdirSync(f.destination).length, 1);
});
test("native verification failure retains source and retry job", async (t) => {
  const f = fixture(t, {
    run: async (_mode, args) => {
      if (args.op === "verify-and-evict") throw new Error("synthetic mismatch");
      return defaultRun(args);
    },
  });
  await f.archive.enqueue("m");
  assert.ok(f.store.readAudio("m", "mic:0"));
  assert.equal(existsSync(path.join(f.archive.directory, "m/job.json")), true);
});
test("a pending export is cancelled through recoverable native trash before local meeting deletion", async (t) => {
  let waiting;
  const reached = new Promise((resolve) => (waiting = resolve));
  const f = fixture(t, {
    run: async (_mode, args, opts, { dir }) => {
      if (args.op === "wait-upload")
        return new Promise((_resolve, reject) => {
          waiting();
          opts.signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        });
      if (args.op === "cancel-pending") {
        renameSync(args.folder, path.join(dir, "recoverable-trash"));
        return { trashed: true, alreadyUploaded: false };
      }
      return defaultRun(args);
    },
  });
  const exportJob = f.archive.enqueue("m");
  await reached;
  await f.meetings.delete("m");
  await exportJob;
  assert.equal(readdirSync(f.destination).length, 0);
  assert.equal(existsSync(path.join(f.dir, "recoverable-trash")), true);
  assert.equal(f.store.get("meetings", "m"), null);
});
test("failed pending-export cancellation blocks local deletion and preserves retry metadata", async (t) => {
  const f = fixture(t, {
    run: async (_mode, args) => {
      if (args.op === "wait-upload") return { uploaded: false };
      if (args.op === "cancel-pending") throw new Error("cannot trash");
      return defaultRun(args);
    },
  });
  await f.archive.enqueue("m");
  await assert.rejects(f.meetings.delete("m"), /cannot trash/);
  assert.ok(f.store.get("meetings", "m"));
  assert.ok(f.store.readAudio("m", "mic:0"));
  assert.equal(existsSync(path.join(f.archive.directory, "m/job.json")), true);
});

test("iCloud pending audio is protected from retention and cancellation persists", async (t) => {
  const f = fixture(t);
  const m = f.store.get("meetings", "m");
  f.store.put("meetings", "m", "m", {
    ...m,
    createdAt: Date.now() - 400 * 86400000,
  });
  f.store.prune({ meetingDays: 30, audioDays: 7 });
  assert.ok(f.store.readAudio("m", "mic:0"));
  await f.archive.cancel("m");
  assert.equal(f.store.get("meetings", "m").iCloudArchive.cancelled, true);
  f.store.prune({ meetingDays: 30, audioDays: 7 });
  assert.equal(f.store.get("meetings", "m"), null);
});
test("meeting completion event queues one export without a repeating timer", async (t) => {
  const f = fixture(t, {
    run: async (_mode, args) =>
      args.op === "wait-upload" ? { uploaded: false } : defaultRun(args),
  });
  f.meetings.emit("archive.ready", "m");
  await f.archive.completions.get("m");
  assert.ok(f.calls.some((c) => c.op === "pdf"));
  assert.ok(f.calls.some((c) => c.op === "wait-upload"));
  assert.equal(f.states.at(-1).state, "waiting");
});

test("restart finishes physical cleanup after a crash following the verified database commit", async (t) => {
  let crash = true;
  const f = fixture(t, {
    removeOriginal: (file) => {
      if (crash) {
        crash = false;
        throw new Error("synthetic crash after commit");
      }
      rmSync(file, { force: true });
    },
  });
  await f.archive.enqueue("m");
  const file = path.join(f.store.directory, "audio/m/mic/0.cwa");
  assert.ok(f.store.get("meetings", "m").folderArchived);
  assert.equal(existsSync(file), true);
  f.archive.resume();
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(path.join(f.archive.directory, "m")), false);
  assert.equal(
    f.store.get("docs", "m", "notes:original").text,
    "Synthetic notes only",
  );
});
test("manual retry cannot export while final recorder audio is still draining", async (t) => {
  const f = fixture(t);
  f.meetings.finishingConsumers.add({ meetingId: "m" });
  f.archive.resume();
  await f.archive.enqueue("m");
  assert.equal(f.calls.length, 0);
  assert.equal(readdirSync(f.destination).length, 0);
  f.meetings.finishingConsumers.clear();
  await f.archive.enqueue("m");
  assert.equal(f.states.at(-1).state, "archived");
});
test("a newly indexed audio tail after snapshot prevents offload of any originals", async (t) => {
  const f = fixture(t, {
    run: async (_mode, args, _opts, { store }) => {
      if (args.op === "wait-upload")
        store.writeAudio("m", "mic", 1, Buffer.from("final tail"), {
          startMs: 1000,
          endMs: 2000,
        });
      return defaultRun(args);
    },
  });
  await f.archive.enqueue("m");
  assert.equal(
    f.store.readAudio("m", "mic:0").toString(),
    "synthetic audio bytes",
  );
  assert.equal(f.store.readAudio("m", "mic:1").toString(), "final tail");
  assert.equal(f.store.get("meetings", "m").folderArchived, undefined);
});
