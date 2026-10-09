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
  screen,
} from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  rmSync,
} from "node:fs";
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
import { execFile } from "node:child_process";
import { readSheets, saveSheets } from "../core/call-sheets.mjs";
import { recapMarkdown } from "../core/preparation.mjs";
import { runSelfTest } from "./self-test.mjs";
import { LiveTranscriber, pcmRms } from "../providers/transcription.mjs";
import { readReadiness, saveReadiness, keySignature } from "./readiness.mjs";
import { checkForUpdate } from "./updates.mjs";
import { importFiles, extractFile } from "./import-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smoke = process.argv.includes("--smoke");
if (smoke)
  setTimeout(() => {
    console.error("Desktop smoke timed out after 60 seconds.");
    app.exit(1);
  }, 60_000).unref();
let win, panel, controller, soundCheck, soundTimer;
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
  const sheetsFile = path.join(dataDir, "calls.bin"),
    readinessFile = path.join(dataDir, "readiness.bin");
  let sheets = [],
    readiness = smoke ? {} : readReadiness(readinessFile, safeStorage),
    devices = [];
  if (!smoke)
    try {
      sheets = readSheets(sheetsFile, safeStorage);
    } catch (error) {
      console.warn("Saved calls could not be loaded.");
    }
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
      sheets,
      onSheets: smoke
        ? () => {}
        : (next) => {
            saveSheets(sheetsFile, safeStorage, next);
            sheets = next;
          },
      diagnostics: (event, fields) => diagnostics.write(event, fields),
      onPreferences: smoke
        ? () => {}
        : (next) => {
            savePreferences(preferencesFile, safeStorage, next);
            preferences = next;
          },
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
    width: 780,
    height: 740,
    minWidth: 580,
    minHeight: 480,
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
      backgroundThrottling: false,
    },
  });
  const selectedDisplay = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    ),
    area = selectedDisplay.workArea;
  const bounds = controller.preferences.panelBounds?.[
    String(selectedDisplay.id)
  ] || {
    width: 440,
    height: 320,
    x: area.x + area.width - 464,
    y: area.y + 40,
  };
  bounds.width = Math.min(640, Math.max(340, bounds.width));
  bounds.height = Math.max(320, Math.min(area.height, bounds.height));
  bounds.x = Math.min(
    area.x + area.width - bounds.width,
    Math.max(area.x, bounds.x),
  );
  bounds.y = Math.min(
    area.y + area.height - bounds.height,
    Math.max(area.y, bounds.y),
  );
  panel = new BrowserWindow({
    ...bounds,
    minWidth: 340,
    maxWidth: 640,
    minHeight: 320,
    frame: false,
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    title: "Callwise live",
    show: false,
    backgroundColor: "#101319",
    webPreferences: {
      preload: path.join(root, "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  panel.setAlwaysOnTop(controller.preferences.floatPanel !== false, "floating");
  if (process.platform === "darwin")
    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  let boundsTimer;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (smoke || !panel || panel.isDestroyed()) return;
      const b = panel.getBounds(),
        d = screen.getDisplayMatching(b);
      controller.rememberPreferences({
        panelBounds: {
          ...controller.preferences.panelBounds,
          [String(d.id)]: b,
        },
      });
    }, 350);
  };
  panel.on("move", saveBounds);
  panel.on("resize", saveBounds);
  panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  panel.webContents.on("will-navigate", (event, url) => {
    if (url.split("?")[0] !== pathToFileURL(page).href) event.preventDefault();
  });
  panel.webContents.on("render-process-gone", () => {
    controller.stopInputs();
    controller.engine.pause();
    win?.show();
  });
  panel.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      panel.hide();
      if (controller.engine.status === "running")
        void controller.command("pause");
    }
  });
  const refreshDesktop = () => {
    const microphone =
      process.platform === "darwin"
        ? systemPreferences.getMediaAccessStatus("microphone")
        : "unknown";
    const screenStatus =
      process.platform === "darwin"
        ? systemPreferences.getMediaAccessStatus("screen")
        : "unknown";
    controller.desktopState = {
      ...controller.desktopState,
      packaged: app.isPackaged,
      platform: process.platform,
      version: app.getVersion(),
      permissions: { microphone, screen: screenStatus },
      readiness: {
        ai:
          !!controller.config.openaiKey &&
          readiness.aiSignature === keySignature(controller.config),
        mic:
          microphone === "granted" &&
          (!controller.preferences.inputDevice ||
            devices.includes(controller.preferences.inputDevice)),
        system: readiness.system === true && screenStatus !== "denied",
      },
    };
  };
  refreshDesktop();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url.split("?")[0] !== pathToFileURL(page).href) event.preventDefault();
  });
  win.webContents.on("render-process-gone", () => {
    controller.stopInputs();
    controller.engine.pause();
  });
  win.on("closed", () => {
    app.isQuitting = true;
    codexLogin.close();
    controller.close();
    panel?.destroy();
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
          (soundCheck ||
            (controller.engine.status === "running" &&
              controller.mode === "audio")) &&
          (permission === "display-capture" ||
            (permission === "media" &&
              !(details?.mediaTypes || []).includes("video"))),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission) =>
      wc === win?.webContents &&
      trustedFrame(wc.mainFrame) &&
      (soundCheck ||
        (controller.mode === "audio" &&
          controller.engine.status === "running")) &&
      ["media", "display-capture"].includes(permission),
  );
  installDisplayCapture(
    session.defaultSession,
    desktopCapturer,
    (frame) =>
      trustedFrame(frame) &&
      (soundCheck ||
        (controller.mode === "audio" &&
          controller.engine.status === "running")),
  );
  const send = (name, data) => {
    for (const target of [win, panel])
      if (target && !target.isDestroyed()) target.webContents.send(name, data);
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
        if (panel?.isVisible()) panel.hide();
        else panel?.showInactive();
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
  let windowStatus = "idle";
  controller.on("state", (state) => {
    if (app.isQuitting) return;
    refreshDesktop();
    send("callwise:state", { ...state, desktop: controller.desktopState });
    shortcuts.configure?.(state.preferences.hotkeys);
    shortcuts.sync(state.status);
    panel?.setAlwaysOnTop(state.preferences.floatPanel !== false, "floating");
    if (state.status !== windowStatus) {
      if (state.status === "running" && !smoke) {
        win.hide();
        panel.showInactive();
      }
      if (state.status === "ended") {
        panel.hide();
        if (!smoke) win.showInactive();
      }
      if (state.status === "idle" && !smoke) {
        panel.hide();
        win.showInactive();
      }
      windowStatus = state.status;
    }
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
    if (
      ![win?.webContents, panel?.webContents].includes(event.sender) ||
      !trustedFrame(event.senderFrame)
    )
      throw new Error("Untrusted app frame.");
    if (typeof name !== "string" || JSON.stringify(payload).length > 2200000)
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
    if (name === "desktop.connections.test") {
      if (smoke || controller.engine.status === "running")
        throw new Error("Pause the call before testing AI.");
      const results = await runSelfTest(controller.config);
      readiness.aiSignature =
        results.length === 4 && results.every((r) => r.ok)
          ? keySignature(controller.config)
          : "";
      saveReadiness(readinessFile, safeStorage, readiness);
      refreshDesktop();
      controller.engine.emitState();
      return results;
    }
    if (name === "desktop.capture.retry") {
      if (controller.engine.status !== "running" || controller.mode !== "audio")
        throw new Error("Start listening first.");
      if ([...controller.transcribers.values()].some((t) => t.stopped)) {
        await controller.command("pause");
        await controller.command("start", {
          source: "audio",
          consent: true,
          backend: controller.strategyBackend,
        });
      } else
        for (const channel of ["mic", "system"])
          if (controller.captureInputs[channel] === "failed")
            win.webContents.send("callwise:navigate", { retryAudio: channel });
      return {};
    }
    if (name === "desktop.settings") {
      win.webContents.send("callwise:navigate", { screen: "settings" });
      win.show();
      win.focus();
      return {};
    }
    if (name === "desktop.settings.close") {
      if (["running", "paused"].includes(controller.engine.status)) {
        win.hide();
        panel.showInactive();
      }
      return {};
    }
    if (name === "desktop.panel.fit") {
      if (
        event.sender === panel.webContents &&
        Number.isFinite(payload.height) &&
        payload.height >= 320 &&
        payload.height <= 1000
      ) {
        const b = panel.getBounds(),
          area = screen.getDisplayMatching(b).workArea,
          h = Math.min(payload.height, area.height - 24);
        if (Math.abs(b.height - h) > 2)
          panel.setBounds({
            height: h,
            y: Math.min(b.y, area.y + area.height - h),
          });
      }
      return {};
    }
    if (name === "desktop.copy") {
      if (typeof payload.text !== "string" || payload.text.length > 2200000)
        throw new Error("Invalid copy request.");
      clipboard.writeText(payload.text);
      return { copied: true };
    }
    if (name === "desktop.devices") {
      if (Array.isArray(payload.ids))
        devices = payload.ids
          .filter((id) => typeof id === "string" && id.length <= 300)
          .slice(0, 100);
      refreshDesktop();
      return controller.desktopState;
    }
    if (name === "desktop.mic.permission") {
      if (controller.engine.status === "running")
        throw new Error("Pause the call first.");
      if (process.platform === "darwin")
        await systemPreferences.askForMediaAccess("microphone");
      refreshDesktop();
      controller.engine.emitState();
      return controller.desktopState;
    }
    if (name === "desktop.permissions.open") {
      const pane =
        payload.pane === "mic" ? "Privacy_Microphone" : "Privacy_ScreenCapture";
      if (process.platform === "darwin")
        await shell.openExternal(
          `x-apple.systempreferences:com.apple.preference.security?${pane}`,
        );
      return {};
    }
    if (name === "desktop.sound.begin") {
      if (
        smoke ||
        controller.engine.status === "running" ||
        controller.connecting ||
        event.sender !== win.webContents
      )
        throw new Error("Pause the call before a sound check.");
      if (!["mic", "system"].includes(payload.channel))
        throw new Error("Choose an audio channel.");
      if (!controller.config.openaiKey)
        throw new Error("Save and test your OpenAI key first.");
      endSound(false);
      const channel = payload.channel;
      const transcriber = new LiveTranscriber({
        apiKey: controller.config.openaiKey,
        model: controller.config.transcriptionModel,
        channel,
        onSegment: (row) => {
          if (!soundCheck || soundCheck.transcriber !== transcriber) return;
          controller.desktopState.testText = row.text;
          controller.engine.emitState();
        },
        onStatus: () => {},
      });
      soundCheck = { channel, transcriber, level: 0 };
      controller.desktopState.testText = "";
      controller.desktopState.soundResult = "Listening for the test phrase…";
      try {
        await transcriber.connect();
      } catch (error) {
        endSound(false);
        throw error;
      }
      soundTimer = setTimeout(() => endSound(true), 20000);
      return {};
    }
    if (name === "desktop.sound.play") {
      if (soundCheck?.channel !== "system")
        throw new Error("Start the call-audio check first.");
      await new Promise((resolve, reject) =>
        execFile(
          "/usr/bin/say",
          ["Callwise is ready for my call."],
          { timeout: 10000 },
          (error) =>
            error
              ? reject(
                  new Error(
                    "The test phrase couldn't play. Check your output volume.",
                  ),
                )
              : resolve(),
        ),
      );
      return {};
    }
    if (name === "desktop.sound.end") {
      endSound(true);
      return controller.desktopState;
    }
    if (name === "desktop.delete") {
      if (controller.engine.status === "running" || controller.connecting)
        throw new Error("End the call before deleting data.");
      endSound(false);
      controller.cancelDocuments();
      controller.close();
      for (const file of [
        vault,
        preferencesFile,
        sheetsFile,
        readinessFile,
        path.join(dataDir, ".env.local"),
      ])
        if (existsSync(file)) unlinkSync(file);
      rmSync(path.join(dataDir, "logs"), { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
      baseConfig.openaiKey = baseConfig.firefliesKey = baseConfig.mcpToken = "";
      saved = {};
      preferences = {};
      sheets = [];
      readiness = {};
      controller.preferences = {};
      controller.sheets = [];
      controller.config = {
        ...baseConfig,
        openaiKey: "",
        firefliesKey: "",
        mcpToken: "",
      };
      controller.closing = false;
      controller.recap = null;
      controller.engine.context.clear();
      controller.engine.reset();
      controller.setProviders();
      controller.mode = "demo";
      controller.demoStarted = false;
      controller.engine.emitState();
      return controller.snapshot();
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
    if (name === "desktop.profile.import") {
      if (controller.engine.status === "running")
        throw new Error("End the call before changing your profile.");
      const result = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [{ name: "Résumé", extensions: ["pdf", "docx", "txt", "md"] }],
      });
      if (!result.canceled) {
        const text = await extractFile(result.filePaths[0]);
        await controller.command("configure", { profile: text.slice(0, 6000) });
      }
      return controller.snapshot();
    }
    if (name === "desktop.import") {
      if (controller.engine.status === "running")
        throw new Error("End the call before changing materials.");
      const result = payload.paths
        ? {
            canceled: false,
            filePaths: Array.isArray(payload.paths)
              ? payload.paths
                  .filter(
                    (p) =>
                      typeof p === "string" &&
                      p.length < 4096 &&
                      path.isAbsolute(p),
                  )
                  .slice(0, 20)
              : [],
          }
        : await dialog.showOpenDialog(win, {
            title: "Add meeting context",
            properties: ["openFile", "multiSelections"],
            filters: [
              {
                name: "Text and transcripts",
                extensions: [
                  "pdf",
                  "docx",
                  "md",
                  "txt",
                  "json",
                  "vtt",
                  "srt",
                  "csv",
                ],
              },
            ],
          });
      if (result.canceled) return { imported: 0 };
      const imported = await importFiles(
        result.filePaths,
        controller.engine.context,
        controller.engine.settings.project,
      );
      controller.materialsChanged();
      return imported;
    }
    if (name === "desktop.export") {
      const result = await dialog.showSaveDialog(win, {
        title: "Save session",
        defaultPath: `callwise-${new Date().toISOString().slice(0, 10)}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled) return { saved: false };
      writeFileSync(
        result.filePath,
        recapMarkdown(controller.recap) +
          "\n\n" +
          controller.engine.exportMarkdown(),
        {
          mode: 0o600,
        },
      );
      return { saved: true };
    }
    if (["start", "pause", "end", "new"].includes(name)) endSound(false);
    return controller.command(name, payload);
  });
  ipcMain.on("callwise:audio", (event, channel, buffer) => {
    if (
      event.sender === win?.webContents &&
      trustedFrame(event.senderFrame) &&
      ["mic", "system"].includes(channel) &&
      buffer instanceof ArrayBuffer &&
      buffer.byteLength <= 19200
    ) {
      const data = Buffer.from(buffer);
      if (soundCheck?.channel === channel) {
        soundCheck.level = Math.max(soundCheck.level, pcmRms(data));
        soundCheck.transcriber.push(data, Date.now());
      } else controller.audio(channel, data);
    }
  });
  const endSound = (evaluate) => {
    clearTimeout(soundTimer);
    if (!soundCheck) return;
    const check = soundCheck;
    soundCheck = null;
    check.transcriber.close();
    send("callwise:stop-capture");
    if (evaluate) {
      const text = controller.desktopState.testText || "",
        passed =
          check.level > 0.004 &&
          /ready.*(?:call|my)/i.test(text) &&
          /callwise|call wise/i.test(text);
      readiness[check.channel] = passed;
      controller.desktopState.soundResult = passed
        ? `${check.channel === "mic" ? "Microphone" : "Call audio"} check passed.`
        : `${check.channel === "mic" ? "Microphone" : "Call audio"} check didn't hear the phrase. Check permissions and output volume, then try again.`;
      saveReadiness(readinessFile, safeStorage, readiness);
      refreshDesktop();
      controller.engine.emitState();
    }
  };
  ipcMain.on("callwise:meter", (event, channel, rms) => {
    if (
      event.sender === win?.webContents &&
      trustedFrame(event.senderFrame) &&
      ["mic", "system"].includes(channel) &&
      Number.isFinite(rms) &&
      rms >= 0 &&
      rms <= 1
    )
      send("callwise:meters", { channel, rms });
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
  app.on("before-quit", () => {
    app.isQuitting = true;
  });
  app.on("will-quit", () => {
    app.isQuitting = true;
    clearTimeout(soundTimer);
    soundCheck?.transcriber.close();
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
  await Promise.all([
    win.loadFile(page),
    panel.loadFile(page, { query: { surface: "panel" } }),
  ]);
  if (smoke) console.log("Smoke: main and live pages loaded.");
  if (!smoke)
    void checkForUpdate(app.getVersion()).then((update) => {
      controller.desktopState.update = update;
      controller.engine.emitState();
    });
  if (smoke) {
    // Native panels need a visible compositor surface for reliable capturePage.
    // These synthetic tests never initialize audio, permissions or credentials.
    panel.showInactive();
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
    console.log("Smoke: synthetic coaching requests completed.");
    await new Promise((r) => setTimeout(r, 800));
    writeFileSync(
      path.join(artifacts, "desktop-preview.png"),
      (await panel.webContents.capturePage()).toPNG(),
    );
    console.log("Smoke: default live screenshot captured.");
    panel.setSize(340, 400);
    await new Promise((r) => setTimeout(r, 500));
    writeFileSync(
      path.join(artifacts, "narrow-preview.png"),
      (await panel.webContents.capturePage()).toPNG(),
    );
    controller.engine.providers.fast = {
      generate: async () => ({
        speak: true,
        kind: "say",
        lead: "I'd start with the real example, explain my actions, and put the measured result in context.",
        points: [
          {
            label: "Situation",
            text: "The approved notes explain the starting point and the original constraint.",
          },
          {
            label: "Action",
            text: "I can describe the specific changes I made and why they mattered.",
          },
          {
            label: "Result",
            text: "I should use the actual numbers and clarify how they were measured.",
          },
        ],
        sourceIds: [],
        covers: [],
      }),
    };
    await controller.engine.run(
      "fast",
      "Give me an example answer for the sample call.",
    );
    for (const [name, width, height] of [
      ["live-340", 340, 520],
      ["live-440", 440, 440],
      ["live-640", 640, 380],
    ]) {
      console.log(`Smoke: checking ${name} layout.`);
      panel.setSize(width, height);
      await new Promise((r) => setTimeout(r, 300));
      const layout = await panel.webContents.executeJavaScript(`(() => {
        const lead=document.querySelector('.lead'),points=[...document.querySelectorAll('.points li')];
        const text=[lead,...points].filter(Boolean);
        return {lead:lead?.textContent,points:points.length,fontSizes:text.map(n=>parseFloat(getComputedStyle(n).fontSize)),clipped:text.filter(n=>{const r=n.getBoundingClientRect();return r.x<0||r.right>innerWidth+1||n.scrollHeight>n.clientHeight+1||r.bottom>innerHeight+1;}).length};
      })()`);
      if (
        !layout.lead ||
        layout.points !== 3 ||
        layout.clipped ||
        layout.fontSizes.some((size) => size < 12)
      )
        throw new Error(
          `Live layout failed at ${width}px: ${JSON.stringify(layout)}`,
        );
      writeFileSync(
        path.join(artifacts, `${name}.png`),
        (await panel.webContents.capturePage()).toPNG(),
      );
    }
    await controller.command("end");
    console.log("Smoke: automatic recap completed.");
    win.showInactive();
    await new Promise((r) => setTimeout(r, 350));
    writeFileSync(
      path.join(artifacts, "recap.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await controller.command("new", { clearContext: true });
    await new Promise((r) => setTimeout(r, 350));
    writeFileSync(
      path.join(artifacts, "ready.png"),
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
