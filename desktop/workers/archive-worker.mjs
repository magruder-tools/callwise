import { parentPort, workerData } from "node:worker_threads";
import { MeetingStore } from "../../core/meetings/store.mjs";
const store = new MeetingStore(workerData.directory, {
  key: workerData.key,
  keyId: workerData.keyId,
  readOnly: true,
});
try {
  parentPort.postMessage({ data: store.backup(workerData.passphrase) });
} catch {
  parentPort.postMessage({
    error:
      "The encrypted backup could not be created. Check the passphrase and available disk space.",
  });
} finally {
  store.close();
}
