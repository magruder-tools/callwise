const overlap = (a, b) =>
  Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
export function stableSpeakerTurns(previous, turns, speakers = []) {
  const mapping = new Map(),
    used = new Set();
  const groups = new Map();
  for (const t of turns) {
    const group = groups.get(t.cluster) || [];
    group.push(t);
    groups.set(t.cluster, group);
  }
  const candidates = [];
  for (const [cluster, group] of groups) {
    const totals = new Map(),
      length = group.reduce((n, t) => n + t.endMs - t.startMs, 0);
    for (const t of group)
      for (const p of previous)
        totals.set(
          p.speakerKey,
          (totals.get(p.speakerKey) || 0) + overlap(t, p),
        );
    for (const [key, ms] of totals)
      if (ms / Math.max(1, length) >= 0.3)
        candidates.push({ cluster, key, ms });
  }
  for (const c of candidates.sort((a, b) => b.ms - a.ms))
    if (!mapping.has(c.cluster) && !used.has(c.key)) {
      mapping.set(c.cluster, c.key);
      used.add(c.key);
    }
  const reserved = new Set([...used, ...speakers.map((s) => s.id)]);
  for (const cluster of groups.keys())
    if (!mapping.has(cluster)) {
      let n = 1;
      while (reserved.has(`s${n}`)) n++;
      const key = n <= 20 ? `s${n}` : "them";
      mapping.set(cluster, key);
      reserved.add(key);
    }
  return turns.map((t) => ({ ...t, speakerKey: mapping.get(t.cluster) }));
}
export function assignSpeakers(rows, turns, speakers = []) {
  const lookup = new Map(speakers.map((s) => [s.id, s]));
  return rows.map((row) => {
    if (row.channel !== "system" || row.gap || row.speakerOverride) return row;
    const scores = new Map();
    const endMs = row.endMs ?? row.startMs + 1000;
    for (const t of turns) {
      const key = lookup.get(t.speakerKey)?.mergedInto || t.speakerKey;
      scores.set(key, (scores.get(key) || 0) + overlap({ ...row, endMs }, t));
    }
    const best = [...scores].sort((a, b) => b[1] - a[1]);
    if (!best.length || !best[0][1]) return row;
    const confidence = Math.min(
        1,
        best[0][1] / Math.max(1, endMs - row.startMs),
      ),
      speakerKey = best[0][0],
      speaker = lookup.get(speakerKey);
    return {
      ...row,
      speakerKey,
      speaker:
        speaker?.name || speaker?.label || `Speaker ${speakerKey.slice(1)}`,
      speakerConfidence: confidence,
      uncertain: confidence < 0.6,
      overlap: (best[1]?.[1] || 0) / Math.max(1, endMs - row.startMs) >= 0.3,
    };
  });
}
