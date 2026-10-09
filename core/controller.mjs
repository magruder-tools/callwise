import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { ContextRetrieval, shouldSearch } from "./retrieval.mjs";
import { CoachEngine } from "./engine.mjs";
import { publicConfig } from "./config.mjs";
import { sanitizePreferences } from "./preferences.mjs";
import { CALL_DEFAULTS, DEMO_SETTINGS } from "./defaults.mjs";
import { DemoProvider } from "../providers/demo.mjs";
import { OpenAIProvider } from "../providers/openai.mjs";
import { FirefliesClient } from "../providers/fireflies.mjs";
import { ReadOnlyMcp } from "../providers/mcp.mjs";
import { DEMO_DOCUMENTS, DEMO_TRANSCRIPT } from "../fixtures/demo.mjs";

export class CallController extends EventEmitter {
  constructor({
    config = {},
    demoOnly = false,
    codexProvider = null,
    contextProvider = null,
    preferences = {},
    onPreferences = () => {},
    transcriberFactory = null,
    diagnostics = () => {},
  } = {}) {
    super();
    this.config = config;
    this.preferences = sanitizePreferences(preferences);
    this.onPreferences = onPreferences;
    this.diagnostics = diagnostics;
    this.transcriberFactory = transcriberFactory;
    this.demoStarted = false;
    if (
      this.preferences.goal === DEMO_SETTINGS.goal &&
      this.preferences.project === DEMO_SETTINGS.project
    ) {
      this.preferences = sanitizePreferences(CALL_DEFAULTS, this.preferences);
      this.onPreferences(this.preferences);
    }
    this.demoOnly = demoOnly;
    this.codex = codexProvider;
    this.contextProvider = contextProvider;
    this.contextApps = [];
    this.retrieval = new ContextRetrieval({ provider: contextProvider });
    this.retrieval.on("state", () => this.engine?.emitState());
    this.demoTimers = [];
    this.demoPosition = 0;
    this.mode = "demo";
    this.strategyBackend = "openai";
    this.generation = 0;
    this.pendingSearch = null;
    this.engine = new CoachEngine({ diagnostics });
    this.engine.configure(this.preferences);
    this.lastEngineStatus = this.engine.status;
    this.engine.on("state", () => {
      const wasRunning = this.lastEngineStatus === "running";
      this.lastEngineStatus = this.engine.status;
      if (wasRunning && this.engine.status !== "running") this.stopInputs();
      this.emit("state", this.snapshot());
    });
    this.fireflies = new FirefliesClient({ apiKey: config.firefliesKey });
    this.transcribers = new Map();
    this.capture = { mic: "off", system: "off" };
    this.captureInputs = { mic: "off", system: "off" };
    this.demoProvider = new DemoProvider();
    this.setProviders();
  }
  setProviders() {
    this.engine.providers =
      this.mode === "demo"
        ? { fast: this.demoProvider, strategy: this.demoProvider }
        : {
            fast: new OpenAIProvider({
              apiKey: this.config.openaiKey,
              model: this.config.fastModel,
            }),
            strategy:
              this.strategyBackend === "codex"
                ? this.codex
                : new OpenAIProvider({
                    apiKey: this.config.openaiKey,
                    model: this.config.strategyModel,
                    effort: "high",
                  }),
          };
    this.engine.retriever =
      this.mode !== "demo" && this.engine.settings.contextConsent
        ? async ({ query, signal, recent, project, sessionId }) => {
            if (this.engine.settings.contextBackend === "codex")
              return this.retrieval.search({
                query,
                signal,
                recent,
                project,
                sessionId,
                appIds: this.engine.settings.contextApps,
              });
            if (
              this.engine.settings.contextBackend === "mcp" &&
              this.config.mcpUrl &&
              this.config.mcpSearchTool &&
              shouldSearch({ query, recent, project })
            ) {
              const text = await this.mcpClient().search(query, signal);
              return [
                {
                  id: `mcp:${randomUUID()}`,
                  title: "Connected context search",
                  kind: "search",
                  text,
                },
              ];
            }
            return [];
          }
        : null;
  }
  mcpClient() {
    return new ReadOnlyMcp({
      url: this.config.mcpUrl,
      token: this.config.mcpToken,
      tool: this.config.mcpSearchTool,
      argumentsTemplate: this.config.mcpSearchArguments,
    });
  }
  async discoverContext() {
    if (this.demoOnly || !this.contextProvider)
      throw new Error("Open the desktop app to discover Codex apps.");
    const generation = this.generation;
    const result = await this.contextProvider.inspect();
    if (generation !== this.generation)
      throw new Error("App discovery cancelled because the session changed.");
    this.contextApps = result.apps;
    this.engine.emitState();
    return result;
  }
  configureContext(payload) {
    if (this.engine.status === "running")
      throw new Error("Pause the session before changing its configuration.");
    if (
      payload.contextApps !== undefined &&
      !Array.isArray(payload.contextApps)
    )
      throw new Error("Context apps must be a list of app identifiers.");
    if (
      typeof payload.project === "string" &&
      payload.project.slice(0, 100) !== this.engine.settings.project &&
      (this.engine.transcript.size || this.engine.cards.length)
    )
      throw new Error(
        "Create a new session before changing Context scope after the conversation has started.",
      );
    if (
      payload.contextApps &&
      payload.contextApps.some(
        (id) => !this.contextApps.some((a) => a.id === id && a.ready),
      )
    )
      throw new Error("Refresh apps and select only apps marked ready.");
    const prior = JSON.stringify([
      this.engine.settings.project,
      this.engine.settings.contextBackend,
      this.engine.settings.contextApps,
      this.engine.settings.contextConsent,
    ]);
    // Persist only explicit user edits, so demo fixtures cannot become defaults.
    this.rememberPreferences(payload);
    this.engine.configure(payload);
    const next = JSON.stringify([
      this.engine.settings.project,
      this.engine.settings.contextBackend,
      this.engine.settings.contextApps,
      this.engine.settings.contextConsent,
    ]);
    if (prior !== next) {
      this.retrieval.invalidate();
      this.pendingSearch?.abort();
      for (const [id, doc] of this.engine.context.docs)
        if (doc.kind === "connector") this.engine.context.docs.delete(id);
    }
    this.setProviders();
    this.engine.emitState();
    return this.snapshot();
  }
  rememberPreferences(patch) {
    patch = { ...patch };
    if (this.demoStarted)
      for (const key of ["mode", "goal", "project"]) delete patch[key];
    const next = sanitizePreferences(patch, this.preferences);
    this.onPreferences(next);
    this.preferences = next;
  }
  async searchConnected(query) {
    const settings = this.engine.settings;
    if (
      this.demoOnly ||
      (this.mode === "demo" && this.engine.status !== "idle")
    )
      throw new Error(
        "Connected searches are disabled during the fictional demo. End it and create a new session first.",
      );
    if (this.engine.status === "ended")
      throw new Error("Create a new session before searching.");
    if (!settings.contextConsent)
      throw new Error("Allow selected context sources in Connections first.");
    if (settings.contextBackend === "mcp") return this.searchMcp(query);
    if (settings.contextBackend !== "codex")
      throw new Error("Choose Codex connected apps in Connections first.");
    const generation = this.generation,
      sessionId = this.engine.sessionId,
      project = settings.project;
    const docs = await this.retrieval.search({
      query,
      project,
      sessionId,
      appIds: settings.contextApps,
      manual: true,
    });
    if (
      generation !== this.generation ||
      sessionId !== this.engine.sessionId ||
      project !== this.engine.settings.project
    )
      throw new Error("Context results discarded because the session changed.");
    for (const doc of docs) this.engine.context.add(doc);
    this.engine.emitState();
    return { added: docs.length, retrieval: this.retrieval.snapshot() };
  }

  snapshot() {
    return {
      ...this.engine.snapshot(),
      preferences: structuredClone(this.preferences),
      config: publicConfig(this.config),
      demoOnly: this.demoOnly,
      backend: this.strategyBackend,
      capture: { ...this.capture },
      connecting: !!this.connecting,
      contextApps: this.contextApps.map((a) => ({ ...a })),
      retrieval: this.retrieval.snapshot(),
    };
  }
  async command(name, payload = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("Invalid command payload.");
    if (this.connecting && !["pause", "end", "new", "state"].includes(name))
      throw new Error("The connection is still starting.");
    switch (name) {
      case "state":
        return this.snapshot();
      case "configure":
        return this.configureContext(payload);
      case "new": {
        const wasDemo = this.mode === "demo";
        this.stopInputs();
        this.generation++;
        this.mode = "demo";
        this.demoStarted = false;
        this.retrieval.reset();
        this.engine.reset();
        this.engine.configure(this.preferences);
        if (payload.clearContext || wasDemo) this.engine.context.clear();
        else
          for (const [id, doc] of this.engine.context.docs)
            if (doc.kind === "connector") this.engine.context.docs.delete(id);
        this.setProviders();
        this.engine.emitState();
        return this.snapshot();
      }
      case "start":
        return this.start(payload);
      case "pause":
        this.stopInputs();
        this.engine.pause();
        return this.snapshot();
      case "end":
        this.stopInputs();
        this.engine.end();
        return this.snapshot();
      case "ask": {
        if (typeof payload.question !== "string" || !payload.question.trim())
          throw new Error("Enter a question first.");
        const lane =
          payload.lane === "strategy" ||
          (this.engine.settings.autoSearch &&
            this.engine.settings.contextConsent &&
            shouldSearch({
              recent: [{ text: payload.question }],
              project: this.engine.settings.project,
            }))
            ? "strategy"
            : "fast";
        return this.engine.run(lane, payload.question.slice(0, 3000), {
          origin: "asked",
          presentationLane: "fast",
        });
      }
      case "nudge":
        return this.engine.run(
          "fast",
          "What is the most useful thing to say or ask right now?",
          { origin: "hotkey" },
        );
      case "error.dismiss":
        this.engine.clearErrors({ id: payload.id });
        return this.snapshot();
      case "feedback":
        this.engine.feedback(payload.id, payload.status);
        return this.snapshot();
      case "transcript":
        this.engine.ingest({
          id: payload.id || randomUUID(),
          speaker: payload.speaker || "Other",
          text: payload.text,
          startMs: payload.startMs,
          final: true,
        });
        return this.snapshot();
      case "context.add":
        this.engine.context.add({
          title: payload.title,
          text: payload.text,
          url: payload.url,
          project: this.engine.settings.project,
          kind: "note",
        });
        this.engine.emitState();
        return this.snapshot();
      case "context.get":
        return this.engine.context.get(payload.id) || null;
      case "context.search":
        return this.engine.context.search(String(payload.query || ""), {
          project: this.engine.settings.project,
        });
      case "context.discover":
        return this.discoverContext();
      case "context.connected":
        return this.searchConnected(payload.query);
      case "context.cancel":
        this.pendingSearch?.abort();
        this.retrieval.cancel();
        return this.snapshot();
      case "context.mcp":
        return this.searchMcp(payload.query);
      case "context.fireflies":
        return this.importFireflies(payload.id);
      case "codex.inspect":
        if (this.demoOnly || !this.codex)
          throw new Error("Codex inspection is available in the desktop app.");
        return this.codex.inspect();
      case "export":
        return this.engine.exportMarkdown();
      default:
        throw new Error("Unknown command.");
    }
  }
  async start({
    source = "demo",
    backend = "openai",
    consent = false,
    transcriptId = "",
  } = {}) {
    if (!["demo", "manual", "audio", "fireflies"].includes(source))
      throw new Error("Choose a supported audio source.");
    if (this.demoOnly && source !== "demo")
      throw new Error(
        "The browser demo does not connect to accounts or record audio. Open the desktop app for live mode.",
      );
    if (this.engine.status === "running") return this.snapshot();
    if (this.engine.status === "ended")
      throw new Error("Create a new session first.");
    if (source !== "demo" && !consent)
      throw new Error(
        "Confirm that AI assistance and transcription are permitted.",
      );
    if (source !== "demo" && !this.config.openaiKey)
      throw new Error(
        "Open Connections and save an OpenAI API key, or use Demo first.",
      );
    if (backend === "codex" && source !== "demo" && !this.codex)
      throw new Error("Codex requires the desktop app.");
    if (this.engine.transcript.size && source !== this.mode)
      throw new Error(
        "Start a new session before switching between demo and live sources.",
      );
    this.mode = source;
    this.strategyBackend = backend === "codex" ? "codex" : "openai";
    this.setProviders();
    this.stopInputs();
    const generation = ++this.generation;
    this.connecting = true;
    this.engine.emitState();
    try {
      if (source === "fireflies")
        await this.fireflies.connect({
          transcriptId,
          onSegment: (row) => {
            if (generation === this.generation) this.engine.ingest(row);
          },
          onStatus: (status) => {
            if (generation !== this.generation) return;
            this.capture.system = status;
            if (
              ["connection-error", "disconnected"].includes(status) &&
              this.engine.status === "running"
            ) {
              this.engine.error(
                "Fireflies connection interrupted. Session paused to avoid missing transcript segments.",
              );
              this.stopInputs();
              this.engine.pause();
            }
            this.engine.emitState();
          },
        });
      if (source === "audio") {
        const { LiveTranscriber } = await import(
          "../providers/transcription.mjs"
        );
        await Promise.all(
          ["mic", "system"].map(async (channel) => {
            const options = {
              apiKey: this.config.openaiKey,
              model: this.config.transcriptionModel,
              channel,
              onSegment: (row) => {
                if (generation === this.generation) this.engine.ingest(row);
              },
              diagnostics: this.diagnostics,
              onDiscard: (ids) => {
                if (generation !== this.generation) return;
                for (const id of ids)
                  if (!this.engine.transcript.get(id)?.final)
                    this.engine.transcript.delete(id);
                this.engine.emitState();
              },
              onStatus: (status, error) => {
                if (generation !== this.generation) return;
                this.capture[channel] =
                  status === "connected" &&
                  this.captureInputs[channel] !== "off"
                    ? this.captureInputs[channel]
                    : status;
                this.diagnostics("capture.status", { channel, state: status });
                if (status === "failed")
                  this.engine.error(
                    error ||
                      `${channel} transcription could not reconnect. Pause and resume to try again.`,
                    { condition: `connection:${channel}`, lifetimeMs: null },
                  );
                if (status === "connected")
                  this.engine.clearErrors({
                    condition: `connection:${channel}`,
                  });
                this.engine.emitState();
              },
            };
            const transcriber = this.transcriberFactory
              ? this.transcriberFactory(options)
              : new LiveTranscriber(options);
            this.transcribers.set(channel, transcriber);
            await transcriber.connect();
            if (generation !== this.generation) {
              transcriber.close();
              return this.snapshot();
            }
          }),
        );
      }
      if (generation !== this.generation) return this.snapshot();
      if (source === "demo" && !this.engine.transcript.size) {
        this.demoStarted = true;
        this.engine.context.clear();
        for (const doc of DEMO_DOCUMENTS) this.engine.context.add(doc);
        this.engine.configure(DEMO_SETTINGS);
        this.demoPosition = 0;
      }
      this.engine.start({ consent, source });
      if (source === "demo") this.replay();
      this.connecting = false;
      this.engine.emitState();
      return this.snapshot();
    } catch (error) {
      if (generation !== this.generation) return this.snapshot();
      this.stopInputs();
      this.engine.pause();
      throw error;
    } finally {
      if (generation === this.generation) {
        this.connecting = false;
        this.engine.emitState();
      }
    }
  }
  replay() {
    const startAt = DEMO_TRANSCRIPT[this.demoPosition]?.at || 0;
    for (let i = this.demoPosition; i < DEMO_TRANSCRIPT.length; i++) {
      const row = DEMO_TRANSCRIPT[i];
      this.demoTimers.push(
        setTimeout(
          () => {
            if (this.engine.status !== "running" || this.mode !== "demo")
              return;
            this.demoPosition = i + 1;
            this.engine.ingest({
              id: `demo:${i}`,
              speaker: row.speaker,
              text: row.text,
              startMs: row.at,
              final: true,
            });
          },
          row.at - startAt + 500,
        ),
      );
    }
  }
  audio(channel, buffer) {
    if (this.mode !== "audio" || this.engine.status !== "running") return;
    this.transcribers.get(channel)?.push(buffer, this.engine.activeTimeMs());
  }
  captureStatus(channel, status) {
    if (!["mic", "system"].includes(channel)) return;
    // Renderer capture updates must not hide a transcription reconnect/failure.
    this.captureInputs[channel] = String(status).slice(0, 50);
    if (!["reconnecting", "failed"].includes(this.capture[channel]))
      this.capture[channel] = String(status).slice(0, 50);
    this.diagnostics("capture.status", { channel, state: status });
    this.engine.emitState();
  }
  stopInputs() {
    this.generation++;
    this.retrieval.cancel();
    this.connecting = false;
    for (const timer of this.demoTimers) clearTimeout(timer);
    this.demoTimers = [];
    for (const t of this.transcribers.values()) t.close();
    this.transcribers.clear();
    this.fireflies.close();
    this.pendingSearch?.abort();
    this.pendingSearch = null;
    this.capture = { mic: "off", system: "off" };
    this.captureInputs = { mic: "off", system: "off" };
    this.emit("stop-capture");
  }
  async searchMcp(query) {
    if (
      this.demoOnly ||
      (this.mode === "demo" && this.engine.status !== "idle")
    )
      throw new Error(
        "External context search is disabled in Demo mode. Start a live session to connect it.",
      );
    this.pendingSearch?.abort();
    const controller = new AbortController();
    this.pendingSearch = controller;
    const generation = this.generation;
    const client = new ReadOnlyMcp({
      url: this.config.mcpUrl,
      token: this.config.mcpToken,
      tool: this.config.mcpSearchTool,
      argumentsTemplate: this.config.mcpSearchArguments,
    });
    const text = await client.search(
      String(query || this.engine.settings.goal).slice(0, 1000),
      controller.signal,
    );
    if (generation !== this.generation)
      throw new Error("Search cancelled because the session changed.");
    this.engine.context.add({
      title: `Context search: ${String(query || "Meeting preparation").slice(0, 100)}`,
      text,
      kind: "search",
      project: this.engine.settings.project,
    });
    this.engine.emitState();
    return this.snapshot();
  }
  async importFireflies(id) {
    if (
      this.demoOnly ||
      (this.mode === "demo" && this.engine.status !== "idle")
    )
      throw new Error(
        "External context import is disabled in Demo mode. Start a live session to connect it.",
      );
    const generation = this.generation;
    this.pendingSearch?.abort();
    const request = new AbortController();
    this.pendingSearch = request;
    const doc = await this.fireflies.importTranscript(
      String(id || "").slice(0, 200),
      request.signal,
    );
    if (generation !== this.generation)
      throw new Error("Import cancelled because the session changed.");
    this.engine.context.add({ ...doc, project: this.engine.settings.project });
    this.engine.emitState();
    return this.snapshot();
  }
  close() {
    this.stopInputs();
    this.engine.end();
    this.codex?.close();
    this.contextProvider?.close();
  }
}
