import { parentPort, workerData } from "node:worker_threads";
import { MeetingStore } from "../../core/meetings/store.mjs";
import { MeetingService } from "../../core/meetings/service.mjs";
import { prepareFolderExport } from "../folder-archive.mjs";
const store = new MeetingStore(workerData.directory, {
  key: workerData.key,
  keyId: workerData.keyId,
  readOnly: true,
});
try {
  store.db.exec("BEGIN");
  const result = prepareFolderExport({
    meetings: new MeetingService({ store }),
    id: workerData.meetingId,
    stage: workerData.stage,
  });
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: error.message || "Meeting export failed." });
} finally {
  try {
    store.db.exec("ROLLBACK");
  } catch {}
  store.close();
}
