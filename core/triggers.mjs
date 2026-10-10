// Pure turn classification and limits. No requests, timers, or transcript storage.
export const normalize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
export function isOwnTurn(row, userName = "") {
  if (row.channel === "mic") return true;
  if (row.channel === "system") return false;
  const name = normalize(row.speaker);
  return ["you", "me", normalize(userName)].filter(Boolean).includes(name);
}
export function isBackchannel(text) {
  return /^(yeah|yes|right|okay|ok|got it|mm hm|uh huh|thanks|thank you)(\s+(yeah|yes|right|okay|ok|got it|thanks|thank you))*$/.test(
    normalize(text),
  );
}
export const isWrapUp = (text) =>
  /\b(anything else|we.re at time|wrap (up|this)|before we (go|finish)|last question)\b/i.test(
    text,
  );
export const commitmentCue = (text) =>
  /\b(?:i|we)(?:['’]ll| will| can| shall| am going to| are going to)\s+(?:send|share|get(?! into\b)(?: back)?|email|schedule|set up|introduce|connect|check|confirm|look into|follow up|circle back|put together|draft|book)\b/i.test(
    text,
  ) ||
  /\b(?:send|share|get back|email|schedule|confirm|follow up|deliver|finish|complete)\b[^.!?]{0,70}\bby\s+(?:tomorrow|next|monday|tuesday|wednesday|thursday|friday|\d)/i.test(
    text,
  );
const logistics = (text) =>
  /^(?:can you hear me|can you see my screen|is this thing on|give (?:me|us) (?:a|one) (?:second|sec|minute)|hold on|bear with me|one moment|let me share my screen)\b/i.test(
    text,
  );
function sentencesFor(text) {
  return (
    String(text || "")
      .trim()
      .match(/[^.!?？]+[.!?？]*/g) || []
  ).map((sentence) => {
    let clean = sentence.trim();
    for (let i = 0; i < 3; i++)
      clean = clean.replace(
        /^(?:so|okay|ok|right|well|and|but|great|alright|now|then|um|uh|yeah)\b[,\s]*/i,
        "",
      );
    return { original: sentence.trim(), clean };
  });
}
export function isLogisticsTurn(text) {
  const sentences = sentencesFor(text);
  return sentences.length > 0 && sentences.every((s) => logistics(s.clean));
}
export function classifyTurn(row, mode = "general", userName = "") {
  if (!row || row.gap || isOwnTurn(row, userName) || isBackchannel(row.text))
    return null;
  const text = String(row.text || "").trim();
  const meaningful = sentencesFor(text).filter((s) => !logistics(s.clean));
  if (!meaningful.length) return null;
  for (const { original, clean } of meaningful) {
    if (/[?？]$/.test(original) && normalize(original).split(" ").length >= 2)
      return "question";
    if (
      /^(?:who|what|when|where|why|how|can|could|would|do|does|did|is|are|have|will|should|was|were|has|had|which|whose|any)\b/i.test(
        clean,
      ) ||
      /^(?:tell (?:me|us)|walk (?:me|us) through|talk (?:me|us) through|talk to (?:me|us) about|(?:let['’]s )?talk about|describe|give (?:me|us)|explain|help me understand|remind me|show me|i['’]d (?:love|like) to (?:hear|know|understand)|i['’]m (?:curious|wondering)|i wonder|what about|how about|send me)\b/i.test(
        clean,
      ) ||
      /\b(?:my question is|the question is|i wanted to ask about)\b/i.test(
        clean,
      )
    )
      return "question";
  }
  if (isWrapUp(text)) return "wrap_up";
  if (normalize(text).split(" ").length < 4) return null;
  // Interview playbook only requests words for questions.
  if (mode === "interview") return null;
  if (
    /\b(so we agreed|let.s go with|we.ve decided|the decision is|new topic|moving on|switching gears)\b/i.test(
      text,
    )
  )
    return "decision";
  if (commitmentCue(text)) return "commitment";
  if (
    ["sales", "negotiation"].includes(mode) &&
    /\b(too expensive|not sure|concerned|already have|last agency|we tried|struggling|pain|dropped|budget|decid(es|ing)|final offer|concession|deadline)\b/i.test(
      text,
    )
  )
    return "concern";
  if (
    ["sales", "client", "strategy", "negotiation"].includes(mode) &&
    /(?:[$€£]\s*\d|\b(?:\d+(?:[.,]\d+)?|twelve|twenty|thirty|forty)\s*(?:%|percent|dollars|million|thousand|days|weeks|months)|\b(?:budget|scope|monday|tuesday|wednesday|thursday|friday|january|february|march|april|june|july|august|september|october|november|december)\b|\b(?:in|by|of|next|last|this)\s+may\b|\bmay\s+\d|\b\d+\s+may\b)/i.test(
      text,
    )
  )
    return "fact";
  return null;
}
export function editRatio(a, b) {
  a = normalize(a).slice(0, 1000);
  b = normalize(b).slice(0, 1000);
  let prior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        prior[j] + 1,
        prior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prior = next;
  }
  return prior[b.length] / Math.max(1, a.length, b.length);
}
export function consumeToken(state, now) {
  const tokens = Math.min(
    3,
    (state?.tokens ?? 3) + (Math.max(0, now - (state?.at ?? now)) * 8) / 60000,
  );
  const allowed =
    tokens >= 1 &&
    (state?.requests || []).filter((at) => now - at < 60000).length < 8;
  return {
    allowed,
    state: {
      tokens: allowed ? tokens - 1 : tokens,
      at: now,
      requests: [
        ...(state?.requests || []).filter((at) => now - at < 60000),
        ...(allowed ? [now] : []),
      ],
    },
  };
}
export function completePartial(row, mode, userName) {
  return (
    !row.final &&
    normalize(row.text).split(" ").length >= 6 &&
    classifyTurn(row, mode, userName) === "question"
  );
}
export function echoMatch(a, b) {
  if (
    !a ||
    !b ||
    a.gap ||
    b.gap ||
    a.channel === b.channel ||
    ![a.channel, b.channel].every((c) => ["mic", "system"].includes(c))
  )
    return false;
  const aEnd =
    a.endMs ??
    a.startMs + Math.max(1500, normalize(a.text).split(" ").length * 400);
  const bEnd =
    b.endMs ??
    b.startMs + Math.max(1500, normalize(b.text).split(" ").length * 400);
  return (
    Math.max(a.startMs, b.startMs) <= Math.min(aEnd, bEnd) + 500 &&
    editRatio(a.text, b.text) <= 0.3
  );
}
