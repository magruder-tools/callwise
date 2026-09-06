import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  desktopCapturer,
  dialog,
  shell,
  globalShortcut,
  systemPreferences,
} from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { readConfig } from "../core/config.mjs";
import { safeUrl } from "../core/context.mjs";
import { CallController } from "../core/controller.mjs";
import { CodexProvider } from "../providers/codex.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smoke = process.argv.includes("--smoke");
let win, controller, normalBounds;
const page = path.join(root, "ui", "index.html");
const trustedFrame = (frame) =>
  !!frame && frame.url.split("?")[0] === pathToFileURL(page).href;
// Electron 44 uses the CoreAudio tap path on recent macOS. The packaged Info.plist
// contains NSAudioCaptureUsageDescription. No invisibility or screen-share evasion.

async function boot() {
  await app.whenReady();
  const dataDir = app.getPath("userData");
  const workDir = path.join(dataDir, "codex-work");
  mkdirSync(workDir, { recursive: true });
  const config = smoke
    ? { fastModel: "gpt-5.6-luna", strategyModel: "gpt-6-astra" }
    : readConfig([
        path.join(root, ".env.local"),
        path.join(dataDir, ".env.local"),
      ]);
  controller = new CallController({
    config,
    demoOnly: smoke,
    codexProvider: smoke
      ? null
      : new CodexProvider({
          bin: config.codexBin,
          model: config.strategyModel,
          effort: config.codexEffort,
          cwd: workDir,
        }),
  });
  win = new BrowserWindow({
    width: 1250,
    height: 850,
    minWidth: 390,
    minHeight: 540,
    backgroundColor: "#101319",
    title: "Callwise",
    show: false,
    webPreferences: {
      preload: path.join(root, "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      offscreen: smoke,
      backgroundThrottling: !smoke,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url.split("?")[0] !== pathToFileURL(page).href) event.preventDefault();
  });
  win.webContents.on("render-process-gone", () => {
    controller.stopInputs();
    controller.engine.pause();
  });
  win.on("closed", () => {
    controller.close();
    win = null;
  });
  win.once("ready-to-show", () => {
    if (!smoke) win.show();
  });

  session.defaultSession.setPermissionRequestHandler(
    (wc, permission, callback, details) => {
      callback(
        wc === win?.webContents &&
          trustedFrame(wc.mainFrame) &&
          controller.engine.status === "running" &&
          controller.mode === "audio" &&
          (permission === "display-capture" ||
            (permission === "media" &&
              !(details?.mediaTypes || []).includes("video"))),
      );
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission) =>
      wc === win?.webContents &&
      trustedFrame(wc.mainFrame) &&
      controller.mode === "audio" &&
      controller.engine.status === "running" &&
      ["media", "display-capture"].includes(permission),
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (
        !trustedFrame(request.frame) ||
        controller.mode !== "audio" ||
        controller.engine.status !== "running"
      ) {
        callback({});
        return;
      }
      try {
        const screens = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (!screens.length) {
          callback({});
          return;
        }
        // The native picker takes precedence when available. This fallback handles
        // audio loopback only; the renderer never reads or transmits video frames.
        callback({ video: screens[0], audio: "loopback" });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );

  const send = (name, data) => {
    if (win && !win.isDestroyed()) win.webContents.send(name, data);
  };
  controller.on("state", (state) => send("callwise:state", state));
  controller.on("stop-capture", () => send("callwise:stop-capture"));

  ipcMain.handle("callwise:command", async (event, name, payload = {}) => {
    if (event.sender !== win?.webContents || !trustedFrame(event.senderFrame))
      throw new Error("Untrusted app frame.");
    if (typeof name !== "string" || JSON.stringify(payload).length > 300000)
      throw new Error("Invalid request.");
    if (name === "desktop.compact") {
      if (payload.enabled) {
        normalBounds = win.getBounds();
        win.setMinimumSize(390, 540);
        win.setSize(440, 720);
        win.setAlwaysOnTop(true, "floating");
      } else {
        win.setAlwaysOnTop(false);
        if (normalBounds) win.setBounds(normalBounds);
      }
      return { compact: !!payload.enabled };
    }
    if (name === "desktop.openLink") {
      const url = safeUrl(payload.url);
      if (url) await shell.openExternal(url);
      return {};
    }
    if (name === "desktop.permissions")
      return {
        platform: process.platform,
        microphone:
          process.platform === "darwin"
            ? systemPreferences.getMediaAccessStatus("microphone")
            : "check in system settings",
        screen:
          process.platform === "darwin"
            ? systemPreferences.getMediaAccessStatus("screen")
            : "check in system settings",
        audio: "Verify both meters during a practice call.",
      };
    if (name === "desktop.import") {
      const result = await dialog.showOpenDialog(win, {
        title: "Add meeting context",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Text and transcripts",
            extensions: ["md", "txt", "json", "vtt", "srt", "csv"],
          },
        ],
      });
      if (result.canceled) return { imported: 0 };
      let count = 0;
      for (const filename of result.filePaths.slice(0, 20)) {
        if (statSync(filename).size > 250000)
          throw new Error(
            `${path.basename(filename)} is too large. Use an excerpt below 250 KB.`,
          );
        controller.engine.context.add({
          title: path.basename(filename),
          text: readFileSync(filename, "utf8"),
          kind: "document",
          project: controller.engine.settings.project,
        });
        count++;
      }
      controller.engine.emitState();
      return { imported: count };
    }
    if (name === "desktop.export") {
      const result = await dialog.showSaveDialog(win, {
        title: "Save session",
        defaultPath: `callwise-${new Date().toISOString().slice(0, 10)}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled) return { saved: false };
      writeFileSync(result.filePath, controller.engine.exportMarkdown(), {
        mode: 0o600,
      });
      return { saved: true };
    }
    return controller.command(name, payload);
  });
  ipcMain.on("callwise:audio", (event, channel, buffer) => {
    if (
      event.sender !== win?.webContents ||
      !trustedFrame(event.senderFrame) ||
      !["mic", "system"].includes(channel) ||
      !(buffer instanceof ArrayBuffer) ||
      buffer.byteLength > 19200
    )
      return;
    controller.audio(channel, Buffer.from(buffer));
  });
  ipcMain.on("callwise:capture-status", (event, channel, status) => {
    if (event.sender === win?.webContents && trustedFrame(event.senderFrame))
      controller.captureStatus(channel, status);
  });

  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (controller.engine.status === "running")
      void controller
        .command("nudge")
        .catch((e) => controller.engine.error(e.message));
  });
  globalShortcut.register("CommandOrControl+Shift+P", () => {
    void controller.command("pause");
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    controller.close();
  });
  app.on("window-all-closed", () => app.quit());
  await win.loadFile(page);
  if (smoke) {
    const artifacts = path.join(root, "artifacts");
    mkdirSync(artifacts, { recursive: true });
    const { DEMO_TRANSCRIPT } = await import("../fixtures/demo.mjs");
    await controller.command("start", { source: "demo" });
    for (let i = 0; i < 3; i++)
      controller.engine.ingest({
        ...DEMO_TRANSCRIPT[i],
        id: `demo:${i}`,
        startMs: DEMO_TRANSCRIPT[i].at,
        final: true,
      });
    await Promise.all([
      controller.engine.run("fast"),
      controller.engine.run("strategy"),
    ]);
    // Allow the renderer to paint the state emitted by the real controller.
    await new Promise((resolve) => setTimeout(resolve, 800));
    writeFileSync(
      path.join(artifacts, "desktop-preview.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    win.setSize(440, 720);
    await new Promise((resolve) => setTimeout(resolve, 500));
    writeFileSync(
      path.join(artifacts, "narrow-preview.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    console.log(
      "Desktop smoke completed: two coaching lanes and source-linked demo cards rendered.",
    );
    app.quit();
  }
}
void boot().catch((error) => {
  console.error(`Callwise startup failed: ${error.message}`);
  app.exit(1);
});
