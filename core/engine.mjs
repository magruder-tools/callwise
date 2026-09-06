import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { ContextStore, terms } from "./context.mjs";
import { makePrompt, validateAdvice } from "./prompts.mjs";

export class CoachEngine extends EventEmitter {
  constructor({ providers, clock = Date.now, config = {} } = {}) {
    super();
    this.providers = providers || {};
    this.clock = clock;
    this.context = new ContextStore();
    this.config = {
      fastDelay: 2500,
      strategyDelay: 14000,
      fastCooldown: 7000,
      strategyCooldown: 35000,
      fastTTL: 30000,
      strategyTTL: 150000,
      maxFast: 120,
      maxStrategy: 15,
      maxSessionMs: 2 * 60 * 60 * 1000,
      ...config,
    };
    this.epoch = 0;
    this.timers = {};
    this.inflight = {};
    this.lastRun = { fast: 0, strategy: 0 };
    this.jobs = 0;
    this.reset();
  }
  reset() {
    this.cancel();
    this.epoch++;
    this.status = "idle";
    this.sessionId = randomUUID();
    this.revision = 0;
    this.transcript = new Map();
    this.cards = [];
    this.dismissed = [];
    this.errors = [];
    this.activity = [];
    this.metrics = {
      fastCalls: 0,
      strategyCalls: 0,
      discarded: 0,
      inputTokens: 0,
      outputTokens: 0,
      accepted: 0,
      dismissed: 0,
    };
    this.settings = {
      mode: "general",
      goal: "Have a useful conversation and agree on clear next steps.",
      profile: "",
      project: "",
      quiet: false,
      autoSearch: false,
      contextBackend: "off",
      contextApps: [],
      contextConsent: false,
    };
    this.lastRun = { fast: 0, strategy: 0 };
    this.startedAt = null;
    this.stoppedAt = null;
    this.source = "demo";
    this.emitState();
  }
  configure(patch) {
    if (this.status === "running")
      throw new Error("Pause the session before changing its configuration.");
    if (
      patch.contextBackend !== undefined &&
      !["off", "codex", "mcp"].includes(patch.contextBackend)
    )
      throw new Error("Choose a supported context provider.");
    if (
      patch.contextApps !== undefined &&
      (!Array.isArray(patch.contextApps) ||
        patch.contextApps.length > 12 ||
        patch.contextApps.some(
          (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id),
        ))
    )
      throw new Error("Choose up to 12 valid context apps.");
    if (patch.contextBackend !== undefined)
      this.settings.contextBackend = patch.contextBackend;
    if (patch.contextApps !== undefined)
      this.settings.contextApps = [...new Set(patch.contextApps)];
    if (typeof patch.contextConsent === "boolean")
      this.settings.contextConsent = patch.contextConsent;
    for (const key of ["mode", "goal", "profile", "project"])
      if (typeof patch[key] === "string")
        this.settings[key] = patch[key].slice(
          0,
          key === "profile" ? 6000 : key === "project" ? 100 : 2000,
        );
    if (typeof patch.quiet === "boolean") this.settings.quiet = patch.quiet;
    if (typeof patch.autoSearch === "boolean")
      this.settings.autoSearch = patch.autoSearch;
    this.emitState();
  }
  start({ consent = false, source = "demo" } = {}) {
    if (this.status === "running") return;
    if (this.status === "ended")
      throw new Error("Create a new session to start again.");
    if (source !== "demo" && !consent)
      throw new Error(
        "Confirm that AI assistance and transcription are permitted before starting.",
      );
    if (
      this.startedAt !== null &&
      this.clock() - this.startedAt >= this.config.maxSessionMs
    )
      throw new Error(
        "Session time limit reached. Export and create a new session.",
      );
    this.source = source;
    this.status = "running";
    this.startedAt ??= this.clock();
    this.stoppedAt = null;
    clearTimeout(this.deadlineTimer);
    this.deadlineTimer = setTimeout(
      () => {
        this.pause();
        this.error(
          "Session time limit reached. Export and create a new session.",
        );
      },
      Math.max(1, this.config.maxSessionMs - (this.clock() - this.startedAt)),
    );
    this.deadlineTimer.unref?.();
    this.epoch++;
    this.log(
      "session",
      source === "demo"
        ? "Demo started — synthetic data, no API calls."
        : "Session started.",
    );
    this.emitState();
  }
  pause() {
    if (this.status !== "running") return;
    this.status = "paused";
    this.stoppedAt = this.clock();
    this.epoch++;
    this.cancel();
    this.log("session", "Paused. Capture and coaching stopped.");
    this.emitState();
  }
  end() {
    this.status = "ended";
    this.stoppedAt = this.clock();
    this.epoch++;
    this.cancel();
    this.log("session", "Session ended. Export only if you want to keep it.");
    this.emitState();
  }
  cancel() {
    clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    for (const t of Object.values(this.timers || {})) clearTimeout(t);
    this.timers = {};
    for (const job of Object.values(this.inflight || {}))
      job.controller.abort();
    this.inflight = {};
  }
  ingest(segment) {
    if (this.status !== "running") return false;
    if (this.clock() - this.startedAt > this.config.maxSessionMs) {
      this.pause();
      this.error(
        "Session time limit reached. Start a new session to continue.",
      );
      return false;
    }
    if (
      !segment ||
      typeof segment.id !== "string" ||
      typeof segment.text !== "string" ||
      !segment.text.trim()
    )
      return false;
    if (segment.text.length > 20000)
      throw new Error("Transcript segment is too long.");
    if (this.transcript.size >= 5000 && !this.transcript.has(segment.id)) {
      this.pause();
      this.error("Transcript limit reached. Export and start a new session.");
      return false;
    }
    const prior = this.transcript.get(segment.id);
    // Network deltas may arrive after completion; never turn final evidence back into a partial.
    if (prior?.final && segment.final === false) return false;
    if (
      prior?.text === segment.text &&
      prior.final === (segment.final !== false)
    )
      return false;
    const row = {
      id: segment.id,
      text: segment.text.trim(),
      speaker: String(segment.speaker || "Other").slice(0, 100),
      channel: segment.channel || "other",
      final: segment.final !== false,
      startMs: Number.isFinite(segment.startMs)
        ? Math.max(0, segment.startMs)
        : this.clock() - this.startedAt,
      receivedAt: this.clock(),
    };
    this.transcript.set(row.id, row);
    if (row.final) {
      this.revision++;
      if (!this.settings.quiet) {
        this.schedule("fast");
        this.schedule("strategy");
      }
    }
    this.emitState();
    return true;
  }
  schedule(lane) {
    if (this.timers[lane] || this.inflight[lane] || this.status !== "running")
      return;
    const delay = Math.max(
      this.config[`${lane}Delay`],
      this.lastRun[lane] + this.config[`${lane}Cooldown`] - this.clock(),
    );
    this.timers[lane] = setTimeout(
      () => {
        delete this.timers[lane];
        void this.run(lane).catch((error) => this.error(error.message));
      },
      Math.max(0, delay),
    );
  }
  async run(lane = "fast", question = "") {
    if (!["fast", "strategy"].includes(lane))
      throw new Error("Unknown coaching lane.");
    if (this.status !== "running")
      throw new Error("Start or resume the session first.");
    if (this.clock() - this.startedAt >= this.config.maxSessionMs) {
      this.pause();
      throw new Error(
        "Session time limit reached. Export and create a new session.",
      );
    }
    if (this.inflight[lane]) {
      if (!question) return { busy: true };
      // An explicit user question takes precedence over a speculative suggestion.
      this.inflight[lane].controller.abort();
      delete this.inflight[lane];
    }
    clearTimeout(this.timers[lane]);
    delete this.timers[lane];
    if (!this.providers[lane]) {
      this.error(`${lane} provider is not configured.`);
      return;
    }
    const metric = `${lane}Calls`;
    if (
      this.metrics[metric] >=
      this.config[lane === "fast" ? "maxFast" : "maxStrategy"]
    ) {
      this.error(`${lane} call limit reached for this session.`);
      return;
    }
    const rows = [...this.transcript.values()]
      .filter((r) => r.final)
      .sort((a, b) => a.startMs - b.startMs);
    if (!rows.length && !question) return;
    const epoch = this.epoch,
      revision = this.revision,
      start = this.clock(),
      job = { id: ++this.jobs, controller: new AbortController() };
    this.inflight[lane] = job;
    this.lastRun[lane] = start;
    this.metrics[metric]++;
    const recent = rows
      .slice(-8)
      .map((r) => r.text)
      .join(" ");
    const query = `${question} ${recent} ${this.settings.goal}`;
    let sources = this.context.search(query, {
      project: this.settings.project,
    });
    this.emitState();
    try {
      if (lane === "strategy" && this.settings.autoSearch && this.retriever) {
        try {
          const docs = await this.retriever({
            query: (
              question ||
              `${this.settings.project}: ${rows
                .slice(-3)
                .map((row) => row.text)
                .join(" ")}`
            ).slice(0, 1500),
            recent: question ? [{ text: question }] : rows.slice(-3),
            project: this.settings.project,
            sessionId: this.sessionId,
            signal: job.controller.signal,
          });
          if (epoch !== this.epoch || job.controller.signal.aborted) return;
          const added = docs.map((doc) =>
            this.context.add({ ...doc, project: this.settings.project }),
          );
          const matches = this.context.search(query, {
            project: this.settings.project,
          });
          const seen = new Set();
          // The retriever already selected these excerpts semantically; a second
          // keyword-only pass must not drop them because synonyms differ.
          sources = [
            ...added.map(({ text, ...doc }) => ({
              ...doc,
              excerpt: text.slice(0, 1800),
            })),
            ...matches,
          ]
            .filter((doc) => {
              if (seen.has(doc.id)) return false;
              seen.add(doc.id);
              return true;
            })
            .slice(0, 5);
        } catch (error) {
          if (job.controller.signal.aborted) return;
          this.log(
            "context",
            "Background context search failed; using the sources already loaded.",
          );
        }
      }
      if (epoch !== this.epoch || job.controller.signal.aborted) return;
      const prompt = makePrompt({
        lane,
        ...this.settings,
        transcript: rows,
        sources,
        question,
        previousCards: this.cards,
      });
      const result = await this.providers[lane].generate({
        lane,
        prompt,
        transcript: rows,
        sources,
        question,
        signal: job.controller.signal,
      });
      if (epoch !== this.epoch || this.inflight[lane]?.id !== job.id) return;
      if (this.status !== "running" || job.controller.signal.aborted) {
        this.metrics.discarded++;
        return;
      }
      this.metrics.inputTokens += Number(result.usage?.input_tokens || 0);
      this.metrics.outputTokens += Number(result.usage?.output_tokens || 0);
      const stale =
        this.clock() - start > this.config[`${lane}TTL`] ||
        this.revision - revision > (lane === "fast" ? 5 : 25);
      if (stale) {
        this.metrics.discarded++;
        this.log("coaching", "An outdated suggestion was discarded.");
        return;
      }
      const allowed = new Set(sources.map((s) => s.id));
      for (const card of validateAdvice(result)) {
        if (card.kind === "fact" && !card.sourceIds.length) {
          this.metrics.discarded++;
          continue;
        }
        if (card.sourceIds.some((id) => !allowed.has(id))) {
          this.metrics.discarded++;
          this.log(
            "coaching",
            "A card with an unsupported citation was discarded.",
          );
          continue;
        }
        if (!question && card.confidence < 0.58) continue;
        if (this.isDuplicate(card)) continue;
        const now = this.clock();
        this.cards.push({
          ...card,
          id: randomUUID(),
          lane,
          createdAt: now,
          expiresAt: now + this.config[`${lane}TTL`],
          latencyMs: now - start,
          basedOnRevision: revision,
          status: "new",
          sources: sources.filter((s) => card.sourceIds.includes(s.id)),
          demo: this.source === "demo",
        });
      }
      this.cards = this.cards.slice(-100);
      return { ok: true };
    } catch (error) {
      if (epoch === this.epoch && !job.controller.signal.aborted)
        this.error(error.message || "Coaching request failed.");
    } finally {
      if (this.inflight[lane]?.id === job.id) delete this.inflight[lane];
      if (
        epoch === this.epoch &&
        this.status === "running" &&
        revision !== this.revision &&
        !this.settings.quiet
      )
        this.schedule(lane);
      this.emitState();
    }
  }
  isDuplicate(card) {
    const current = new Set(terms(card.title + " " + card.body));
    return [...this.cards.slice(-20), ...this.dismissed.slice(-20)].some(
      (old) => {
        if (old.title.toLowerCase() === card.title.toLowerCase()) return true;
        const prev = new Set(terms(old.title + " " + old.body));
        const overlap = [...current].filter((t) => prev.has(t)).length;
        return (
          overlap / Math.max(1, new Set([...current, ...prev]).size) > 0.72
        );
      },
    );
  }
  feedback(id, status) {
    if (!["accepted", "dismissed"].includes(status))
      throw new Error("Unknown feedback.");
    const card = this.cards.find((c) => c.id === id);
    if (!card || card.status !== "new") return;
    card.status = status;
    this.metrics[status]++;
    if (status === "dismissed") {
      this.dismissed.push(card);
      this.dismissed = this.dismissed.slice(-40);
    }
    this.emitState();
  }
  log(kind, message) {
    this.activity.push({ kind, message, at: this.clock() });
    this.activity = this.activity.slice(-30);
  }
  error(message) {
    const safe = String(message).slice(0, 400);
    if (
      this.errors.at(-1)?.message === safe &&
      this.clock() - this.errors.at(-1).at < 10000
    )
      return;
    this.errors.push({
      message: String(message).slice(0, 400),
      at: this.clock(),
    });
    this.errors = this.errors.slice(-8);
    this.emitState();
  }
  snapshot() {
    return {
      sessionId: this.sessionId,
      status: this.status,
      source: this.source,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      settings: {
        ...this.settings,
        contextApps: [...this.settings.contextApps],
      },
      revision: this.revision,
      transcript: [...this.transcript.values()].sort(
        (a, b) => a.startMs - b.startMs,
      ),
      cards: this.cards.map((c) => ({
        ...c,
        expired: this.clock() > c.expiresAt,
      })),
      context: this.context.list(),
      metrics: { ...this.metrics },
      errors: [...this.errors],
      activity: [...this.activity],
      thinking: {
        fast: !!this.inflight.fast,
        strategy: !!this.inflight.strategy,
      },
      limits: { fast: this.config.maxFast, strategy: this.config.maxStrategy },
    };
  }
  emitState() {
    this.emit("state", this.snapshot());
  }
  exportMarkdown() {
    const s = this.snapshot();
    const lines = [
      `# ${s.source === "demo" ? "DEMO — " : ""}Callwise session`,
      ``,
      `Mode: ${s.settings.mode}`,
      `Goal: ${s.settings.goal}`,
      ``,
      "## Notes and suggestions",
    ];
    for (const c of s.cards.filter((c) => c.status !== "dismissed"))
      lines.push(
        "",
        `### ${c.title}`,
        c.body,
        c.say ? `Suggested wording: ${c.say}` : "",
        ...c.sources.map(
          (src) =>
            `Source: ${src.title}${src.url ? ` — ${src.url}` : ""}${src.provenance ? ` | Retrieved via ${src.provenance.appName} / ${src.provenance.action} at ${src.retrievedAt}` : ""}`,
        ),
      );
    lines.push("", "## Transcript");
    for (const r of s.transcript)
      lines.push(
        "",
        `[${Math.floor(r.startMs / 60000)}:${String(Math.floor(r.startMs / 1000) % 60).padStart(2, "0")}] ${r.speaker}: ${r.text}`,
      );
    return lines.join("\n");
  }
}
