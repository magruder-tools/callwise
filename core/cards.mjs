import { randomUUID } from "node:crypto";

export const CUE_ICONS = ["number", "person", "decision", "caution", "ask", "time", "money", "place"];
export const wordCount = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;
export const SELF_NOTE = /\b(?:i (?:need|want|have) to (?:recall|remember|check|verify)|i (?:don't|do not) want to overstate|i['’]d (?:want|need|explain|surface)|add (?:one |a )?(?:specific|example|detail)|recall|remember to|credit the team|insert|fill in|be precise about my role)\b/i;
export function validSay(text) {
  return typeof text === "string" && wordCount(text) <= 24 && wordCount(text) >= 3 &&
    /\b(?:I|I['’]m|I['’]ve|my|we|our)\b/i.test(text) && /[.!?]["'’”]?$/u.test(text) &&
    !/[;:]\s*$/.test(text) && !SELF_NOTE.test(text) &&
    !/\b(?:though|perhaps|maybe|i think i|i would want|i should)\b/i.test(text) &&
    !/[.!?]\s+[A-Z]/.test(text.replace(/\b(?:Mr|Ms|Dr)\./g, ""));
}
export function frameFor(question = "") {
  if (/\b(?:but|disagree|concern|convince|why should|not convinced|doubt|objection)\b/i.test(question))
    return ["Acknowledge", "Reframe", "Proof"];
  if (/\b(?:tell|time|example|experience|did|have you|handled|result|proud)\b/i.test(question))
    return ["Situation", "Your move", "Result"];
  return ["Your view", "Why", "One example"];
}
export function guardCard(input, { question = "", onGap = () => {} } = {}) {
  // Both old provider adapters and version 3 cards pass through this boundary.
  const say = String(input.say ?? input.lead ?? "").trim();
  const rawCues = input.cues || (input.points || []).map((p) => ({ icon: "decision", text: typeof p === "string" ? p : p.text }));
  const cues = rawCues.filter((c) => {
    const valid = typeof c?.text === "string" && c.text.trim() && wordCount(c.text) <= 5 &&
      !SELF_NOTE.test(c.text) && !/[;:]\s*$/.test(c.text) && !/^(?:check|add|explain|mention|use|say|avoid|make sure)\b/i.test(c.text);
    if (!valid) onGap(c?.text || "A cue needs a verified detail.");
    return valid;
  }).slice(0, 3).map((c) => ({ icon: CUE_ICONS.includes(c.icon) ? c.icon : "decision", text: c.text.trim() }));
  const safe = validSay(say);
  return {
    id: String(input.id || randomUUID()), source: input.source || "none",
    say: safe ? say : "", frame: safe ? [] : frameFor(question), cues,
    askBack: typeof input.askBack === "string" ? input.askBack : null,
    proof: input.proof || null, sources: (input.sources || []).map(({ id, title }) => ({ id: String(id), title: String(title) })),
    pinned: input.pinned === true, createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
  };
}
export function preparedCard(card, pack, at = Date.now(), source = "prepared") {
  const story = pack.stories.find((s) => s.id === card.storyId);
  return guardCard({ ...card, id: `${pack.id}:${card.id}`, source, createdAt: at,
    sources: (story?.sources || []).map((s, i) => ({ id: `${story.id}:${i}`, title: s.title })) }, { question: card.questions[0] });
}
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
