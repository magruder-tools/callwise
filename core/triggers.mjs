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
  return ["you", "me", "matt", "matthew", normalize(userName)]
    .filter(Boolean)
    .includes(name);
}
export function isBackchannel(text) {
  return /^(yeah|yes|right|okay|ok|got it|mm hm|uh huh|thanks|thank you)(\s+(yeah|yes|right|okay|ok|got it|thanks|thank you))*$/.test(
    normalize(text),
  );
}
export function classifyTurn(row, mode = "general", userName = "") {
  if (!row || row.gap || isOwnTurn(row, userName)) return null;
  const text = String(row.text || "").trim(),
    normalized = normalize(text);
  if (isBackchannel(text)) return null;
  if (
    /\b(anything else|we.re at time|wrap (up|this)|before we (go|finish))\b/i.test(
      text,
    )
  )
    return "wrap_up";
  if (normalized.split(" ").length < 4) return null;
  if (
    /[?？]$/.test(text) ||
    /^(who|what|when|where|why|how|can|could|would|do|does|did|is|are|have|tell me|walk me through|talk about|describe|give me)\b/i.test(
      text,
    )
  )
    return "question";
  if (
    /\b(anything else|we.re at time|wrap (up|this)|before we (go|finish)|last question)\b/i.test(
      text,
    )
  )
    return "wrap_up";
  if (
    /\b(so we agreed|let.s go with|we.ve decided|the decision is|new topic|moving on|switching gears)\b/i.test(
      text,
    )
  )
    return "decision";
  if (
    /\b(i.ll send|i will send|we.ll|we will|by (monday|tuesday|wednesday|thursday|friday)|let.s|i.ll follow|i will follow)\b/i.test(
      text,
    )
  )
    return "commitment";
  if (
    ["sales", "negotiation"].includes(mode) &&
    /\b(too expensive|not sure|concerned|already have|last agency|we tried|struggling|pain|dropped|budget|decid(es|ing)|final offer|concession|deadline)\b/i.test(
      text,
    )
  )
    return "concern";
  if (
    ["sales", "client", "strategy", "negotiation"].includes(mode) &&
    /(?:[$€£]\s*\d|\b\d+(?:[.,]\d+)?\s*(?:%|percent|dollars|million|thousand|days|weeks|months)|\b(?:budget|scope|monday|tuesday|wednesday|thursday|friday|january|february|march|april|may|june|july|august|september|october|november|december)\b)/i.test(
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
