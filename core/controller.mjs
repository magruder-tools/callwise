import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { CoachEngine } from "./engine.mjs";
import { publicConfig } from "./config.mjs";
import { DemoProvider } from "../providers/demo.mjs";
import { OpenAIProvider } from "../providers/openai.mjs";
import { FirefliesClient } from "../providers/fireflies.mjs";
import { ReadOnlyMcp } from "../providers/mcp.mjs";
import { DEMO_DOCUMENTS, DEMO_TRANSCRIPT } from "../fixtures/demo.mjs";

export class CallController extends EventEmitter {
  constructor({ config = {}, demoOnly = false, codexProvider = null } = {}) {
    super();
    this.config = config;
    this.demoOnly = demoOnly;
    this.codex = codexProvider;
    this.demoTimers = [];
    this.demoPosition = 0;
    this.mode = "demo";
    this.strategyBackend = "openai";
    this.generation = 0;
    this.pendingSearch = null;
    this.engine = new CoachEngine();
    this.engine.on("state", () => this.emit("state", this.snapshot()));
    this.fireflies = new FirefliesClient({ apiKey: config.firefliesKey });
    this.transcribers = new Map();
    this.capture = { mic: "off", system: "off" };
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
      this.mode !== "demo" && this.config.mcpUrl && this.config.mcpSearchTool
        ? async ({ query, signal }) => {
            const client = new ReadOnlyMcp({
              url: this.config.mcpUrl,
              token: this.config.mcpToken,
              tool: this.config.mcpSearchTool,
              argumentsTemplate: this.config.mcpSearchArguments,
            });
            const text = await client.search(query, signal);
            return [
              {
                id: "mcp:latest-strategic-search",
                title: "Connected context • latest strategic search",
                kind: "search",
                text,
              },
            ];
          }
        : null;
  }
  snapshot() {
    return {
      ...this.engine.snapshot(),
      config: publicConfig(this.config),
      demoOnly: this.demoOnly,
      backend: this.strategyBackend,
      capture: { ...this.capture },
      connecting: !!this.connecting,
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
        this.engine.configure(payload);
        return this.snapshot();
      case "new": {
        const wasDemo = this.mode === "demo";
        this.stopInputs();
        this.generation++;
        this.mode = "demo";
        this.engine.reset();
        if (payload.clearContext || wasDemo) this.engine.context.clear();
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
      case "ask":
        if (typeof payload.question !== "string" || !payload.question.trim())
          throw new Error("Enter a question first.");
        return this.engine.run(
          payload.lane === "strategy" ? "strategy" : "fast",
          payload.question.slice(0, 3000),
        );
      case "nudge":
        return this.engine.run(
          payload.lane === "strategy" ? "strategy" : "fast",
        );
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
        this.engine.context.add(payload);
        this.engine.emitState();
        return this.snapshot();
      case "context.get":
        return this.engine.context.get(payload.id) || null;
      case "context.search":
        return this.engine.context.search(String(payload.query || ""), {
          project: this.engine.settings.project,
        });
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
        "Add the OpenAI API key later to enable fast coaching. Demo is ready now.",
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
            if (["connection-error", "disconnected"].includes(status))
              this.engine.error(
                "Fireflies connection interrupted. Some transcript segments may be missing.",
              );
            this.engine.emitState();
          },
        });
      if (source === "audio") {
        const { LiveTranscriber } = await import(
          "../providers/transcription.mjs"
        );
        for (const channel of ["mic", "system"]) {
          const transcriber = new LiveTranscriber({
            apiKey: this.config.openaiKey,
            model: this.config.transcriptionModel,
            channel,
            onSegment: (row) => {
              if (generation === this.generation) this.engine.ingest(row);
            },
            onStatus: (status) => {
              if (generation !== this.generation) return;
              this.capture[channel] = status;
              if (
                ["error", "closed", "backpressure"].includes(status) &&
                this.engine.status === "running"
              ) {
                this.engine.error(
                  `${channel} transcription interrupted. Session paused to avoid missing audio.`,
                );
                this.stopInputs();
                this.engine.pause();
              }
              this.engine.emitState();
            },
          });
          this.transcribers.set(channel, transcriber);
          await transcriber.connect();
          if (generation !== this.generation) {
            transcriber.close();
            return this.snapshot();
          }
        }
      }
      if (generation !== this.generation) return this.snapshot();
      if (source === "demo" && !this.engine.transcript.size) {
        // A demo gets its own fictional context; live sessions never inherit it automatically.
        this.engine.context.clear();
        for (const doc of DEMO_DOCUMENTS) this.engine.context.add(doc);
        this.engine.configure({
          mode: "strategy",
          project: "Northstar",
          goal: "Help the client make a defensible budget decision and agree on a focused first engagement.",
        });
        this.demoPosition = 0;
      }
      this.engine.start({ consent, source });
      if (source === "demo") this.replay();
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
    this.transcribers
      .get(channel)
      ?.push(buffer, Date.now() - this.engine.startedAt);
  }
  captureStatus(channel, status) {
    if (!["mic", "system"].includes(channel)) return;
    this.capture[channel] = String(status).slice(0, 50);
    this.engine.emitState();
  }
  stopInputs() {
    this.generation++;
    this.connecting = false;
    for (const timer of this.demoTimers) clearTimeout(timer);
    this.demoTimers = [];
    for (const t of this.transcribers.values()) t.close();
    this.transcribers.clear();
    this.fireflies.close();
    this.pendingSearch?.abort();
    this.pendingSearch = null;
    this.capture = { mic: "off", system: "off" };
    this.emit("stop-capture");
  }
  async searchMcp(query) {
    if (this.demoOnly || this.mode === "demo")
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
    if (this.demoOnly || this.mode === "demo")
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
  }
}
