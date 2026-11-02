import { parentPort, workerData } from "node:worker_threads";
import { MeetingStore } from "../../core/meetings/store.mjs";
const store = new MeetingStore(workerData.directory, {
  key: workerData.key,
  keyId: workerData.keyId,
  readOnly: true,
});
try {
  store.backupToFile(workerData.file, workerData.passphrase);
  parentPort.postMessage({ saved: true });
} catch (error) {
  parentPort.postMessage({
    error: error.message || "The encrypted backup could not be created.",
  });
} finally {
  store.close();
}
