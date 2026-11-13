import electron from "electron";
const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  desktopCapturer,
  dialog,
  shell,
  globalShortcut,
  systemPreferences,
  powerMonitor,
  Menu,
  clipboard,
  screen,
  Tray,
  nativeImage,
} = electron;
import { createSecureStorage } from "./secure-storage.mjs";
// Do not construct Electron's Keychain-backed store for smoke tests or MCP
// discovery. The first real storage operation unlocks it, once per process.
const safeStorage = createSecureStorage(() => electron.safeStorage);
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { release as osRelease } from "node:os";
import { readConfig } from "../core/config.mjs";
import { saveConnections, readConnections } from "../core/connections.mjs";
import { readConnectionsWithMigration } from "../core/connection-migration.mjs";
import { sendToWindows, closeOnce } from "./lifecycle.mjs";
import { safeUrl } from "../core/context.mjs";
import { SnapshotStream } from "../core/snapshot-stream.mjs";
import { CallController } from "../core/controller.mjs";
import {
  startMeeting,
  speechNeedsRestart,
  removeUnopenedLibrary,
} from "./meeting-start.mjs";
import { CodexLogin } from "./codex-login.mjs";
import {
  installDisplayCapture,
  configureAudioBackend,
} from "./display-capture.mjs";
import { readPreferences, savePreferences } from "../core/preferences.mjs";
import { CodexContextProvider } from "../providers/codex-context.mjs";
import { CodexProvider } from "../providers/codex.mjs";
import { Diagnostics } from "./diagnostics.mjs";
import { SessionShortcuts } from "./shortcuts.mjs";
import { execFile } from "node:child_process";
import { Worker } from "node:worker_threads";
import { readSheets, saveSheets } from "../core/call-sheets.mjs";
import { recapMarkdown } from "../core/preparation.mjs";
import { runSelfTest } from "./self-test.mjs";
import { LiveTranscriber, pcmRms } from "../providers/transcription.mjs";
import { readReadiness, saveReadiness, keySignature } from "./readiness.mjs";
import {
  SOUND_CHECK_TIMES,
  SoundCheckTranscript,
  soundCheckPassed,
} from "../core/sound-check.mjs";
import { checkForUpdate } from "./updates.mjs";
import { importFiles, extractFile } from "./import-files.mjs";
import { MeetingStore } from "../core/meetings/store.mjs";
import { MeetingService } from "../core/meetings/service.mjs";
import { MeetingSearch } from "./meeting-search.mjs";
import { MeetingRecorder } from "./meeting-recorder.mjs";
import { MeetingDiarizer } from "./meeting-diarizer.mjs";
import { NativeServices, nativePaths } from "./native-host.mjs";
import { AppleSpeechSession } from "../providers/apple-speech.mjs";
import { createMeetingCommands } from "./meeting-commands.mjs";
import { recoverRestoreSwap } from "./library-restore.mjs";
import { retrySavedData } from "./storage-recovery.mjs";
import { FolderArchive } from "./folder-archive.mjs";
import { revealLibrary } from "./library-location.mjs";

const headlessMcp = process.argv.includes("--mcp-server");
if (!headlessMcp) configureAudioBackend(app.commandLine);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildMetadata = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const smoke = process.argv.includes("--smoke");
// Used at launch and after "Delete all": cloud help and assistant access stay off until the user turns them on.
const DEFAULT_PREFERENCES = Object.freeze({
  speechEngine: "apple",
  language: "en-US",
  liveHelp: false,
  retainAudio: false,
  meetingMcpEnabled: false,
  driveArchiveEnabled: false,
  iCloudArchiveEnabled: false,
  iCloudArchiveFolder: "",
  meetingRetentionDays: 0,
  audioRetentionDays: 30,
  includePreviewUpdates: buildMetadata.releaseChannel === "preview",
});
function reportFailure(message) {
  console.error(message);
  if (smoke && process.env.GITHUB_ACTIONS === "true")
    console.error(
      `::error title=Callwise desktop smoke::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
    );
}
if (smoke) {
  const smokeData = path.join(
    app.getPath("temp"),
    `callwise-native-smoke-${process.pid}`,
  );
  mkdirSync(smokeData, { recursive: true, mode: 0o700 });
  app.setPath("userData", smokeData);
  setTimeout(() => {
    reportFailure("Desktop smoke timed out after 60 seconds.");
    app.exit(1);
  }, 60_000).unref();
}
let win, panel, controller, soundCheck, soundTimer, tray;
const page = path.join(root, "ui", "index.html");
const trustedFrame = (frame) =>
  !!frame && frame.url.split("?")[0] === pathToFileURL(page).href;
const controllerConfig = (base, saved = {}) => ({ ...base, ...saved });
async function boot() {
  await app.whenReady();
  const dataDir = app.getPath("userData"),
    workDir = path.join(dataDir, "codex-work");
  mkdirSync(workDir, { recursive: true });
  const paths = nativePaths({
    root,
    packaged: app.isPackaged,
    executable: process.execPath,
    resourcesPath: process.resourcesPath,
  });
  const native = new NativeServices(paths);
  let meetingStore = null,
    libraryWarning = "";
  if (!smoke)
    try {
      recoverRestoreSwap(path.join(dataDir, "meetings"));
      meetingStore = new MeetingStore(path.join(dataDir, "meetings"), {
        storage: safeStorage,
      });
    } catch (error) {
      libraryWarning = error.message;
    }
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
  preferences = { ...DEFAULT_PREFERENCES, ...preferences };
  // The previous preview's external AI uploader is retired. New iCloud
  // exports are opt-in and use the folder explicitly chosen in Settings.
  preferences.driveArchiveEnabled = false;
  if (meetingStore)
    meetingStore.prune({
      meetingDays: preferences.meetingRetentionDays,
      audioDays: preferences.audioRetentionDays,
    });
  let speechSession;
  const baseConfig = smoke
    ? {
        fastModel: "gpt-6-luna",
        strategyModel: "gpt-6.1-sol",
        transcriptionModel: "gpt-live-transcribe",
      }
    : app.isPackaged
      ? readConfig([], { environment: {} })
      : readConfig([
          path.join(root, ".env.local"),
          path.join(dataDir, ".env.local"),
        ]);
  let saved = {};
  let vaultWarning = "";
  let updateSequence = 0;
  async function refreshUpdates(
    includePreview = controller.preferences.includePreviewUpdates,
  ) {
    const sequence = ++updateSequence;
    controller.desktopState.updateChecking = true;
    controller.engine.emitState();
    const update = await checkForUpdate(app.getVersion(), {
      includePreview: includePreview === true,
    });
    if (sequence === updateSequence) {
      controller.desktopState.update = update;
      controller.desktopState.updateChecking = false;
      controller.engine.emitState();
    }
    return update;
  }
  if (!smoke)
    try {
      saved = readConnectionsWithMigration(dataDir, safeStorage);
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
      speechFactory: smoke
        ? null
        : (options) => {
            if (controller.preferences.speechEngine === "openai")
              return new LiveTranscriber(options);
            if (
              !speechSession ||
              speechSession.stopped ||
              speechSession.captureEpoch !== options.captureEpoch
            ) {
              speechSession?.close();
              speechSession = new AppleSpeechSession({
                ...paths,
                language: controller.preferences.language || "en-US",
                hints: options.keywords,
                epoch: options.captureEpoch,
              });
              speechSession.captureEpoch = options.captureEpoch;
            }
            return speechSession.adapter(options);
          },
      onPreferences: smoke
        ? () => {}
        : (next) => {
            savePreferences(preferencesFile, safeStorage, next);
            preferences = next;
            if (
              controller &&
              next.includePreviewUpdates !==
                controller.preferences.includePreviewUpdates
            )
              void refreshUpdates(next.includePreviewUpdates);
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
  controller.libraryPath = path.join(dataDir, "meetings");
  function applyConnections(value) {
    const next = controllerConfig(baseConfig, value);
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
    return next;
  }
  const meetings = smoke
    ? null
    : new MeetingService({
        store: meetingStore,
        native,
        search: meetingStore ? new MeetingSearch(meetingStore) : null,
        recorder: new MeetingRecorder(),
        diarizer: new MeetingDiarizer(paths),
      });
  if (meetings) {
    meetings.warning = libraryWarning;
    controller.meetingService = meetings;
    meetings.attach(controller);
    meetings.migrateSheets(sheets);
  }
  const folderArchive = meetings
    ? new FolderArchive({
        meetings,
        native,
        directory: path.join(dataDir, "folder-archive-jobs"),
        prepareJob: async (meetingId, stage, signal) => {
          const store = meetings.store;
          if (!store || signal.aborted) throw new Error("Export cancelled.");
          store.backupStarted();
          try {
            return await new Promise((resolve, reject) => {
              const worker = new Worker(
                new URL("./workers/folder-export-worker.mjs", import.meta.url),
                {
                  workerData: {
                    directory: store.directory,
                    key: store.key,
                    keyId: store.keyId,
                    meetingId,
                    stage,
                  },
                },
              );
              let replied = false;
              const stop = () =>
                void worker
                  .terminate()
                  .finally(() => reject(new Error("Export cancelled.")));
              signal.addEventListener("abort", stop, { once: true });
              const timer = setTimeout(stop, 10 * 60000);
              const clean = () => {
                clearTimeout(timer);
                signal.removeEventListener("abort", stop);
              };
              worker.once("message", (value) => {
                replied = true;
                clean();
                value.error
                  ? reject(new Error(value.error))
                  : resolve(value.result);
              });
              worker.once("error", () => {
                clean();
                reject(new Error("Meeting export could not finish."));
              });
              worker.once("exit", (code) => {
                clean();
                if (code !== 0 || !replied)
                  reject(new Error("Meeting export stopped."));
              });
            });
          } finally {
            store.backupFinished();
          }
        },
      })
    : null;
  folderArchive?.on("status", (value) => {
    controller.desktopState.folderArchive = value;
    controller.engine.emitState();
  });
  setImmediate(() => folderArchive?.resume());
  powerMonitor.on("resume", () => folderArchive?.resume());
  app.on("will-quit", () => folderArchive?.close());
  const meetingCommands = createMeetingCommands({
    meetings,
    native,
    paths,
    controller,
    app,
    dialog,
    getWindow: () => win,
    dataDir,
    storage: safeStorage,
    refreshStore: () => {
      meetings.search?.close();
      meetings.search = new MeetingSearch(meetings.store);
      meetings.clearCache();
    },
  });
  const codexLogin = new CodexLogin({
    bin: controller.config.codexBin,
    cwd: workDir,
    openBrowser: (url) => shell.openExternal(url),
  });
  if (vaultWarning) controller.engine.error(vaultWarning);
  if (preferencesWarning) controller.engine.error(preferencesWarning);
  win = new BrowserWindow({
    width: smoke ? 720 : 980,
    height: smoke ? 560 : 700,
    minWidth: smoke ? 580 : 640,
    minHeight: smoke ? 480 : 520,
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
    height: 232,
    x: area.x + area.width - 464,
    y: area.y + 40,
  };
  bounds.width = Math.min(640, Math.max(340, bounds.width));
  bounds.height = 232;
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
    minHeight: 232,
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
    if (app.isQuitting) return;
    controller.stopInputs();
    controller.engine.pause();
    win?.show();
  });
  panel.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      panel.hide();
    }
  });
  win.on("close", (event) => {
    if (
      !app.isQuitting &&
      ["running", "paused", "finishing"].includes(controller.engine.status)
    ) {
      event.preventDefault();
      win.hide();
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
      storageBlocked: safeStorage.blocked,
      packaged: app.isPackaged,
      platform: process.platform,
      version: app.getVersion(),
      permissions: { microphone, screen: screenStatus },
      readiness: {
        core: !!controller.desktopState?.native?.speech,
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
    if (app.isQuitting) return;
    controller.stopInputs();
    controller.engine.pause();
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
  const send = (name, data) => sendToWindows([win, panel], name, data);
  const shortcuts = new SessionShortcuts(
    globalShortcut,
    {
      help: () =>
        void (
          controller.engine.status === "paused"
            ? controller.command("start", {
                source: controller.mode,
                backend: controller.strategyBackend,
                consent: true,
              })
            : Promise.resolve()
        )
          .then(() => controller.command("nudge"))
          .catch((error) => controller.engine.error(error)),
      pause: () =>
        void controller
          .command(
            controller.engine.status === "paused" ? "start" : "pause",
            controller.engine.status === "paused"
              ? {
                  source: controller.mode,
                  backend: controller.strategyBackend,
                  consent: true,
                }
              : {},
          )
          .catch((error) => controller.engine.error(error)),
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
  const snapshots = new SnapshotStream();
  const shutdown = closeOnce(() => {
    app.isQuitting = true;
    clearTimeout(soundTimer);
    soundCheck?.transcriber.close();
    soundCheck = null;
    codexLogin.close();
    shortcuts.close();
    controller.close();
    meetings?.close();
    native.close();
    tray?.destroy();
  });
  win.on("closed", () => {
    win = null;
    shutdown();
    if (panel && !panel.isDestroyed()) panel.destroy();
    panel = null;
  });
  let windowStatus = "idle";
  controller.on("state", (state) => {
    if (app.isQuitting) return;
    if (meetings) state = { ...state, meetings: meetings.snapshot() };
    refreshDesktop();
    send(
      "callwise:state",
      snapshots.pack({ ...state, desktop: controller.desktopState }),
    );
    shortcuts.configure?.(state.preferences.hotkeys);
    shortcuts.sync(state.status);
    panel?.setAlwaysOnTop(state.preferences.floatPanel !== false, "floating");
    if (state.status !== windowStatus) {
      if (state.status === "running" && !smoke) {
        win.showInactive();
        // Live coaching is part of the main meeting window. The floating panel is explicit.
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
    if (!smoke && ["running", "paused", "finishing"].includes(state.status)) {
      if (!tray) {
        const image = nativeImage.createFromBuffer(
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="6" fill="black"/></svg>',
          ),
        );
        image.setTemplateImage(true);
        tray = new Tray(image);
        tray.on("click", () => win?.show());
      }
      tray.setToolTip(
        [
          `Callwise — ${state.status}`,
          ...(state.meetings?.processing || []),
        ].join(" · "),
      );
      tray.setContextMenu(
        Menu.buildFromTemplate([
          ...(state.meetings?.processing || []).map((label) => ({
            label,
            enabled: false,
          })),
          { type: "separator" },
          { label: "Open meeting", click: () => win?.show() },
          {
            label: state.status === "paused" ? "Resume" : "Pause",
            // After an objection, capture can't resume from the menu bar either.
            enabled:
              state.status !== "finishing" &&
              !(state.status === "paused" && meetings?.resumeBlocked()),
            click: () =>
              void controller
                .command(state.status === "paused" ? "start" : "pause", {
                  source: controller.mode,
                  consent: true,
                  backend: controller.strategyBackend,
                })
                .catch((e) => controller.engine.error(e)),
          },
          { label: "End meeting", click: () => void controller.command("end") },
        ]),
      );
    } else if (tray) {
      tray.destroy();
      tray = null;
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
    if (name === "library.reveal")
      return revealLibrary(controller.libraryPath, shell);
    if (name === "desktop.updates.check") return refreshUpdates();
    if (name === "desktop.storage.unlock" && meetings) {
      if (codexLogin.busy) throw new Error("Finish or cancel sign-in first.");
      return retrySavedData({
        storage: safeStorage,
        meetings,
        controller,
        openStore: () => {
          recoverRestoreSwap(path.join(dataDir, "meetings"));
          return new MeetingStore(path.join(dataDir, "meetings"), {
            storage: safeStorage,
          });
        },
        installStore: (store) => {
          meetingStore = meetings.store = store;
          meetings.search?.close();
          meetings.search = new MeetingSearch(store);
          meetings.warning = "";
        },
        load: () => {
          const loaded = { warnings: [] };
          for (const [key, read] of Object.entries({
            preferences: () => readPreferences(preferencesFile, safeStorage),
            sheets: () => readSheets(sheetsFile, safeStorage),
            connections: () => readConnections(vault, safeStorage),
            readiness: () => readReadiness(readinessFile, safeStorage),
          }))
            try {
              loaded[key] = read();
            } catch {
              loaded.warnings.push(
                `Saved ${key} could not be loaded; their files have not been replaced.`,
              );
            }
          return loaded;
        },
        apply: (loaded) => {
          if (loaded.preferences) {
            const session = { ...controller.engine.settings };
            preferences = controller.preferences = {
              ...DEFAULT_PREFERENCES,
              ...loaded.preferences,
            };
            controller.engine.configure({
              ...preferences,
              mode: session.mode,
              goal: session.goal,
              project: session.project,
            });
            void refreshUpdates();
          }
          if (loaded.sheets) controller.sheets = sheets = loaded.sheets;
          if (loaded.readiness) readiness = loaded.readiness;
          if (loaded.connections) {
            saved = loaded.connections;
            applyConnections(saved);
          }
          controller.engine.errors = controller.engine.errors.filter(
            (e) => ![vaultWarning, preferencesWarning].includes(e.message),
          );
          vaultWarning = preferencesWarning = "";
          for (const warning of loaded.warnings)
            controller.engine.error(warning);
          refreshDesktop();
        },
      });
    }
    if (
      meetings?.archiveOperation &&
      (name.startsWith("meeting.") ||
        [
          "configure",
          "start",
          "practice",
          "new",
          "desktop.data.delete",
          "desktop.delete-all",
        ].includes(name))
    )
      throw new Error(
        "Wait for the restore to finish before changing the library or starting a meeting.",
      );
    if (meetings && name === "desktop.meeting.archive.choose") {
      if (["running", "paused", "finishing"].includes(controller.engine.status))
        throw new Error(
          "End the meeting before changing its archive destination.",
        );
      const picked = await dialog.showOpenDialog(win, {
        title: "Choose your iCloud Drive archive folder",
        defaultPath:
          controller.preferences.iCloudArchiveFolder ||
          path.join(
            app.getPath("home"),
            "Library/Mobile Documents/com~apple~CloudDocs",
          ),
        properties: ["openDirectory", "createDirectory"],
      });
      if (picked.canceled || !picked.filePaths?.[0]) return { cancelled: true };
      await controller.command("configure", {
        iCloudArchiveFolder: picked.filePaths[0],
      });
      return { folder: picked.filePaths[0] };
    }
    if (meetings && name === "desktop.meeting.archive.retry") {
      folderArchive?.resume();
      return { queued: true };
    }
    if (meetings && name === "desktop.meeting.archive.open") {
      const archived = meetings.get(
        "meetings",
        payload.meetingId || meetings.selectedId,
      )?.folderArchived;
      if (!archived?.folder || !path.isAbsolute(archived.folder))
        throw new Error("No completed iCloud archive is available yet.");
      shell.showItemInFolder(path.join(archived.folder, "manifest.json"));
      return { opened: true };
    }
    if (
      name === "configure" &&
      payload.iCloudArchiveEnabled === true &&
      !controller.preferences.iCloudArchiveFolder &&
      !payload.iCloudArchiveFolder
    )
      throw new Error("Choose the iCloud Drive archive folder first.");
    if (meetings && name.startsWith("desktop.meeting.")) {
      if (name === "desktop.meeting.coach") {
        if (!controller.preferences.liveHelp)
          throw new Error("Enable optional live help first.");
        panel.showInactive();
        return { shown: true };
      }
      return meetingCommands(name, payload);
    }
    if (meetings && name.startsWith("meeting."))
      return meetings.command(name, payload);
    if (
      meetings &&
      name === "configure" &&
      ["running", "paused", "finishing"].includes(controller.engine.status) &&
      [
        "retainAudio",
        "liveHelp",
        "speechEngine",
        "noticeWording",
        "preferredSource",
        "language",
        "meetingMcpEnabled",
        "driveArchiveEnabled",
        "iCloudArchiveEnabled",
        "iCloudArchiveFolder",
      ].some(
        (key) =>
          payload[key] !== undefined &&
          payload[key] !== controller.preferences[key],
      )
    )
      throw new Error(
        "End this meeting before changing recording, speech language or cloud assistance. Its participant notice stays tied to the choices you confirmed.",
      );
    if (
      meetings &&
      name === "configure" &&
      (payload.meetingRetentionDays !== undefined ||
        payload.audioRetentionDays !== undefined)
    ) {
      if (payload.confirmRetention !== true)
        throw new Error("Review and confirm retention changes first.");
      delete payload.confirmRetention;
      await controller.command("configure", payload);
      meetingStore?.prune({
        meetingDays: controller.preferences.meetingRetentionDays,
        audioDays: controller.preferences.audioRetentionDays,
      });
      meetings.clearCache();
      controller.engine.emitState();
      return controller.snapshot();
    }
    if (meetings && name === "start" && payload.source !== "demo") {
      if (codexLogin.busy)
        throw new Error("Finish or cancel Codex sign-in first.");
      endSound(false);
      return startMeeting({ meetings, controller, payload });
    }
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
      const next = applyConnections(saved);
      await controller.refreshModels();
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
      await controller.refreshModels();
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
      if (
        controller.engine.status === "running" &&
        controller.mode === "fireflies"
      ) {
        await controller.command("pause");
        await controller.command("start", {
          source: "fireflies",
          consent: true,
          backend: controller.strategyBackend,
        });
        return {};
      }
      if (controller.engine.status !== "running" || controller.mode !== "audio")
        throw new Error("Start listening first.");
      if (speechNeedsRestart(controller)) {
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
      win.webContents.send("callwise:navigate", {
        screen: "settings",
        ...(payload.tab === "AI" ? { tab: "AI" } : {}),
      });
      win.show();
      win.focus();
      return {};
    }
    if (name === "desktop.settings.close") {
      if (["running", "paused"].includes(controller.engine.status)) {
        win.show();
      }
      return {};
    }
    if (name === "desktop.panel.fit") {
      if (
        event.sender === panel.webContents &&
        Number.isFinite(payload.height) &&
        payload.height >= 232 &&
        payload.height <= 10000
      ) {
        const b = panel.getBounds(),
          area = screen.getDisplayMatching(b).workArea,
          h = Math.round(
            Math.max(232, Math.min(payload.height, area.height * 0.7)),
          );
        if (Math.abs(b.height - h) > 2)
          panel.setBounds({
            height: h,
            y: b.y,
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
      endSound(false);
      const channel = payload.channel;
      const soundSession = new AppleSpeechSession({
        ...paths,
        channels: [channel],
        language: controller.preferences.language || "en-US",
      });
      const transcriber = soundSession.adapter({
        apiKey: controller.config.openaiKey,
        model: controller.config.transcriptionModel,
        channel,
        onSegment: (row) => {
          if (!soundCheck || soundCheck.transcriber !== transcriber) return;
          controller.desktopState.testText = soundCheck.transcript.update(row);
          controller.engine.emitState();
        },
        onStatus: () => {},
      });
      soundCheck = {
        channel,
        transcriber,
        level: 0,
        transcript: new SoundCheckTranscript(),
      };
      soundCheck.startedAt = Date.now();
      controller.desktopState.testText = "";
      controller.desktopState.soundResult = "Listening for the test phrase…";
      try {
        await transcriber.connect();
      } catch (error) {
        endSound(false);
        throw error;
      }
      soundTimer = setTimeout(
        () => endSound(true),
        SOUND_CHECK_TIMES[channel].deadlineMs,
      );
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
      if (meetings?.archiveOperation)
        throw new Error("Wait for the restore to finish before deleting data.");
      if (
        ["running", "paused", "finishing"].includes(controller.engine.status) ||
        controller.connecting
      )
        throw new Error("End the call before deleting data.");
      // A running backup holds a snapshot of the library and would finish writing it after the delete.
      if (meetings?.store?.backupReaders > 0)
        throw new Error(
          "Wait for the encrypted backup to finish before deleting data.",
        );
      await folderArchive?.cancelAll();
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
      // Codex runs in this folder; without it, Codex sign-in and coaching fail until a restart.
      mkdirSync(workDir, { recursive: true });
      await meetings?.deleteAll();
      // A library that couldn't be opened at launch (locked keychain, denied access) has no store to
      // reset, so remove its folder here; otherwise its key and database survive and reappear later.
      const fresh = removeUnopenedLibrary({
        meetings,
        directory: path.join(dataDir, "meetings"),
        open: () =>
          new MeetingStore(path.join(dataDir, "meetings"), {
            storage: safeStorage,
          }),
      });
      if (fresh) {
        meetingStore = fresh;
        meetings.search = new MeetingSearch(fresh);
      }
      for (const suffix of ["", ".previous"])
        rmSync(path.join(dataDir, "meeting-access.jsonl" + suffix), {
          force: true,
        });
      baseConfig.openaiKey = baseConfig.firefliesKey = baseConfig.mcpToken = "";
      saved = {};
      // Start again from the launch defaults (live help off), never from an empty object.
      preferences = { ...DEFAULT_PREFERENCES };
      sheets = [];
      readiness = {};
      controller.preferences = { ...DEFAULT_PREFERENCES };
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
    if (name === "desktop.diagnostics") {
      copyDiagnostics();
      return { copied: true };
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
        soundCheck.transcriber.push(data, Date.now() - soundCheck.startedAt);
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
        passed = soundCheckPassed(check.level, text);
      readiness[check.channel] = passed;
      const permission =
        process.platform === "darwin"
          ? systemPreferences.getMediaAccessStatus(
              check.channel === "mic" ? "microphone" : "screen",
            )
          : "unknown";
      controller.desktopState.soundResult = passed
        ? `${check.channel === "mic" ? "Microphone" : "Call audio"} check passed.`
        : ["denied", "restricted"].includes(permission)
          ? `${check.channel === "mic" ? "Microphone" : "Call audio"} permission isn't granted. Open System Settings to allow it.`
          : check.channel === "system" &&
              !app.isPackaged &&
              check.level <= 0.004
            ? "This development run didn't hear call audio. Install the app and run the sound check there."
            : `${check.channel === "mic" ? "Microphone" : "Call audio"} check didn't hear the phrase. ${check.channel === "mic" ? "Check the input device, then say the phrase again." : "Unmute the output and play the test phrase again."}`;
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
  let quitInProgress = false,
    flushPending;
  ipcMain.on("callwise:notes-flushed", (event, token, ok) => {
    if (
      event.sender === win?.webContents &&
      trustedFrame(event.senderFrame) &&
      flushPending?.token === token
    )
      flushPending.resolve(ok === true);
  });
  const flushNotebook = () =>
    new Promise((resolve) => {
      if (!win || win.isDestroyed()) {
        resolve(false);
        return;
      }
      const token = `flush-${Date.now()}`,
        timer = setTimeout(() => {
          flushPending = null;
          resolve(false);
        }, 5000);
      flushPending = {
        token,
        resolve: (ok) => {
          clearTimeout(timer);
          flushPending = null;
          resolve(ok);
        },
      };
      win.webContents.send("callwise:flush-notes", token);
    });
  app.on("before-quit", (event) => {
    if (meetings?.archiveOperation) {
      event.preventDefault();
      win?.show();
      void dialog.showMessageBox(win, {
        type: "info",
        message: "A backup is being restored.",
        detail:
          "Keep Callwise open until the restore finishes. Your existing library stays in place until the backup has been checked.",
        buttons: ["Keep open"],
      });
      return;
    }
    if (smoke || app.isQuitting) {
      shutdown();
      return;
    }
    event.preventDefault();
    if (quitInProgress) return;
    quitInProgress = true;
    void (async () => {
      if (
        ["running", "paused", "finishing"].includes(controller.engine.status)
      ) {
        const r = await dialog.showMessageBox(win, {
          type: "question",
          message: "End this meeting and quit Callwise?",
          detail:
            meetings.current()?.saving === false
              ? "This meeting was started without saving. Export it before quitting if you want to keep it."
              : "Audio capture will stop and your meeting will be saved.",
          buttons: ["Keep meeting open", "End and quit"],
          defaultId: 0,
          cancelId: 0,
        });
        if (r.response !== 1) return;
      }
      if (!(await flushNotebook()) || meetings.pendingWrites.size > 0) {
        win?.show();
        await dialog.showMessageBox(win, {
          type: "warning",
          message: "Your latest notes could not be saved yet.",
          detail: "Keep Callwise open and copy your notes before quitting.",
          buttons: ["Keep open"],
        });
        return;
      }
      if (["running", "paused", "finishing"].includes(controller.engine.status))
        await controller.command("end");
      await Promise.allSettled(
        [...meetings.finishingConsumers].map((c) => c.recorder?.finish()),
      );
      app.isQuitting = true;
      app.quit();
    })()
      .catch(() => {
        controller.engine.error(
          "Callwise could not finish saving. Keep it open and export your notes before quitting.",
        );
      })
      .finally(() => {
        quitInProgress = false;
      });
  });
  app.on("will-quit", shutdown);
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
  if (!smoke)
    void native
      .run("capabilities")
      .then((value) => {
        controller.desktopState.native = value;
        refreshDesktop();
        controller.engine.emitState();
      })
      .catch(() => {
        controller.desktopState.native = {
          speech: false,
          localAI: "unavailable",
        };
        controller.engine.emitState();
      });
  if (smoke) console.log("Smoke: main and live pages loaded.");
  if (!smoke) void refreshUpdates();
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
    const { verifyPanel, verifyReady } = await import("./panel-smoke.mjs");
    await verifyPanel({ controller, panel, win, artifacts });
    await verifyReady({ controller, panel, win, artifacts });
    panel.showInactive();
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
    for (let i = 3; i < DEMO_TRANSCRIPT.length; i++)
      controller.engine.ingest({
        ...DEMO_TRANSCRIPT[i],
        id: `demo:${i}`,
        startMs: DEMO_TRANSCRIPT[i].at,
        final: true,
      });
    await controller.command("end");
    console.log("Smoke: automatic recap completed.");
    win.showInactive();
    await new Promise((r) => setTimeout(r, 350));
    writeFileSync(
      path.join(artifacts, "recap.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    if (controller.recap?.whoOwesWhat.length !== 2 || !controller.recap.email)
      throw new Error(
        "The sample recap must include two promises and an email.",
      );
    await win.webContents.executeJavaScript(`(() => {
      const source = document.querySelector('[data-detail-key^="promise:"]');
      if (source) source.open = true;
    })()`);
    await new Promise((r) => setTimeout(r, 120));
    writeFileSync(
      path.join(artifacts, "recap-source.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.email-draft').scrollIntoView({block: 'start'})",
    );
    await new Promise((r) => setTimeout(r, 120));
    writeFileSync(
      path.join(artifacts, "recap-email.png"),
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
if (headlessMcp) {
  const directory = app.getPath("userData");
  const sessionDir = path.join(
    app.getPath("temp"),
    `callwise-mcp-${process.pid}`,
  );
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  app.setPath("sessionData", sessionDir);
  app.on("will-quit", () =>
    rmSync(sessionDir, { recursive: true, force: true }),
  );
  void app
    .whenReady()
    .then(async () => {
      app.dock?.hide();
      const { runMeetingMcp } = await import("./meeting-mcp.mjs");
      await runMeetingMcp({ app, storage: safeStorage, directory });
    })
    .catch(() => {
      console.error("Callwise saved-meeting access could not start.");
      app.exit(1);
    });
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win && !win.isDestroyed() && !app.isQuitting) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  void boot().catch((error) => {
    reportFailure(`Callwise startup failed: ${error.message}`);
    app.exit(1);
  });
}
