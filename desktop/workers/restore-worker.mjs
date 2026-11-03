import { parentPort, workerData } from "node:worker_threads";
import { cpSync, readdirSync, lstatSync } from "node:fs";
import path from "node:path";
import { MeetingStore } from "../../core/meetings/store.mjs";
let store;
try {
  parentPort.postMessage({ progress: { phase: "Unlocking backup" } });
  // Preserve auxiliary files, including the Keychain-wrapped key, without copying SQLite state.
  for (const name of readdirSync(workerData.directory)) {
    if (
      ["library.db", "library.db-wal", "library.db-shm", "audio"].includes(name)
    )
      continue;
    const source = path.join(workerData.directory, name);
    if (lstatSync(source).isSymbolicLink())
      throw new Error("Restore cannot copy a linked library file.");
    cpSync(source, path.join(workerData.stage, name), {
      recursive: true,
      dereference: false,
    });
  }
  store = new MeetingStore(workerData.stage, {
    key: workerData.key,
    keyId: workerData.keyId,
    recover: false,
  });
  store.restoreFile(workerData.file, workerData.passphrase, {
    onProgress: (progress) => parentPort.postMessage({ progress }),
  });
  if (workerData.reservedIds.some((id) => store.get("meetings", id)))
    throw new Error(
      "An open unsaved meeting has the same identifier as this backup. Export it and reopen Callwise before restoring.",
    );
  store.close();
  parentPort.postMessage({ restored: true });
} catch (error) {
  parentPort.postMessage({
    error: error.message || "The backup could not be restored.",
  });
} finally {
  store?.close();
  workerData.key.fill(0);
  workerData.passphrase = "";
}
