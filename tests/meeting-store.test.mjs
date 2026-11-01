import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { MeetingStore } from "../core/meetings/store.mjs";
import { seal, unseal } from "../core/meetings/crypto.mjs";
function fixture(t, options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "callwise-store-")),
    key = randomBytes(32);
  const store = new MeetingStore(dir, { key, ...options });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir, key };
}
test("archive encryption authenticates table, meeting, row and key identifiers", () => {
  const key = randomBytes(32),
    bytes = seal(key, { text: "Private sample" }, "segments:one:row", "one");
  assert.deepEqual(unseal(key, bytes, "segments:one:row", { keyId: "one" }), {
    text: "Private sample",
  });
  for (const [aad, id] of [
    ["segments:two:row", "one"],
    ["docs:one:row", "one"],
    ["segments:one:row", "two"],
  ])
    assert.throws(() => unseal(key, bytes, aad, { keyId: id }));
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => unseal(key, bytes, "segments:one:row", { keyId: "one" }));
});
test("titles, people, words, notes and actions never enter database or WAL as plaintext", (t) => {
  const { store, dir } = fixture(t);
  for (const table of ["meetings", "segments", "docs", "actions"])
    store.put(table, "meeting", "row", {
      title: "SecretTitleZX",
      people: ["SecretNameZX"],
      text: "SecretWordsZX",
      status: "ended",
    });
  for (const name of ["library.db", "library.db-wal"])
    if (existsSync(path.join(dir, name))) {
      const bytes = readFileSync(path.join(dir, name));
      for (const value of ["SecretTitleZX", "SecretNameZX", "SecretWordsZX"])
        assert.equal(bytes.includes(Buffer.from(value)), false);
    }
});
test("version guards, reopening and readonly access preserve data", (t) => {
  const { store, dir, key } = fixture(t);
  store.put("meetings", "m", "m", { title: "Meeting", status: "ended" }, 0);
  assert.throws(
    () => store.put("meetings", "m", "m", { title: "Lost" }, 0),
    /changed/,
  );
  const read = new MeetingStore(dir, { key, readOnly: true });
  assert.equal(read.get("meetings", "m").title, "Meeting");
  assert.throws(() => read.put("meetings", "m", "m", {}), /read-only/);
  read.close();
});
test("recovery marks interrupted meetings and finalizes drafts without starting capture", (t) => {
  const { store, dir, key } = fixture(t);
  store.put("meetings", "m", "m", { title: "Interrupted", status: "running" });
  store.put("segments", "m", "mic:e1:1", { text: "last words", final: false });
  store.close();
  const recovered = new MeetingStore(dir, { key });
  assert.equal(recovered.get("meetings", "m").interrupted, true);
  assert.equal(recovered.get("segments", "m", "mic:e1:1").unfinalized, true);
  assert.equal(recovered.all("events", "m").length, 1);
  recovered.close();
});
test("existing unreadable key is never replaced", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "callwise-key-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "archive-key.bin");
  writeFileSync(file, "old protected key");
  const storage = {
    isEncryptionAvailable: () => true,
    decryptString: () => {
      throw new Error("locked");
    },
  };
  assert.throws(() => new MeetingStore(dir, { storage }), /not been replaced/);
  assert.equal(readFileSync(file, "utf8"), "old protected key");
});
test("backup uses its passphrase and restores meeting data and audio under a new archive key", (t) => {
  const { store } = fixture(t),
    other = fixture(t).store;
  store.put("meetings", "m", "m", {
    title: "Portable meeting",
    status: "ended",
  });
  store.put("docs", "m", "notes:original", { text: "Portable notes" });
  store.writeAudio("m", "mic", 0, Buffer.from("synthetic-mp3"), {
    startMs: 0,
    endMs: 1000,
  });
  const bytes = store.backup("a sufficiently long passphrase");
  assert.equal(bytes.includes(Buffer.from("Portable notes")), false);
  assert.throws(() => other.restore(bytes, "wrong passphrase"), /unlocked/);
  other.restore(bytes, "a sufficiently long passphrase");
  assert.equal(other.get("docs", "m", "notes:original").text, "Portable notes");
  assert.equal(other.readAudio("m", "mic:0").toString(), "synthetic-mp3");
  assert.throws(
    () => other.restore(bytes, "a sufficiently long passphrase"),
    /empty/,
  );
});
test("retention deletes only eligible ended content and removes retained audio files", (t) => {
  const { store, dir } = fixture(t, { clock: () => 100 * 86400000 });
  store.put("meetings", "old", "old", { status: "ended", createdAt: 0 });
  store.put("meetings", "active", "active", {
    status: "running",
    createdAt: 0,
  });
  store.writeAudio("old", "system", 0, Buffer.from("sample"), {});
  store.prune({ meetingDays: 30 });
  assert.equal(store.get("meetings", "old"), null);
  assert.ok(store.get("meetings", "active"));
  assert.equal(existsSync(path.join(dir, "audio/old")), false);
});
