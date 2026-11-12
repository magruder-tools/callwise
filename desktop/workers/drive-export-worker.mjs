import { parentPort, workerData } from "node:worker_threads";
import { MeetingStore } from "../../core/meetings/store.mjs";
import { MeetingService } from "../../core/meetings/service.mjs";
import { DriveArchive } from "../drive-archive.mjs";
const store = new MeetingStore(workerData.directory, {
  key: workerData.key,
  keyId: workerData.keyId,
  readOnly: true,
});
try {
  store.db.exec("BEGIN");
  const meetings = new MeetingService({ store });
  const archive = new DriveArchive({
    meetings,
    directory: workerData.outbox,
    folderId: workerData.folderId,
  });
  parentPort.postMessage(archive.prepare(workerData.meetingId));
} catch (error) {
  parentPort.postMessage({
    error: error.message || "The meeting could not be exported.",
  });
} finally {
  try {
    store.db.exec("ROLLBACK");
  } catch {}
  store.close();
}
