// Run with ELECTRON_RUN_AS_NODE=1 using the signed app's executable. Synthetic data only.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
const root = path.resolve(process.argv[2]);
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { MeetingStore } = await load("core/meetings/store.mjs");
const { stageRestore, publishRestore } = await load(
  "desktop/library-restore.mjs",
);
const { createSecureStorage } = await load("desktop/secure-storage.mjs");
const packaged = JSON.parse(readFileSync(path.join(root, "package.json")));
assert.equal(
  packaged.version,
  JSON.parse(readFileSync("package.json")).version,
);
if (process.env.CALLWISE_BUILD_CHANNEL)
  assert.equal(packaged.releaseChannel, process.env.CALLWISE_BUILD_CHANNEL);
const dir = mkdtempSync(path.join(os.tmpdir(), "callwise-packaged-library-"));
let source, target;
try {
  source = new MeetingStore(path.join(dir, "source"), { key: randomBytes(32) });
  target = new MeetingStore(path.join(dir, "target"), { key: randomBytes(32) });
  source.put("meetings", "synthetic", "synthetic", {
    status: "ended",
    title: "Synthetic packaged restore",
    people: [],
  });
  source.put("docs", "synthetic", "notes:original", {
    text: "Synthetic notes only",
    version: 1,
  });
  source.writeAudio(
    "synthetic",
    "mic",
    0,
    Buffer.from("synthetic audio only"),
    { startMs: 0, endMs: 1000 },
  );
  const file = path.join(dir, "backup.cwbackup"),
    passphrase = "synthetic packaged passphrase";
  source.backupToFile(file, passphrase);
  const progress = [],
    staged = await stageRestore(target, file, passphrase, (p) =>
      progress.push(p),
    );
  assert.equal(target.isEmpty(), true);
  publishRestore(target, staged.stage);
  assert.equal(
    target.get("docs", "synthetic", "notes:original").text,
    "Synthetic notes only",
  );
  assert.equal(
    target.readAudio("synthetic", "mic:0").toString(),
    "synthetic audio only",
  );
  assert.ok(progress.length >= 2);
  let available = false,
    calls = 0;
  const storage = createSecureStorage(() => ({
    isEncryptionAvailable: () => {
      calls++;
      return available;
    },
  }));
  for (let i = 0; i < 20; i++)
    assert.equal(storage.isEncryptionAvailable(), false);
  assert.equal(calls, 1);
  available = true;
  assert.equal(storage.retryAccess(), true);
  assert.equal(calls, 2);
  console.log(
    "Packaged library passed: actual bundled restore worker, SQLite, encrypted notes/audio, progress and deliberate storage retry. Synthetic data only.",
  );
} finally {
  source?.close();
  target?.close();
  rmSync(dir, { recursive: true, force: true });
}
