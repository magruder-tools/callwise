import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { MeetingStore, atomicWrite } from "../core/meetings/store.mjs";

const journalPath = (directory) => `${directory}.restore.json`;
function readJournal(directory) {
  const file = journalPath(directory);
  if (!existsSync(file)) return null;
  const entry = JSON.parse(readFileSync(file, "utf8"));
  if (!/^[0-9a-f-]{36}$/.test(entry.token))
    throw new Error(
      "The restore recovery record is invalid. Keep the library files for recovery.",
    );
  return {
    stage: `${directory}.restore-${entry.token}`,
    previous: `${directory}.before-${entry.token}`,
  };
}
// A crash between the two renames is recoverable before opening or creating a library.
export function recoverRestoreSwap(directory) {
  const entry = readJournal(directory);
  if (!entry) return;
  if (!existsSync(directory)) {
    if (existsSync(entry.stage)) renameSync(entry.stage, directory);
    else if (existsSync(entry.previous)) renameSync(entry.previous, directory);
    else
      throw new Error(
        "The interrupted restore needs recovery. No library was replaced.",
      );
  }
  rmSync(entry.stage, { recursive: true, force: true });
  rmSync(entry.previous, { recursive: true, force: true });
  rmSync(journalPath(directory), { force: true });
}
export function stageRestore(
  store,
  file,
  passphrase,
  onProgress = () => {},
  { timeout = 30 * 60000, reservedIds = [] } = {},
) {
  const stage = `${store.directory}.restore-${randomUUID()}`;
  mkdirSync(stage, { mode: 0o700 });
  return new Promise((resolve, reject) => {
    let failure, result;
    const worker = new Worker(
      new URL("./workers/restore-worker.mjs", import.meta.url),
      {
        workerData: {
          directory: store.directory,
          stage,
          key: store.key,
          keyId: store.keyId,
          file,
          passphrase,
          reservedIds,
        },
      },
    );
    const timer = setTimeout(() => {
      failure = new Error(
        "The restore took too long. Your existing library is unchanged.",
      );
      void worker.terminate();
    }, timeout);
    worker.on("message", (message) => {
      if (message.progress) onProgress(message.progress);
      else if (message.error) failure = new Error(message.error);
      else if (message.restored) result = { stage };
    });
    worker.once("error", (error) => {
      failure = error;
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (failure || code !== 0 || !result) {
        rmSync(stage, { recursive: true, force: true });
        reject(
          failure ||
            new Error(
              "The restore stopped. Your existing library is unchanged.",
            ),
        );
      } else resolve(result);
    });
  });
}
export function publishRestore(store, stage) {
  const directory = store.directory;
  const token = stage.slice(`${directory}.restore-`.length);
  if (
    stage !== `${directory}.restore-${token}` ||
    !/^[0-9a-f-]{36}$/.test(token)
  )
    throw new Error("Invalid staged restore.");
  if (!store.isEmpty() || store.backupReaders > 0)
    throw new Error(
      "Restore requires an empty library with no backup in progress.",
    );
  const previous = `${directory}.before-${token}`;
  const key = Buffer.from(store.key),
    options = {
      key,
      keyId: store.keyId,
      storage: store.storage,
      recover: false,
    };
  atomicWrite(journalPath(directory), JSON.stringify({ token }));
  store.close();
  let replacement;
  try {
    renameSync(directory, previous);
    renameSync(stage, directory);
    replacement = new MeetingStore(directory, options);
  } catch (error) {
    if (existsSync(previous)) {
      // Put the original empty library back, even when opening the staged one failed.
      if (existsSync(directory)) renameSync(directory, stage);
      renameSync(previous, directory);
    }
    Object.assign(store, new MeetingStore(directory, options));
    rmSync(stage, { recursive: true, force: true });
    rmSync(journalPath(directory), { force: true });
    throw error;
  } finally {
    key.fill(0);
  }
  // Keep the store object identity used by retention, delete and the meeting service.
  Object.assign(store, replacement);
  rmSync(previous, { recursive: true, force: true });
  rmSync(journalPath(directory), { force: true });
  return store;
}
