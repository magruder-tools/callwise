import { randomUUID } from "node:crypto";

const STOP = new Set(
  "a an the and or to of for in on at with is are was were it this that be we you i my our they their from have has what how can should would could".split(
    " ",
  ),
);
export const terms = (text) =>
  (
    String(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu) || []
  ).filter((t) => !STOP.has(t));
export function safeUrl(value) {
  if (!value) return "";
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}
export class ContextStore {
  constructor() {
    this.docs = new Map();
  }
  add(input) {
    if (!input || typeof input.text !== "string" || !input.text.trim())
      throw new Error("Add a document with text.");
    if (input.text.length > 250_000)
      throw new Error("Keep each document below 250,000 characters.");
    if (this.docs.size >= 150 && !this.docs.has(input.id))
      throw new Error("This session supports up to 150 context documents.");
    const id = input.id || randomUUID();
    const doc = {
      id,
      title: String(input.title || "Untitled note").slice(0, 200),
      text: input.text.trim(),
      url: safeUrl(input.url),
      kind: String(input.kind || "note").slice(0, 40),
      project: String(input.project || "").slice(0, 100),
      updatedAt:
        input.kind === "connector"
          ? null
          : input.updatedAt || new Date().toISOString(),
      ...(input.provenance?.provider === "codex"
        ? {
            provenance: { ...input.provenance },
            retrievedAt: input.retrievedAt,
          }
        : {}),
    };
    this.docs.set(id, doc);
    return doc;
  }
  list() {
    return [...this.docs.values()].map(({ text, ...d }) => ({
      ...d,
      characters: text.length,
    }));
  }
  get(id) {
    return this.docs.get(id);
  }
  clear() {
    this.docs.clear();
  }
  search(query, { project = "", limit = 5, maxCharacters = 10000 } = {}) {
    const queryTerms = [...new Set(terms(query))].slice(0, 60);
    if (!queryTerms.length) return [];
    const hits = [];
    for (const doc of this.docs.values()) {
      if (doc.project && doc.project !== project) continue;
      const titleTerms = new Set(terms(doc.title));
      const chunks = doc.text.match(/[\s\S]{1,1800}/g) || [];
      let best = null;
      chunks.forEach((text, index) => {
        const ts = terms(text),
          bag = new Set(ts);
        const score =
          queryTerms.reduce(
            (n, t) => n + (bag.has(t) ? 1 : 0) + (titleTerms.has(t) ? 2 : 0),
            0,
          ) /
          (1 + ts.length / 1500);
        if (score > 0 && (!best || best.score < score))
          best = {
            id: doc.id,
            title: doc.title,
            url: doc.url,
            kind: doc.kind,
            project: doc.project,
            updatedAt: doc.updatedAt,
            ...(doc.provenance
              ? { provenance: doc.provenance, retrievedAt: doc.retrievedAt }
              : {}),
            excerpt: text,
            chunk: index,
            score,
          };
      });
      if (best) hits.push(best);
    }
    let used = 0;
    return hits
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter((hit) => {
        used += hit.excerpt.length;
        return used <= maxCharacters;
      });
  }
}
