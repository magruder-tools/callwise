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
  safeStorage,
  powerMonitor,
  Menu,
  clipboard,
} from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { release as osRelease } from "node:os";
import { readConfig } from "../core/config.mjs";
import {
  readConnections,
  saveConnections,
  checkModelAccess,
} from "../core/connections.mjs";
import { safeUrl } from "../core/context.mjs";
import { CallController } from "../core/controller.mjs";
import { CodexLogin } from "./codex-login.mjs";
import { installDisplayCapture } from "./display-capture.mjs";
import { readPreferences, savePreferences } from "../core/preferences.mjs";
import { CodexContextProvider } from "../providers/codex-context.mjs";
import { CodexProvider } from "../providers/codex.mjs";
import { Diagnostics } from "./diagnostics.mjs";
import { SessionShortcuts } from "./shortcuts.mjs";
import { importFiles } from "./import-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smoke = process.argv.includes("--smoke");
let win, controller;
const page = path.join(root, "ui", "index.html");
const trustedFrame = (frame) =>
  !!frame && frame.url.split("?")[0] === pathToFileURL(page).href;
const controllerConfig = (base, saved = {}) => ({ ...base, ...saved });
async function boot() {
  await app.whenReady();
  const dataDir = app.getPath("userData"),
    workDir = path.join(dataDir, "codex-work");
  mkdirSync(workDir, { recursive: true });
  const diagnostics = new Diagnostics(path.join(dataDir, "logs"), {
    versions: {
      app: app.getVersion(),
      os: `${process.platform} ${osRelease()}`,
      electron: process.versions.electron,
      node: process.versions.node,
    },
  });
  const vault = path.join(dataDir, "connections.bin");
  const preferencesFile = path.join(dataDir, "preferences.bin");
  let preferences = {},
    preferencesWarning = "";
  if (!smoke)
    try {
      preferences = readPreferences(preferencesFile, safeStorage);
    } catch (error) {
      preferencesWarning = error.message;
    }
  const baseConfig = smoke
    ? {
        fastModel: "gpt-5.6-luna",
        strategyModel: "gpt-6-astra",
        transcriptionModel: "gpt-live-transcribe",
      }
    : readConfig([
        path.join(root, ".env.local"),
        path.join(dataDir, ".env.local"),
      ]);
  let saved = {};
  let vaultWarning = "";
  if (!smoke)
    try {
      saved = readConnections(vault, safeStorage);
    } catch (error) {
      vaultWarning = error.message;
    }
  const makeController = (config) =>
    new CallController({
      config,
      preferences,
      diagnostics: (event, fields) => diagnostics.write(event, fields),
      onPreferences: smoke
        ? () => {}
        : (next) => savePreferences(preferencesFile, safeStorage, next),
      contextProvider: smoke
        ? null
        : new CodexContextProvider({
            bin: config.codexBin,
            model: config.strategyModel,
            cwd: workDir,
          }),
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
  controller = makeController(controllerConfig(baseConfig, saved));
  const codexLogin = new CodexLogin({
    bin: controller.config.codexBin,
    cwd: workDir,
    openBrowser: (url) => shell.openExternal(url),
  });
  if (vaultWarning) controller.engine.error(vaultWarning);
  if (preferencesWarning) controller.engine.error(preferencesWarning);
  win = new BrowserWindow({
    width: 740,
    height: 480,
    minWidth: 600,
    minHeight: 420,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 25 } }
      : {}),
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
      backgroundThrottling: false,
    },
  });
  if (controller.preferences.compact) {
    win.setAlwaysOnTop(true, "floating");
  }
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url.split("?")[0] !== pathToFileURL(page).href) event.preventDefault();
  });
  win.webContents.on("render-process-gone", () => {
    controller.stopInputs();
    controller.engine.pause();
  });
  win.on("closed", () => {
    codexLogin.close();
    controller.close();
    win = null;
  });
  win.once("ready-to-show", () => {
    if (!smoke) win.show();
  });
  session.defaultSession.setPermissionRequestHandler(
    (wc, permission, callback, details) =>
      callback(
        wc === win?.webContents &&
          trustedFrame(wc.mainFrame) &&
          controller.engine.status === "running" &&
          controller.mode === "audio" &&
          (permission === "display-capture" ||
            (permission === "media" &&
              !(details?.mediaTypes || []).includes("video"))),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission) =>
      wc === win?.webContents &&
      trustedFrame(wc.mainFrame) &&
      controller.mode === "audio" &&
      controller.engine.status === "running" &&
      ["media", "display-capture"].includes(permission),
  );
  installDisplayCapture(
    session.defaultSession,
    desktopCapturer,
    (frame) =>
      trustedFrame(frame) &&
      controller.mode === "audio" &&
      controller.engine.status === "running",
  );
  const send = (name, data) => {
    if (win && !win.isDestroyed()) win.webContents.send(name, data);
  };
  const shortcuts = new SessionShortcuts(
    globalShortcut,
    {
      help: () =>
        void controller
          .command("nudge")
          .catch((error) => controller.engine.error(error)),
      pause: () => void controller.command("pause"),
      previous: () => send("callwise:navigate", { direction: "previous" }),
      next: () => send("callwise:navigate", { direction: "next" }),
      visibility: () => {
        if (win?.isVisible()) win.hide();
        else win?.showInactive();
      },
    },
    (accelerator) =>
      controller.engine.error(
        `Another app is using ${accelerator}. Use the Callwise controls for now.`,
        { condition: `shortcut:${accelerator}`, lifetimeMs: null },
      ),
    (accelerator) =>
      controller.engine.clearErrors({ condition: `shortcut:${accelerator}` }),
  );
  controller.on("state", (state) => {
    send("callwise:state", state);
    shortcuts.sync(state.status);
    if (
      ["paused", "ended"].includes(state.status) &&
      win &&
      !win.isDestroyed() &&
      !win.isVisible()
    )
      win.showInactive();
  });
  const copyDiagnostics = () =>
    clipboard.writeText(
      diagnostics.copy({
        status: controller.engine.status,
        source: controller.mode,
        config: controller.config,
        preferences: controller.preferences,
      }),
    );
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      {
        label: "Help",
        submenu: [{ label: "Copy diagnostics", click: copyDiagnostics }],
      },
    ]),
  );
  controller.on("stop-capture", () => send("callwise:stop-capture"));
  ipcMain.handle("callwise:command", async (event, name, payload = {}) => {
    if (event.sender !== win?.webContents || !trustedFrame(event.senderFrame))
      throw new Error("Untrusted app frame.");
    if (typeof name !== "string" || JSON.stringify(payload).length > 300000)
      throw new Error("Invalid request.");
    if (name === "desktop.codex.signin") {
      if (
        smoke ||
        controller.engine.status === "running" ||
        controller.connecting
      )
        throw new Error("Pause the live session before signing into Codex.");
      return codexLogin.signIn();
    }
    if (name === "desktop.codex.cancel") {
      codexLogin.cancel();
      return {};
    }
    if (["pause", "end", "new"].includes(name)) codexLogin.cancel();
    if (name === "start" && codexLogin.busy)
      throw new Error("Finish or cancel Codex sign-in first.");
    if (name === "desktop.connections.save") {
      if (codexLogin.busy)
        throw new Error(
          "Finish or cancel Codex sign-in before changing connections.",
        );
      if (controller.engine.status === "running" || controller.connecting)
        throw new Error("Pause the session before changing connections.");
      saved = saveConnections(vault, safeStorage, payload);
      const next = controllerConfig(baseConfig, saved);
      controller.stopInputs();
      controller.config = next;
      controller.fireflies.apiKey = next.firefliesKey;
      controller.codex?.close();
      controller.codex = new CodexProvider({
        bin: next.codexBin,
        model: next.strategyModel,
        effort: next.codexEffort,
        cwd: workDir,
      });
      controller.contextProvider?.close();
      controller.contextProvider = new CodexContextProvider({
        bin: next.codexBin,
        model: next.strategyModel,
        cwd: workDir,
      });
      controller.retrieval.provider = controller.contextProvider;
      controller.contextApps = [];
      controller.retrieval.invalidate();
      controller.setProviders();
      controller.engine.emitState();
      return {
        saved: true,
        openaiReady: !!next.openaiKey,
        firefliesReady: !!next.firefliesKey,
        fastModel: next.fastModel,
        strategyModel: next.strategyModel,
        transcriptionModel: next.transcriptionModel,
      };
    }
    if (name === "desktop.connections.check")
      return checkModelAccess(controller.config);
    if (name === "desktop.diagnostics") {
      copyDiagnostics();
      return { copied: true };
    }
    if (name === "desktop.compact") {
      controller.rememberPreferences({ compact: !!payload.enabled });
      win.setAlwaysOnTop(!!payload.enabled, "floating");
      controller.engine.emitState();
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
      const imported = importFiles(
        result.filePaths,
        controller.engine.context,
        controller.engine.settings.project,
      );
      controller.engine.emitState();
      return imported;
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
      event.sender === win?.webContents &&
      trustedFrame(event.senderFrame) &&
      ["mic", "system"].includes(channel) &&
      buffer instanceof ArrayBuffer &&
      buffer.byteLength <= 19200
    )
      controller.audio(channel, Buffer.from(buffer));
  });
  ipcMain.on("callwise:capture-status", (event, channel, status) => {
    if (event.sender === win?.webContents && trustedFrame(event.senderFrame))
      controller.captureStatus(channel, status);
  });
  for (const event of ["suspend", "lock-screen"])
    powerMonitor.on(event, () => {
      codexLogin.cancel();
      if (controller.engine.status === "running") {
        controller.stopInputs();
        controller.engine.pause();
        controller.engine.error(
          "Callwise paused because this Mac slept or locked. Resume when you are ready.",
        );
      }
    });
  app.on("will-quit", () => {
    codexLogin.close();
    shortcuts.close();
    controller.close();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  await win.loadFile(page);
  if (smoke) {
    const artifacts =
      process.env.CALLWISE_SMOKE_DIR ||
      (app.isPackaged
        ? path.join(app.getPath("temp"), "callwise-smoke")
        : path.join(root, "artifacts"));
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
    await new Promise((r) => setTimeout(r, 800));
    writeFileSync(
      path.join(artifacts, "desktop-preview.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    win.setSize(600, 420);
    await new Promise((r) => setTimeout(r, 500));
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
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  void boot().catch((error) => {
    console.error(`Callwise startup failed: ${error.message}`);
    app.exit(1);
  });
}
