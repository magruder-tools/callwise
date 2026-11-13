import MiniSearch from "minisearch";
import { terms } from "./context.mjs";
import { cleanQuestion } from "./triggers.mjs";

export const MATCH_BANDS = Object.freeze({ high: 0.80, margin: 0.15, middle: 0.60, stableMs: 600 });
export function matchText(text) {
  // Remove conversational requests, not topic words. Embedding a topic rather than the polite
  // wrapper also keeps "tell me about..." from making unrelated interview questions look alike.
  return String(text).trim().replace(/^(?:(?:can|could|would) you (?:please )?(?:tell (?:me|us) about|share (?:the outcome of|an example of)|give (?:me|us) an example of|discuss)|(?:tell (?:me|us)|talk to (?:me|us)) about|give (?:me|us) an example of|give an example of|walk (?:me|us) through|describe a time (?:involving|when)|what (?:is your experience with|would you highlight about)|how did you (?:approach|handle)|which story demonstrates|have you ever been responsible for|i (?:would|['’]d) like to hear how you handled)\s+/i, "").replace(/[.!?]+$/, "").trim();
}
const tokens = (s) => new Set(terms(matchText(s)).map((t) => t.replace(/(?:ing|ed|s)$/g, "")));
const unit = (v) => { const norm = Math.hypot(...v); return norm ? Float32Array.from(v, (x) => x / norm) : new Float32Array(v.length); };
const cosine = (a, b) => { if (!a?.length || a.length !== b?.length) return 0; let n = 0; for (let i = 0; i < a.length; i++) n += a[i] * b[i]; return Math.max(0, Math.min(1, n)); };
export function lexicalSimilarity(a, b) {
  const aa = tokens(a), bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  const overlap = [...aa].filter((t) => bb.has(t)).length;
  return 2 * overlap / (aa.size + bb.size);
}
export class LocalMatcher {
  constructor({ embed = null, clock = Date.now, bands = MATCH_BANDS } = {}) {
    Object.assign(this, { embed, clock, bands }); this.entries = []; this.cache = new Map(); this.generation = 0; this.stable = null; this.available = false;
  }
  async setCards(entries) {
    const generation = ++this.generation;
    this.entries = []; this.stable = null; this.available = false;
    const docs = entries.flatMap((e) => e.questions.map((q, i) => ({ id: `${e.id}#${i}`, cardId: e.id, text: matchText(q).slice(0, 4000) })));
    this.index = new MiniSearch({ fields: ["text"], storeFields: ["cardId"], tokenize: (s) => [...tokens(s)] });
    this.index.addAll(docs);
    if (!this.embed) return;
    try {
      for (let i = 0; i < docs.length; i += 32) {
        const batch = docs.slice(i, i + 32).filter((d) => !this.cache.has(d.text));
        if (batch.length) {
          const vectors = await this.embed(batch.map((d) => d.text));
          if (vectors.length !== batch.length || vectors.some((v) => !v?.length || !v.every(Number.isFinite))) throw new Error("Sentence model unavailable.");
          batch.forEach((d, j) => this.cache.set(d.text, unit(vectors[j])));
        }
        if (generation !== this.generation) return;
      }
      this.entries = entries.map((e) => ({ ...e, vectors: e.questions.map((q) => this.cache.get(matchText(q).slice(0, 4000))) }));
      this.available = true;
      // Bound memory across pack updates and ephemeral follow-ups.
      if (this.cache.size > 6000) this.cache = new Map(docs.map((d) => [d.text, this.cache.get(d.text)]));
    } catch (error) { this.error = error.message; this.entries = []; }
  }
  async rank(text) {
    if (!this.available || !this.entries.length) return [];
    const q = matchText(cleanQuestion(text) || text).slice(-4000), vector = unit((await this.embed([q]))[0] || []);
    const lexicalHits = new Map(this.index.search(q, { prefix: false, fuzzy: 0.1 }).map((h) => [h.cardId, h.score]));
    return this.entries.map((e) => {
      const semantic = Math.max(...e.vectors.map((v) => cosine(vector, v)));
      const lexical = lexicalHits.has(e.id) ? Math.max(...e.questions.map((p) => lexicalSimilarity(q, p))) : 0;
      return { cardId: e.id, score: 0.75 * semantic + 0.25 * lexical, semantic, lexical, entry: e };
    }).sort((a, b) => b.score - a.score || a.cardId.localeCompare(b.cardId));
  }
  async match(text, { turnId = "", now = this.clock() } = {}) {
    const ranked = await this.rank(text), top = ranked[0];
    if (!top) return { cardId: null, score: 0, margin: 0, stableMs: 0, questionComplete: !!cleanQuestion(text) || tokens(text).size >= 5, candidates: [] };
    if (this.stable?.cardId !== top.cardId || this.stable.turnId !== turnId) this.stable = { cardId: top.cardId, turnId, since: now };
    return { cardId: top.cardId, score: top.score, margin: top.score - (ranked[1]?.score || 0), stableMs: now - this.stable.since,
      questionComplete: /[?？]/.test(text) || tokens(text).size >= 5, candidates: ranked.slice(0, 5) };
  }
}
