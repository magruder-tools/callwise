import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { AppleFollowThrough } from "./apple-followthrough.mjs";
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
}) {
  const apple = new AppleFollowThrough({
    meetings,
    native,
    resources: paths.resources,
  });
  let assistantPreview;
  return async (name, p = {}) => {
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
        await new Promise((resolve, reject) => {
          const worker = new Worker(
            new URL("./workers/archive-worker.mjs", import.meta.url),
            {
              workerData: {
                directory: meetings.store.directory,
                key: meetings.store.key,
                keyId: meetings.store.keyId,
                passphrase: p.passphrase,
                file: result.filePath,
              },
            },
          );
          const timer = setTimeout(() => {
            void worker.terminate();
            reject(new Error("The backup took too long."));
          }, 30 * 60000);
          worker.once("message", (value) => {
            clearTimeout(timer);
            value.error ? reject(new Error(value.error)) : resolve(value.saved);
          });
          worker.once("error", () => {
            clearTimeout(timer);
            reject(new Error("The backup could not be created."));
          });
        });
        return { saved: true };
      }
      case "desktop.meeting.restore": {
        if (
          p.confirm !== true ||
          !meetings.store ||
          ["running", "paused", "finishing"].includes(controller.engine.status)
        )
          throw new Error(
            "End the meeting and confirm restoring into an empty library first.",
          );
        const result = await dialog.showOpenDialog(window, {
          title: "Restore encrypted meeting backup",
          properties: ["openFile"],
          filters: [
            { name: "Callwise encrypted backup", extensions: ["cwbackup"] },
          ],
        });
        if (result.canceled) return { cancelled: true };
        meetings.store.restoreFile(result.filePaths[0], p.passphrase);
        meetings.clearCache();
        meetings.emit("state");
        return { restored: true };
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
