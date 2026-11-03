import { writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { AppleFollowThrough } from "./apple-followthrough.mjs";
import { stageRestore, publishRestore } from "./library-restore.mjs";
import {
  previewAssistantInstall,
  installAssistant,
} from "./meeting-mcp-install.mjs";
export function createMeetingCommands({
  meetings,
  native,
  paths,
  controller,
  app,
  dialog,
  getWindow,
  dataDir,
  refreshStore = () => {},
}) {
  const apple = new AppleFollowThrough({
    meetings,
    native,
    resources: paths.resources,
  });
  let assistantPreview;
  return async (name, p = {}) => {
    if (meetings?.archiveOperation)
      throw new Error(
        "Wait for the restore to finish before changing the library.",
      );
    const window = getWindow(),
      id = p.meetingId || meetings?.selectedId;
    switch (name) {
      case "desktop.meeting.capabilities": {
        const value = await native.run("capabilities");
        controller.desktopState.native = value;
        controller.engine.emitState();
        return value;
      }
      case "desktop.meeting.assets": {
        if (controller.engine.status === "running")
          throw new Error("Pause before changing speech languages.");
        controller.desktopState.assetsProgress =
          "Downloading the selected language…";
        controller.engine.emitState();
        try {
          const result = await native.run(
            "assets",
            {
              language: controller.preferences.language || "en-US",
              download: p.download === true,
            },
            {
              timeout: 15 * 60000,
              onProgress: () => {
                controller.desktopState.assetsProgress =
                  "Installing local speech assets…";
                controller.engine.emitState();
              },
            },
          );
          controller.desktopState.native = await native.run("capabilities");
          return result;
        } finally {
          controller.desktopState.assetsProgress = "";
          controller.engine.emitState();
        }
      }
      case "desktop.meeting.calendar":
        return native.run("calendar");
      case "desktop.meeting.export": {
        const json = p.format === "json";
        const content = meetings.export(id, json ? "json" : "markdown");
        const result = await dialog.showSaveDialog(window, {
          title: "Export meeting",
          defaultPath: `callwise-${new Date().toISOString().slice(0, 10)}.${json ? "json" : "md"}`,
          filters: [
            {
              name: json ? "JSON" : "Markdown",
              extensions: [json ? "json" : "md"],
            },
          ],
        });
        if (result.canceled || !result.filePath) return { cancelled: true };
        writeFileSync(result.filePath, content, { mode: 0o600 });
        return { saved: true };
      }
      case "desktop.meeting.backup": {
        if (!meetings.store)
          throw new Error("Unlock the meeting library first.");
        const result = await dialog.showSaveDialog(window, {
          title: "Save encrypted meeting backup",
          defaultPath: "Callwise.cwbackup",
          filters: [
            { name: "Callwise encrypted backup", extensions: ["cwbackup"] },
          ],
        });
        if (result.canceled || !result.filePath) return { cancelled: true };
        // The worker holds a read snapshot for the whole backup; meeting deletes defer their WAL truncation
        // until it ends instead of blocking this thread. On a timeout, the partial file is removed here.
        if (meetings.archiveOperation)
          throw new Error(
            "Wait for the restore to finish before making a backup.",
          );
        const store = meetings.store,
          temp = `${result.filePath}.${randomUUID()}.tmp`;
        store.backupStarted();
        let saved;
        try {
          saved = await new Promise((resolve, reject) => {
            const worker = new Worker(
              new URL("./workers/archive-worker.mjs", import.meta.url),
              {
                workerData: {
                  directory: store.directory,
                  key: store.key,
                  keyId: store.keyId,
                  passphrase: p.passphrase,
                  file: result.filePath,
                  temp,
                },
              },
            );
            // Reject only once the worker is gone, so its read snapshot is released before backupFinished().
            const timer = setTimeout(() => {
              void worker.terminate().finally(() => {
                rmSync(temp, { force: true });
                reject(new Error("The backup took too long."));
              });
            }, 30 * 60000);
            worker.once("message", (value) => {
              clearTimeout(timer);
              value.error ? reject(new Error(value.error)) : resolve(value);
            });
            worker.once("error", () => {
              clearTimeout(timer);
              rmSync(temp, { force: true });
              reject(new Error("The backup could not be created."));
            });
          });
        } finally {
          store.backupFinished();
        }
        return { saved: true, missingAudio: saved.missingAudio || 0 };
      }
      case "desktop.meeting.restore": {
        if (
          p.confirm !== true ||
          !meetings.store ||
          ["running", "paused", "finishing"].includes(
            controller.engine.status,
          ) ||
          controller.connecting ||
          controller.drainJob ||
          meetings.store.backupReaders > 0 ||
          meetings.pendingWrites.size ||
          meetings.jobs.size ||
          meetings.finishingConsumers.size
        )
          throw new Error(
            "End the meeting and confirm restoring into an empty library first.",
          );
        if (!meetings.store.isEmpty())
          throw new Error(
            "Restore requires an empty library. Your meetings have not been changed.",
          );
        meetings.archiveOperation = {
          kind: "restore",
          phase: "Choose a backup",
        };
        meetings.emit("state");
        let staged;
        try {
          const result = await dialog.showOpenDialog(window, {
            title: "Restore encrypted meeting backup",
            properties: ["openFile"],
            filters: [
              { name: "Callwise encrypted backup", extensions: ["cwbackup"] },
            ],
          });
          if (result.canceled || !result.filePaths?.[0])
            return { cancelled: true };
          staged = await stageRestore(
            meetings.store,
            result.filePaths[0],
            p.passphrase,
            (progress) => {
              meetings.archiveOperation = { kind: "restore", ...progress };
              meetings.emit("state");
            },
            {
              reservedIds: [...meetings.memory.values()]
                .filter((v) => v.id === v.meetingId)
                .map((v) => v.id),
            },
          );
          meetings.archiveOperation = {
            kind: "restore",
            phase: "Opening restored library",
          };
          meetings.emit("state");
          meetings.search?.close();
          publishRestore(meetings.store, staged.stage);
          staged = null;
          refreshStore();
          return { restored: true };
        } finally {
          if (staged) rmSync(staged.stage, { recursive: true, force: true });
          meetings.archiveOperation = null;
          meetings.clearCache();
          meetings.emit("state");
        }
      }
      case "desktop.meeting.audio": {
        if (!meetings.store || !meetings.get("meetings", id))
          throw new Error("Recording unavailable.");
        const start = Number.isFinite(p.startMs) ? Math.max(0, p.startMs) : 0,
          end =
            start +
            Math.min(60000, Math.max(1000, Number(p.durationMs) || 30000));
        const chunks = meetings.store
          .all("audio_chunks", id)
          .filter((c) => !c.missing && c.startMs < end && c.endMs > start)
          .slice(0, 16);
        return {
          startMs: start,
          endMs: end,
          chunks: chunks.map((c) => ({
            id: c.id,
            channel: c.channel,
            startMs: c.startMs,
            endMs: c.endMs,
            audio: meetings.store.readAudio(id, c.id).toString("base64"),
          })),
        };
      }
      case "desktop.meeting.apple.preview":
        return apple.preview({ ...p, meetingId: id });
      case "desktop.meeting.apple.save":
        return apple.commit(p);
      case "desktop.meeting.assistant.preview":
        return (assistantPreview = previewAssistantInstall({
          target: p.target,
          executable: process.execPath,
          root: app.getAppPath(),
          packaged: app.isPackaged,
        }));
      case "desktop.meeting.assistant.install":
        if (
          !assistantPreview ||
          p.confirm !== true ||
          p.target !== assistantPreview.target
        )
          throw new Error(
            "Review the exact assistant configuration change first.",
          );
        return installAssistant(assistantPreview);
      case "desktop.meeting.coach":
        if (!controller.preferences.liveHelp)
          throw new Error("Enable optional live help first.");
        return { showCoach: true };
      default:
        throw new Error("Unknown meeting action.");
    }
  };
}
