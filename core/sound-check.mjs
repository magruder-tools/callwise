export const SOUND_CHECK_TIMES = {
  mic: { captureMs: 30000, deadlineMs: 40000 },
  system: { captureMs: 12000, deadlineMs: 20000 },
};

export function soundCheckPassed(level, text) {
  return (
    Number.isFinite(level) &&
    level > 0.004 &&
    /ready.*(?:call|my)/i.test(text) &&
    /\bcal{1,2}\s?wise\b/i.test(text)
  );
}

export class SoundCheckTranscript {
  segments = new Map();
  update(row) {
    if (typeof row.id !== "string" || typeof row.text !== "string")
      return this.text();
    this.segments.set(row.id, row.text.slice(0, 2000));
    if (this.segments.size > 16)
      this.segments.delete(this.segments.keys().next().value);
    return this.text();
  }
  text() {
    return [...this.segments.values()].join(" ").slice(-4000);
  }
}
