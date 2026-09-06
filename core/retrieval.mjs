import { EventEmitter } from "node:events";
import { terms } from "./context.mjs";

// Cheap, deterministic gating. No extra model calls just to decide whether to search.
export function shouldSearch({
  query = "",
  recent = [],
  project = "",
  manual = false,
} = {}) {
  if (manual) return !!query.trim();
  if (!project.trim()) return false;
  const text = recent
    .slice(-3)
    .map((r) => r.text || "")
    .join(" ");
  return /\b(previously|last (?:call|meeting|time)|did we (?:agree|decide)|(?:you|we|they|he|she) (?:emailed|sent|promised)|(?:email|document|proposal|contract|brief|notes|notion|drive|slack) (?:says?|said|mentions?|shows?)|(?:check|find|look up|search|remember|recall).{0,80}(?:email|document|proposal|contract|notes|agreed|decided)|what (?:was|were|did).{0,70}(?:agree|decide|promise))\b/i.test(
    text,
  );
}
const similar = (a, b) => {
  const aa = new Set(terms(a)),
    bb = new Set(terms(b));
  return (
    [...aa].filter((t) => bb.has(t)).length /
      Math.max(1, new Set([...aa, ...bb]).size) >=
    0.82
  );
};
export class ContextRetrieval extends EventEmitter {
  constructor({
    provider,
    clock = Date.now,
    maxSearches = 20,
    cooldownMs = 45000,
    cacheMs = 180000,
  } = {}) {
    super();
    Object.assign(this, { provider, clock, maxSearches, cooldownMs, cacheMs });
    this.generation = 0;
    this.reset();
  }
  snapshot() {
    return { ...this.state, limit: this.maxSearches };
  }
  update(patch) {
    Object.assign(this.state, patch);
    this.emit("state", this.snapshot());
  }
  reset() {
    this.cancel();
    this.cache = new Map();
    this.scope = "";
    this.lastAuto = -Infinity;
    this.lastQuery = "";
    this.state = {
      status: "idle",
      detail: "Choose apps in Connections to search your context.",
      searches: 0,
      cacheHits: 0,
      sources: 0,
      lastRetrievedAt: null,
    };
  }
  cancel() {
    this.generation++;
    this.pending?.abort();
    this.pending = null;
    this.provider?.cancel();
    if (this.state?.status === "searching")
      this.update({ status: "idle", detail: "Context search stopped." });
  }
  invalidate() {
    this.cancel();
    this.cache.clear();
    this.lastQuery = "";
    this.lastAuto = -Infinity;
  }
  async search({
    query,
    project = "",
    sessionId,
    appIds = [],
    recent = [],
    manual = false,
    signal,
  } = {}) {
    if (!this.provider)
      throw new Error("Codex context is available in the desktop app.");
    const text = String(query || "")
      .trim()
      .slice(0, 2000);
    if (manual && !text) throw new Error("Enter a context question first.");
    if (!shouldSearch({ query: text, project, recent, manual })) return [];
    if (!appIds.length)
      throw new Error("Select your context apps in Connections first.");
    signal?.throwIfAborted();
    const scope = JSON.stringify([sessionId, project, [...appIds].sort()]);
    if (scope !== this.scope) {
      this.invalidate();
      this.scope = scope;
    }
    const key = `${scope}:${text.toLowerCase().replace(/\s+/g, " ")}`;
    const now = this.clock(),
      cached = this.cache.get(key);
    if (cached && now < cached.until) {
      this.update({
        status: cached.docs.length ? "cached" : "empty",
        detail: cached.docs.length
          ? "Reusing this session's recent verified excerpts."
          : "The recent lookup found no verified matching sources.",
        sources: cached.docs.length,
        cacheHits: this.state.cacheHits + 1,
      });
      return structuredClone(cached.docs);
    }
    if (this.pending) {
      if (!manual) return [];
      throw new Error(
        "A context lookup is already running. Cancel it before starting another.",
      );
    }
    if (
      !manual &&
      (now - this.lastAuto < this.cooldownMs ||
        (now - this.lastAuto < this.cacheMs && similar(text, this.lastQuery)))
    )
      return [];
    if (this.state.searches >= this.maxSearches) {
      this.update({
        status: "limited",
        detail:
          "Context lookup limit reached. Loaded sources remain available.",
      });
      return [];
    }
    const request = new AbortController();
    this.pending = request;
    const generation = this.generation;
    const combined = signal
      ? AbortSignal.any([signal, request.signal])
      : request.signal;
    this.lastAuto = now;
    this.lastQuery = text;
    this.update({
      status: "searching",
      detail: "Looking for relevant evidence in your selected apps…",
      searches: this.state.searches + 1,
    });
    try {
      const docs = await this.provider.search({
        query: text,
        project,
        sessionId,
        appIds,
        signal: combined,
        onStatus: (detail) => {
          if (!combined.aborted && generation === this.generation)
            this.update({ detail });
        },
      });
      combined.throwIfAborted();
      if (generation !== this.generation)
        throw new Error(
          "Context search cancelled because the session changed.",
        );
      this.cache.set(key, {
        docs: structuredClone(docs),
        until: this.clock() + (docs.length ? this.cacheMs : 45000),
      });
      if (this.cache.size > 30)
        this.cache.delete(this.cache.keys().next().value);
      this.update({
        status: docs.length ? "ready" : "empty",
        detail: docs.length
          ? `${docs.length} source(s) verified against actual connector results.`
          : "No verified matching sources found. No facts were invented.",
        sources: docs.length,
        lastRetrievedAt: this.clock(),
      });
      return docs;
    } catch (error) {
      if (generation === this.generation)
        this.update({
          status: combined.aborted ? "idle" : "error",
          detail: combined.aborted
            ? "Context search stopped."
            : String(error.message || "Context search failed.").slice(0, 300),
        });
      throw error;
    } finally {
      if (this.pending === request) this.pending = null;
    }
  }
}
