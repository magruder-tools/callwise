import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { validSay, guardCard, SELF_NOTE, CUE_ICONS } from "./cards.mjs";

export const PACK_LIMITS = { json: 2 * 1024 * 1024, cards: 200, tiles: 40, image: 5 * 1024 * 1024 };
export const PACK_NAMESPACE = "prep-packs";
const ID = /^[a-zA-Z0-9_.:-]{1,180}$/;
const text = (v, max = 20000) => typeof v === "string" && v.length <= max;
const fail = (message) => { throw new Error(`Invalid prep pack: ${message}`); };
const arr = (v, name, max = 200) => { if (!Array.isArray(v) || v.length > max) fail(name); return v; };
function strings(v, name, max = 200, length = 2000) {
  if (arr(v, name, max).some((s) => !text(s, length))) fail(name);
}
function ids(v, name) {
  const seen = new Set();
  for (const x of v) {
    if (!x || !ID.test(x.id) || seen.has(x.id)) fail(`${name} IDs must be unique.`);
    seen.add(x.id);
  }
  return seen;
}
export function validateProof(proof) {
  if (proof === null) return;
  if (!proof || typeof proof !== "object") fail("proof");
  if (proof.type === "number_bars") {
    if (!text(proof.value, 100) || !text(proof.label, 500) ||
      [proof.before, proof.after].some((v) => v !== undefined && typeof v !== "number" && !text(v, 100))) fail("number proof");
  } else if (proof.type === "beats") {
    if (!text(proof.title, 500)) fail("beats title");
    for (const b of arr(proof.beats, "beats", 12))
      if (!text(b.label, 100) || !text(b.text, 500) || (b.highlight !== undefined && typeof b.highlight !== "boolean")) fail("beat");
  } else if (proof.type === "scope") {
    if (!text(proof.title, 500)) fail("scope title");
    for (const s of arr(proof.stats, "stats", 12))
      if (!text(s.value, 100) || !text(s.label, 500)) fail("scope stat");
  } else if (proof.type === "image") {
    if (!ID.test(proof.tileId)) fail("image tile ID");
  } else fail("unknown proof type");
}
export function validatePack(value) {
  let p;
  try {
    const encoded = typeof value === "string" ? value : JSON.stringify(value);
    if (Buffer.byteLength(encoded) > PACK_LIMITS.json) fail("JSON exceeds 2 MB.");
    p = JSON.parse(encoded);
  } catch (e) { if (e.message.startsWith("Invalid prep pack:")) throw e; fail("JSON could not be read."); }
  if (p?.callwisePack !== 1) fail("unsupported version; expected callwisePack 1.");
  const keys = ["callwisePack", "id", "createdBy", "meeting", "points", "stories", "cards", "facts", "questionsForThem", "gaps", "glossary", "tiles"];
  if (Object.keys(p).some((k) => !keys.includes(k)) || keys.some((k) => p[k] === undefined)) fail("unexpected or missing fields.");
  if (!ID.test(p.id) || !text(p.createdBy, 200)) fail("id or createdBy");
  const m = p.meeting;
  if (!m || !text(m.title, 2000) || !text(m.goal, 2000) || !["interview", "sales", "client", "other"].includes(m.type) ||
    (m.start !== null && (!text(m.start, 100) || !Number.isFinite(Date.parse(m.start))))) fail("meeting");
  for (const person of arr(m.people, "people", 100))
    if (![person.name, person.role, person.org].every((s) => text(s, 500))) fail("person");
  strings(p.points, "points"); strings(p.questionsForThem, "questionsForThem"); strings(p.glossary, "glossary", 300, 100);
  const storyIds = ids(arr(p.stories, "stories"), "story"), cardIds = ids(arr(p.cards, "cards", 200), "card");
  ids(arr(p.facts, "facts"), "fact"); ids(arr(p.gaps, "gaps"), "gap"); ids(arr(p.tiles, "tiles", 40), "tile");
  for (const s of p.stories) {
    if (!text(s.title, 2000) || !text(s.result)) fail("story");
    for (const n of arr(s.numbers, "numbers", 50)) if (![n.label, n.value, n.period].every((v) => text(v, 500))) fail("number");
    if (!s.sources?.length) fail("every story needs a source");
    for (const src of arr(s.sources, "sources", 200)) if (![src.title, src.locator, src.quote].every((v) => text(v))) fail("story source");
  }
  for (const c of p.cards) {
    if (!["story", "view", "fact", "logistics"].includes(c.kind) || !["approved", "needs_review"].includes(c.status) || !text(c.say, 2000)) fail("card");
    strings(c.questions, "card questions", 20);
    if (!c.questions.length || !c.questions.every((q) => q.trim())) fail("card question is empty");
    for (const cue of arr(c.cues, "cues", 3)) if (!CUE_ICONS.includes(cue.icon) || !text(cue.text, 500)) fail("cue");
    for (const k of ["storyId", "backupStoryId"]) if (c[k] !== null && !storyIds.has(c[k])) fail(`unknown ${k}`);
    validateProof(c.proof);
    if (c.proof?.type === "image" && !p.tiles.some((t) => t.id === c.proof.tileId)) fail("unknown tile");
  }
  for (const f of p.facts) if (!["you", "them"].includes(f.about) || !text(f.text) || !f.source || !text(f.source.title, 2000) ||
    (!text(f.source.quote) && !text(f.source.url, 4000) && !text(f.source.locator, 2000))) fail("fact source");
  for (const g of p.gaps) if (!text(g.ask, 2000) || (g.storyId !== null && !storyIds.has(g.storyId))) fail("gap");
  for (const t of p.tiles) if (!text(t.alt, 2000) || !text(t.file, 300) || !/^tiles\/[a-zA-Z0-9_. -]+\.(?:svg|png|jpe?g|webp)$/i.test(t.file) || t.file.includes("..")) fail("tile path");
  return p;
}
export function prepGuide(now = new Date()) {
  return { prompt: readFileSync(new URL("./prep-prompt.md", import.meta.url), "utf8"),
    schema: JSON.parse(readFileSync(new URL("./pack.schema.json", import.meta.url), "utf8")), today: now.toISOString().slice(0, 10) };
}
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

// Uses the existing encrypted docs table and archive key. Backups and restore include these rows,
// and 0.5.9 can still open the library for rollback; no plaintext pack store or new key is created.
export class PackBank {
  constructor({ store = null, clock = Date.now, onChange = () => {} } = {}) {
    Object.assign(this, { store, clock, onChange }); this.memory = new Map(); this.assets = new Map(); this.openId = null; this.rebuilding = new Set();
  }
  records() { return this.store ? this.store.closed ? [] : this.store.all("docs", PACK_NAMESPACE) : [...this.memory.values()]; }
  record(id) { return !id ? null : this.store ? this.store.closed ? null : this.store.get("docs", PACK_NAMESPACE, id) : this.memory.get(id); }
  write(record) {
    if (this.requireStorage && (!this.store || this.store.closed)) throw new Error("Unlock your meeting library before saving prep packs.");
    if (this.store) this.store.put("docs", PACK_NAMESPACE, record.id, record);
    else this.memory.set(record.id, structuredClone(record));
    this.onChange(); return record;
  }
  import(value, { origin = "import", images = {} } = {}) {
    const pack = validatePack(value), hash = digest({ pack, images }), prior = this.record(pack.id);
    if (prior?.importHash === hash) return this.metadata(prior);
    const refs = {};
    for (const [filename, src] of Object.entries(images)) {
      if (typeof src !== "string" || src.length > Math.ceil(PACK_LIMITS.image * 4 / 3) + 100 || !/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/.test(src)) throw new Error("Invalid pack image.");
      if (this.requireStorage && (!this.store || this.store.closed)) throw new Error("Unlock your meeting library before saving prep packs.");
      const id = digest([pack.id, filename, src]); refs[filename] = id;
      if (this.store) this.store.put("docs", "prep-tiles", id, { packId: pack.id, src });
      else this.assets.set(id, src);
    }
    // An update is a separate reviewable revision; the approved copy remains in use.
    for (const c of pack.cards) c.status = "needs_review";
    const record = { id: pack.id, pack, images: refs, origin, updatedAt: this.clock(), importHash: hash,
      active: prior?.active || (prior?.pack.cards.some((c) => c.status === "approved") ? prior.pack : null),
      activeImages: prior?.activeImages || prior?.images || {},
      attachedMeetingId: prior?.attachedMeetingId || null, answers: {} };
    this.write(record); return this.metadata(record);
  }
  metadata(r) {
    const approved = r.pack.cards.filter((c) => c.status === "approved").length;
    return { id: r.id, title: r.pack.meeting.title, meetingStart: r.pack.meeting.start, type: r.pack.meeting.type,
      status: approved === r.pack.cards.length && approved ? "approved" : approved ? "partly_approved" : "needs_review",
      cards: r.pack.cards.length, approved, gaps: r.pack.gaps.filter((g) => !r.answers?.[g.id]).length,
      origin: r.origin, updatedAt: r.updatedAt, attachedMeetingId: r.attachedMeetingId,
      updatePending: !!r.active && digest(r.active) !== digest(r.pack) };
  }
  list() { return this.records().map((r) => this.metadata(r)).sort((a, b) => b.updatedAt - a.updatedAt); }
  usable({ meetingId, type } = {}) {
    return this.records().filter((r) => r.attachedMeetingId ? r.attachedMeetingId === meetingId : !type || r.pack.meeting.type === type || r.pack.meeting.type === "other")
      .map((r) => ({ ...r, pack: r.active || r.pack, images: r.active ? r.activeImages : r.images }));
  }
  snapshot() {
    const r = this.openId && this.record(this.openId);
    return r ? { packId: r.id, cards: r.pack.cards.map((c) => ({ id: c.id, status: c.status, question: c.questions[0], phrasings: c.questions.slice(1),
      say: c.say, cues: c.cues, proof: this.resolveProof(c.proof, r), storyTitle: r.pack.stories.find((s) => s.id === c.storyId)?.title || null,
      openGapIds: r.pack.gaps.filter((g) => g.storyId === c.storyId && !r.answers?.[g.id]).map((g) => g.id) })),
      gaps: r.pack.gaps.map((g) => ({ id: g.id, ask: g.ask, storyTitle: r.pack.stories.find((s) => s.id === g.storyId)?.title || null,
        answer: r.answers?.[g.id]?.text || null })), rebuilding: [...this.rebuilding] } : null;
  }
  resolveProof(proof, r) {
    if (proof?.type !== "image") return proof;
    const tile = r.pack.tiles.find((t) => t.id === proof.tileId), reference = tile && r.images?.[tile.file];
    const src = reference && (this.store ? this.store.get("docs", "prep-tiles", reference)?.src : this.assets.get(reference));
    return src ? { type: "image", tileId: proof.tileId, src, alt: tile.alt } : null;
  }
  async command(name, p = {}, { rebuild } = {}) {
    if (name === "bank.open") { if (!this.record(p.packId)) throw new Error("Pack not found."); this.openId = p.packId; this.onChange(); return; }
    if (name === "bank.close") { this.openId = null; this.onChange(); return; }
    const id = p.packId || this.openId, original = this.record(id);
    if (!original) throw new Error("Open a prep pack first.");
    const r = structuredClone(original), c = r.pack.cards.find((c) => c.id === p.cardId);
    if (name === "pack.remove") {
      if (this.store) this.store.remove("docs", PACK_NAMESPACE, id); else this.memory.delete(id);
      if (this.store) {
        for (const tile of this.store.all("docs", "prep-tiles")) if (tile.packId === id) this.store.remove("docs", "prep-tiles", tile.id);
      } else { for (const reference of Object.values(r.images || {})) this.assets.delete(reference); }
      if (this.openId === id) this.openId = null; this.onChange(); return;
    }
    if (name === "pack.attach") { r.attachedMeetingId = p.meetingId || null; }
    else if (name === "bank.gap.answer") {
      const gap = r.pack.gaps.find((g) => g.id === p.gapId);
      if (!gap || !text(p.answer, 10000) || !p.answer.trim()) throw new Error("Enter a gap answer.");
      r.answers ||= {}; r.answers[gap.id] = { text: p.answer.trim(), provenance: "user", at: this.clock() };
      const story = r.pack.stories.find((s) => s.id === gap.storyId);
      if (story) story.sources.push({ title: "Your gap answer", locator: `gap:${gap.id}`, quote: p.answer.trim() });
      else r.pack.facts.push({ id: `user-${gap.id}`, about: "you", text: p.answer.trim(), source: { title: "Your gap answer", locator: `gap:${gap.id}`, quote: p.answer.trim() } });
      const affected = r.pack.cards.filter((c) => c.storyId === gap.storyId);
      affected.forEach((c) => { c.status = "needs_review"; this.rebuilding.add(c.id); });
      this.write(r);
      try {
        for (const affectedCard of affected) {
          const result = await rebuild?.({ card: structuredClone(affectedCard), story, answer: p.answer.trim(), pack: r.pack });
          if (result) { const guarded = guardCard(result, { question: affectedCard.questions[0] }); affectedCard.say = guarded.say; affectedCard.cues = guarded.cues; }
        }
      } finally { affected.forEach((c) => this.rebuilding.delete(c.id)); this.write(r); }
      return;
    } else if (name === "bank.approveAll" || name === "bank.card.approve") {
      const cards = name === "bank.approveAll" ? r.pack.cards : [c];
      if (cards.some((c) => !c || !validSay(c.say))) throw new Error("Each card needs one complete first-person sentence of at most 24 words before approval.");
      for (const card of cards) {
        const guarded = guardCard(card, { question: card.questions[0], onGap: (cue) => {
          r.pack.gaps.push({ id: `guard-${randomUUID()}`, storyId: card.storyId, ask: `What verified detail replaces this cue: ${cue}?` });
        } });
        card.cues = guarded.cues; card.status = "approved";
      }
      // Approving a revision is the only route that replaces previously approved answers.
      r.active = structuredClone(r.pack);
      r.activeImages = structuredClone(r.images || {});
    } else if (name === "bank.card.edit") {
      if (!c || !text(p.say, 2000)) throw new Error("Card not found or invalid sentence.");
      c.say = p.say.trim(); c.status = "needs_review";
      if (p.cues !== undefined) { if (!Array.isArray(p.cues) || p.cues.length > 3) throw new Error("Use at most three factual cues."); c.cues = guardCard({ ...c, cues: p.cues }).cues; }
    } else if (name === "bank.phrasing.add" || name === "bank.phrasing.remove") {
      if (!c || !text(p.phrasing, 2000) || !p.phrasing.trim()) throw new Error("Enter a question phrasing.");
      if (name.endsWith(".add") && !c.questions.includes(p.phrasing.trim()) && c.questions.length < 20) c.questions.push(p.phrasing.trim());
      if (name.endsWith(".remove")) c.questions = c.questions.filter((q, i) => i === 0 || q !== p.phrasing);
    } else throw new Error("Unknown pack command.");
    r.updatedAt = this.clock(); this.write(r);
  }
}
