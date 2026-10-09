import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { ContextStore, terms } from "./context.mjs";
import { makePrompt, validateAdvice, words } from "./prompts.mjs";
import { CALL_DEFAULTS } from "./defaults.mjs";
import {
  classifyTurn,
  completePartial,
  isOwnTurn,
  isBackchannel,
  normalize,
  editRatio,
  consumeToken,
  echoMatch,
} from "./triggers.mjs";

export class CoachEngine extends EventEmitter {
  constructor({
    providers,
    clock = Date.now,
    config = {},
    diagnostics = () => {},
  } = {}) {
    super();
    this.providers = providers || {};
    this.clock = clock;
    this.diagnostics = diagnostics;
    this.context = new ContextStore();
    this.config = {
      autoCoach: true,
      fastDelay: 0,
      strategyDelay: 0,
      fastCooldown: 0,
      strategyCooldown: 120000,
      fastTTL: 30000,
      strategyTTL: 150000,
      maxFast: 120,
      maxStrategy: 15,
      warnSessionMs: 2 * 60 * 60 * 1000,
      maxSessionMs: 4 * 60 * 60 * 1000,
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
    this.handledTurns = new Set();
    this.answered = new Map();
    this.rate = { tokens: 3, at: this.clock(), requests: [] };
    this.speculation = null;
    this.autoQueue = [];
    this.lastBackground = this.clock();
    this.lastSlow = -Infinity;
    this.userSpeechAt = null;
    this.latencies = [];
    this.prep = null;
    this.summary = "";
    this.commitments = [];
    this.covered = new Set();
    this.otherTurns = 0;
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
      ...CALL_DEFAULTS,
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
    this.activeMs = 0;
    this.activeStartedAt = null;
    this.durationWarned = false;
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
    for (const key of ["mode", "goal", "profile", "project", "userName"])
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
    if (this.activeTimeMs() >= this.config.maxSessionMs)
      throw new Error(
        "Session time limit reached. Export and create a new session.",
      );
    this.source = source;
    this.status = "running";
    this.activeStartedAt = this.clock();
    this.startedAt ??= this.clock();
    this.stoppedAt = null;
    this.clearErrors({ prefix: "connection:", emit: false });
    clearTimeout(this.deadlineTimer);
    this.deadlineTimer = setTimeout(
      () => {
        this.end();
        this.error(
          "Session time limit reached. Export and create a new session.",
        );
      },
      Math.max(1, this.config.maxSessionMs - this.activeTimeMs()),
    );
    this.deadlineTimer.unref?.();
    if (
      !this.durationWarned &&
      this.config.warnSessionMs < this.config.maxSessionMs
    ) {
      this.warningTimer = setTimeout(
        () => this.warnDuration(),
        Math.max(1, this.config.warnSessionMs - this.activeTimeMs()),
      );
      this.warningTimer.unref?.();
    }
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
    this.freezeClock();
    this.status = "paused";
    this.stoppedAt = this.clock();
    this.epoch++;
    this.cancel();
    this.log("session", "Paused. Capture and coaching stopped.");
    this.emitState();
  }
  end() {
    this.freezeClock();
    this.status = "ended";
    this.stoppedAt = this.clock();
    this.epoch++;
    this.cancel();
    this.log("session", "Session ended. Export only if you want to keep it.");
    this.emitState();
  }
  cancel() {
    clearTimeout(this.warningTimer);
    clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    for (const t of Object.values(this.timers || {})) clearTimeout(t);
    this.timers = {};
    for (const job of Object.values(this.inflight || {})) {
      job.controller.abort();
      this.removeDraft(job);
    }
    this.inflight = {};
    this.autoQueue = [];
    this.speculation = null;
  }
  ingest(segment) {
    if (this.status !== "running") return false;
    if (this.activeTimeMs() >= this.config.maxSessionMs) {
      this.end();
      this.error(
        "Session time limit reached. Start a new session to continue.",
      );
      return false;
    }
    if (this.activeTimeMs() >= this.config.warnSessionMs) this.warnDuration();
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
        : this.activeTimeMs(),
      endMs: Number.isFinite(segment.endMs) ? segment.endMs : undefined,
      gap: segment.gap === true,
      receivedAt: this.clock(),
    };
    // On speakers, retain the system transcript and remove the microphone echo.
    for (const other of this.transcript.values()) {
      if (echoMatch(row, other)) {
        if (row.channel === "mic") return false;
        this.transcript.delete(other.id);
        this.commitments = this.commitments.filter(
          (c) => c.segmentId !== other.id,
        );
      }
    }
    this.transcript.set(row.id, row);
    const own = isOwnTurn(row, this.settings.userName);
    if (own && this.userSpeechAt === null) this.userSpeechAt = this.clock();
    if (row.final) {
      this.revision++;
      this.trackStructure(row);
      if (!own && !row.gap && !prior?.final) this.otherTurns++;
      if (!own) this.userSpeechAt = null;
      if (this.speculation?.row.id === row.id) {
        clearTimeout(this.timers.partial);
        delete this.timers.partial;
        if (editRatio(this.speculation.row.text, row.text) <= 0.15) {
          this.speculation.row = row;
          const job = this.inflight.fast;
          if (job?.turnId === row.id) {
            job.trigger = this.triggerFor(row);
            job.latency.turnEndedAt = row.receivedAt;
          }
          for (const card of this.cards.filter(
            (c) => c.trigger?.segmentId === row.id,
          )) {
            card.trigger = this.triggerFor(row);
            card.latency.turnEndedAt = row.receivedAt;
          }
          this.handledTurns.add(row.id);
        } else {
          if (this.inflight.fast?.turnId === row.id)
            this.inflight.fast.controller.abort();
          this.cards = this.cards.filter(
            (c) => c.trigger?.segmentId !== row.id,
          );
          this.handledTurns.delete(row.id);
          this.speculation = null;
          this.consider(row, true);
        }
      } else this.consider(row);
    } else if (
      !this.settings.quiet &&
      this.config.autoCoach &&
      completePartial(row, this.settings.mode, this.settings.userName)
    ) {
      clearTimeout(this.timers.partial);
      this.timers.partial = setTimeout(() => {
        delete this.timers.partial;
        if (
          this.status !== "running" ||
          this.transcript.get(row.id)?.final ||
          this.handledTurns.has(row.id)
        )
          return;
        this.speculation = { row };
        this.consider(row);
      }, 250);
    }
    this.emitState();
    return true;
  }
  triggerFor(row) {
    return row
      ? {
          speaker: row.speaker,
          text: row.text,
          segmentId: row.id,
          endedAtMs: row.endMs ?? row.startMs,
          turnEndedAt: row.receivedAt,
        }
      : null;
  }
  trackStructure(row) {
    if (row.gap) return;
    for (const point of this.prep?.myPoints || []) {
      const wanted = terms(point.text || point.label),
        actual = new Set(terms(row.text));
      if (
        wanted.length &&
        wanted.filter((t) => actual.has(t)).length / wanted.length >= 0.6
      )
        this.covered.add(point.id);
    }
    if (
      /\b(i.ll|i will|we.ll|we will|i can send|let.s|by (monday|tuesday|wednesday|thursday|friday))\b/i.test(
        row.text,
      )
    ) {
      if (!this.commitments.some((c) => c.segmentId === row.id))
        this.commitments.push({
          owner: row.speaker,
          what: row.text,
          due: row.text.match(/\bby\s+[^,.!?]+/i)?.[0] || "Not stated",
          segmentId: row.id,
        });
    }
  }
  consider(row, restart = false) {
    if (
      !this.config.autoCoach ||
      this.settings.quiet ||
      row.gap ||
      isOwnTurn(row, this.settings.userName) ||
      this.handledTurns.has(row.id)
    )
      return;
    const normalized = normalize(row.text),
      now = this.clock();
    for (const [text, at] of this.answered)
      if (now - at > 180000) this.answered.delete(text);
    if (this.answered.has(normalized)) return;
    let kind = classifyTurn(row, this.settings.mode, this.settings.userName);
    if (kind === "wrap_up" && this.coverageReminder(row)) {
      this.handledTurns.add(row.id);
      this.answered.set(normalized, now);
      return;
    }
    if (
      !kind &&
      !isBackchannel(row.text) &&
      row.final &&
      normalized.split(" ").length >= 4 &&
      now - this.lastBackground >= 45000
    ) {
      kind = "background";
      this.lastBackground = now;
    }
    if (!kind) return;
    if (!restart) {
      const rate = consumeToken(this.rate, now);
      this.rate = rate.state;
      if (!rate.allowed) return;
    }
    this.handledTurns.add(row.id);
    const opts = {
      trigger: this.triggerFor(row),
      turnId: row.id,
      triggerKind: kind,
    };
    if (this.inflight.fast && !this.inflight.fast.controller.signal.aborted)
      this.autoQueue.push(opts);
    else void this.run("fast", "", opts).catch((error) => this.error(error));
    if (kind === "decision" && now - this.lastSlow >= 120000) {
      this.lastSlow = now;
      void this.run("strategy", "", opts).catch((error) => this.error(error));
    }
  }
  schedule(lane) {
    // Retained for alternate providers and tests; proactive timing lives in consider().
    if (
      !this.config.autoCoach ||
      this.settings.quiet ||
      this.status !== "running"
    )
      return;
    const row = [...this.transcript.values()]
      .filter((r) => r.final && !isOwnTurn(r, this.settings.userName))
      .at(-1);
    if (row) this.consider(row);
  }
  coverageReminder(row) {
    const remaining = (this.prep?.myPoints || []).filter(
      (p) => !this.covered.has(p.id),
    );
    if (!remaining.length) return false;
    const now = this.clock();
    this.cards.push({
      id: randomUUID(),
      lane: "fast",
      origin: "auto",
      kind: "heads_up",
      lead: "Before we finish, I want to cover the remaining points.",
      points: remaining
        .slice(0, 3)
        .map((p) => ({ label: "Cover", text: words(p.text, 12) })),
      sourceIds: [],
      sources: [],
      covers: [],
      status: "new",
      trigger: this.triggerFor(row),
      createdAt: now,
      expiresAt: now + this.config.fastTTL,
      otherTurn: this.otherTurns,
      demo: this.source === "demo",
      latency: {
        turnEndedAt: row.receivedAt,
        requestedAt: now,
        firstTokenAt: now,
        firstPaintAt: now,
        doneAt: now,
      },
    });
    this.cards = this.cards.slice(-300);
    return true;
  }
  async run(
    lane = "fast",
    question = "",
    {
      origin = question ? "asked" : "auto",
      presentationLane = lane,
      trigger = null,
      turnId = "",
      triggerKind = "",
    } = {},
  ) {
    const explicit = origin !== "auto";
    if (!["fast", "strategy"].includes(lane))
      throw new Error("Unknown coaching lane.");
    if (this.status !== "running")
      throw new Error("Start or resume the session first.");
    if (this.activeTimeMs() >= this.config.maxSessionMs) {
      this.end();
      throw new Error(
        "Session time limit reached. Export and create a new session.",
      );
    }
    if (explicit) {
      for (const [key, job] of Object.entries(this.inflight))
        if (job.origin === "auto" || key === lane) {
          job.controller.abort();
          this.removeDraft(job);
          delete this.inflight[key];
        }
      clearTimeout(this.timers.partial);
      this.autoQueue = [];
      this.speculation = null;
    } else if (
      this.inflight[lane] &&
      !this.inflight[lane].controller.signal.aborted
    )
      return { busy: true };
    const metric = `${lane}Calls`;
    if (!this.providers[lane]) {
      if (explicit) this.fallback(question, origin, presentationLane);
      this.error(`${lane} provider is not configured.`);
      return;
    }
    if (
      !explicit &&
      this.metrics[metric] >=
        this.config[lane === "fast" ? "maxFast" : "maxStrategy"]
    ) {
      this.error(`${lane} call limit reached for this session.`);
      return;
    }
    const rows = [...this.transcript.values()]
      .filter((r) => r.final)
      .sort((a, b) => a.startMs - b.startMs);
    if (!rows.length && !question && !trigger) return;
    trigger = explicit
      ? {
          speaker: "You",
          text: question,
          segmentId: "",
          endedAtMs: this.activeTimeMs(),
          turnEndedAt: this.clock(),
        }
      : trigger || this.triggerFor(rows.at(-1));
    const epoch = this.epoch,
      revision = this.revision,
      start = this.clock();
    const job = {
      id: ++this.jobs,
      controller: new AbortController(),
      presentationLane,
      origin,
      trigger,
      turnId,
      cardId: randomUUID(),
      latency: {
        turnEndedAt: trigger?.turnEndedAt ?? start,
        requestedAt: start,
        firstTokenAt: null,
        firstPaintAt: null,
        doneAt: null,
      },
    };
    this.inflight[lane] = job;
    this.lastRun[lane] = start;
    this.metrics[metric]++;
    this.diagnostics("provider.request", { lane, origin, requestedAt: start });
    const recent = rows
        .slice(-8)
        .map((r) => r.text)
        .join(" "),
      query = `${question} ${trigger?.text || recent}`;
    let sources = this.context.search(query, {
      project: this.settings.project,
    });
    const materials = [...this.context.docs.values()].filter(
      (d) => !d.project || d.project === this.settings.project,
    );
    const live = () =>
      epoch === this.epoch &&
      this.inflight[lane]?.id === job.id &&
      !job.controller.signal.aborted &&
      this.status === "running";
    this.emitState();
    try {
      // Connected research is slow and runs during a call only when explicitly asked.
      if (
        explicit &&
        lane === "strategy" &&
        this.settings.autoSearch &&
        this.retriever
      ) {
        try {
          const docs = await this.retriever({
            query: question.slice(0, 1500),
            recent: [{ text: question }],
            project: this.settings.project,
            sessionId: this.sessionId,
            signal: job.controller.signal,
          });
          if (!live()) return;
          for (const doc of docs)
            materials.push(
              this.context.add({ ...doc, project: this.settings.project }),
            );
          sources = materials.map(({ text, ...d }) => ({
            ...d,
            excerpt: text,
          }));
        } catch (error) {
          if (job.controller.signal.aborted) return;
          this.log(
            "context",
            "Related notes were unavailable; using loaded materials.",
          );
        }
      }
      const prompt = makePrompt({
        lane,
        ...this.settings,
        transcript: rows,
        sources,
        materials,
        question,
        trigger: job.trigger,
        previousCards: this.cards,
        prep: this.prep,
        summary: this.summary,
        commitments: this.commitments,
        covered: [...this.covered],
        triggerKind,
      });
      const full = prompt.materialBudget.full;
      if (full)
        sources = materials.map(({ text, ...d }) => ({ ...d, excerpt: text }));
      const result = await this.providers[lane].generate({
        lane,
        prompt,
        transcript: rows,
        sources,
        question,
        signal: job.controller.signal,
        onToken: (at) => {
          job.latency.firstTokenAt ??= at ?? this.clock();
        },
        onPartial: (partial) => {
          if (
            !live() ||
            partial.speak !== true ||
            !partial.lead ||
            partial.kind === "fact"
          )
            return;
          const now = this.clock();
          job.latency.firstTokenAt ??= now;
          job.latency.firstPaintAt ??= now;
          job.late ??= this.isLate(job, explicit);
          const late = job.late;
          const previous = this.cards.find((c) => c.id === job.cardId);
          if (previous?.status === "dismissed") return;
          const draft = {
            id: job.cardId,
            lane: presentationLane,
            computedLane: lane,
            origin,
            question,
            trigger: job.trigger,
            kind: partial.kind || "say",
            lead: words(
              partial.lead,
              partial.kind === "bigger_picture" ? 18 : 16,
            ),
            points: [],
            sourceIds: [],
            sources: [],
            status: previous?.status || "new",
            pinned: previous?.pinned || false,
            createdAt: start,
            expiresAt: start + this.config[`${lane}TTL`],
            streaming: true,
            late,
            otherTurn: this.otherTurns,
            latency: { ...job.latency },
            demo: this.source === "demo",
          };
          const index = this.cards.findIndex((c) => c.id === job.cardId);
          if (index < 0) this.cards.push(draft);
          else this.cards[index] = draft;
          this.emitState();
        },
      });
      if (!live()) {
        this.removeDraft(job);
        return;
      }
      this.clearErrors({ condition: `provider:${lane}`, emit: false });
      this.metrics.inputTokens += Number(result.usage?.input_tokens || 0);
      this.metrics.outputTokens += Number(result.usage?.output_tokens || 0);
      this.recordUsage?.(result.usage, lane);
      if (
        !explicit &&
        !this.isLate(job, false) &&
        (this.clock() - start > this.config[`${lane}TTL`] ||
          this.revision - revision > (lane === "fast" ? 5 : 25))
      ) {
        this.removeDraft(job);
        this.metrics.discarded++;
        return;
      }
      const allowed = new Set(sources.map((s) => s.id));
      const draftState = this.cards.find((c) => c.id === job.cardId);
      this.removeDraft(job);
      let shown = false;
      for (const card of validateAdvice(result)) {
        if (
          (card.kind === "fact" && !card.sourceIds.length) ||
          card.sourceIds.some((id) => !allowed.has(id))
        ) {
          this.metrics.discarded++;
          continue;
        }
        if (!explicit && this.isDuplicate(card)) continue;
        const now = this.clock();
        job.latency.firstTokenAt ??= now;
        job.latency.firstPaintAt ??= now;
        job.latency.doneAt = now;
        const late = job.late ?? this.isLate(job, explicit);
        this.cards.push({
          ...card,
          id: job.cardId,
          lane: presentationLane,
          computedLane: lane,
          origin,
          question,
          trigger: job.trigger,
          createdAt: now,
          expiresAt: now + this.config[`${lane}TTL`],
          latencyMs: now - start,
          latency: { ...job.latency },
          basedOnRevision: revision,
          status: draftState?.status || "new",
          pinned: draftState?.pinned || false,
          sources: sources.filter((s) => card.sourceIds.includes(s.id)),
          late,
          otherTurn: this.otherTurns,
          demo: this.source === "demo",
        });
        for (const id of card.covers)
          if (this.prep?.myPoints?.some((p) => p.id === id))
            this.covered.add(id);
        shown = true;
        this.latencies.push({ ...job.latency, lane, origin });
        this.latencies = this.latencies.slice(-200);
        this.diagnostics("coaching.latency", {
          ...job.latency,
          lane,
          origin,
          latencyMs: job.latency.firstPaintAt - job.latency.turnEndedAt,
          late,
        });
      }
      if (shown && !explicit && trigger?.text)
        this.answered.set(normalize(trigger.text), this.clock());
      if (explicit && !shown)
        this.fallback(question, origin, presentationLane, job);
      this.cards = this.cards.slice(-300);
      return { ok: true };
    } catch (error) {
      this.removeDraft(job);
      if (epoch === this.epoch && !job.controller.signal.aborted) {
        if (explicit) this.fallback(question, origin, presentationLane, job);
        this.error(error, { condition: `provider:${lane}` });
      }
    } finally {
      if (this.inflight[lane]?.id === job.id) delete this.inflight[lane];
      if (
        epoch === this.epoch &&
        this.status === "running" &&
        lane === "fast" &&
        this.autoQueue.length &&
        !this.inflight.fast
      ) {
        const next = this.autoQueue.shift();
        void this.run("fast", "", next).catch((error) => this.error(error));
      }
      this.emitState();
    }
  }
  isLate(job, explicit) {
    return (
      !explicit &&
      this.clock() - job.latency.turnEndedAt > 6000 &&
      this.userSpeechAt !== null &&
      this.clock() - this.userSpeechAt >= 3000
    );
  }
  removeDraft(job) {
    this.cards = this.cards.filter((c) => c.id !== job.cardId || !c.streaming);
  }
  fallback(question, origin, lane, job = {}) {
    const now = this.clock();
    this.cards.push({
      id: job.cardId || randomUUID(),
      lane,
      origin,
      question,
      trigger: job.trigger || { speaker: "You", text: question },
      kind: "say",
      lead: "I need more verified context to help with that.",
      points: [
        {
          label: "Try",
          text: "Add your notes or ask a more specific question.",
        },
      ],
      title: "More context needed",
      body: "I don't have enough verified context to answer yet. Add your notes or ask a more specific question.",
      say: "",
      sourceIds: [],
      sources: [],
      covers: [],
      status: "new",
      createdAt: now,
      expiresAt: now + this.config.fastTTL,
      latency: job.latency || {},
      otherTurn: this.otherTurns,
      demo: this.source === "demo",
    });
  }
  isDuplicate(card) {
    const current = new Set(
      terms(
        (card.legacyShape ? card.title : card.lead || card.title) +
          " " +
          (card.more || card.body),
      ),
    );
    return [...this.cards.slice(-20), ...this.dismissed.slice(-20)].some(
      (old) => {
        if (
          (card.legacyShape
            ? old.title || ""
            : old.lead || old.title || ""
          ).toLowerCase() ===
          (card.legacyShape
            ? card.title || ""
            : card.lead || card.title || ""
          ).toLowerCase()
        )
          return true;
        const prev = new Set(
          terms(
            (old.legacyShape ? old.title : old.lead || old.title) +
              " " +
              (old.more || old.body),
          ),
        );
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
  activeTimeMs() {
    return (
      this.activeMs +
      (this.activeStartedAt === null
        ? 0
        : Math.max(0, this.clock() - this.activeStartedAt))
    );
  }
  freezeClock() {
    this.activeMs = this.activeTimeMs();
    this.activeStartedAt = null;
  }
  warnDuration() {
    if (this.durationWarned || this.status !== "running") return;
    this.durationWarned = true;
    this.error(
      "This call has been running for two hours. Callwise can continue for another two hours.",
      { severity: "warning", lifetimeMs: 60000 },
    );
  }
  clearErrors({ id, condition, prefix, emit = true } = {}) {
    this.errors = this.errors.filter((error) =>
      id
        ? error.id !== id
        : condition
          ? error.condition !== condition
          : prefix
            ? !error.condition?.startsWith(prefix)
            : false,
    );
    if (emit) this.emitState();
  }
  error(
    error,
    { condition = "", lifetimeMs = 30000, severity = "error" } = {},
  ) {
    const safe = String(error?.message || error).slice(0, 400);
    this.diagnostics("provider.error", {
      status: error?.status,
      code: error?.code,
      type: error?.type,
    });
    if (
      this.errors.at(-1)?.message === safe &&
      this.clock() - this.errors.at(-1).at < 10000
    )
      return;
    this.errors.push({
      id: randomUUID(),
      message: safe,
      at: this.clock(),
      expiresAt: lifetimeMs === null ? null : this.clock() + lifetimeMs,
      condition,
      severity,
      action: error?.action || "",
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
      activeTimeMs: this.activeTimeMs(),
      snapshotAt: this.clock(),
      settings: {
        ...this.settings,
        contextApps: [...this.settings.contextApps],
      },
      revision: this.revision,
      prep: this.prep,
      summary: this.summary,
      commitments: this.commitments,
      covered: [...this.covered],
      otherTurns: this.otherTurns,
      latencies: this.latencies.map((l) => ({ ...l })),
      transcript: [...this.transcript.values()].sort(
        (a, b) => a.startMs - b.startMs,
      ),
      cards: this.cards.map((c) => ({
        ...c,
        expired: this.clock() > c.expiresAt,
      })),
      context: this.context.list(),
      metrics: { ...this.metrics },
      errors: this.errors.filter(
        (error) => error.expiresAt === null || error.expiresAt > this.clock(),
      ),
      activity: [...this.activity],
      pendingTrigger:
        (
          this.inflight.fast ||
          Object.values(this.inflight).find(
            (job) => job.presentationLane === "fast",
          )
        )?.trigger || null,
      thinking: {
        fast:
          !!this.inflight.fast ||
          Object.values(this.inflight).some(
            (job) => job.presentationLane === "fast",
          ),
        strategy: !!this.inflight.strategy,
      },
      limits: { fast: this.config.maxFast, strategy: this.config.maxStrategy },
    };
  }
  emitState() {
    if (this.diagnosticStatus !== this.status) {
      this.diagnosticStatus = this.status;
      this.diagnostics?.("session.state", { state: this.status });
    }
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
        c.lead || c.body,
        c.trigger?.text
          ? `Responding to ${c.trigger.speaker || "the call"}: ${c.trigger.text}`
          : "",
        ...(c.points || []).map((p) => `- ${p.label}: ${p.text}`),
        c.more && c.more !== c.lead ? c.more : "",
        c.legacyShape && c.say ? `Suggested wording: ${c.say}` : "",
        c.late ? "Late suggestion — kept in history." : "",
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
