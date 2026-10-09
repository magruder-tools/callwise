// Pricing references: developers.openai.com/api/docs/models/gpt-5.6-luna, gpt-6-astra, gpt-live-transcribe
// USD estimates at Standard rates, checked 2026-10-09. Editable; not a billing report.
export const DEFAULT_PRICES = {
  fastInput: 0.2,
  fastOutput: 1.2,
  deepInput: 10,
  deepOutput: 50,
  audioMinute: 0.017,
};
export function sanitizePrices(patch = {}) {
  const next = { ...DEFAULT_PRICES };
  for (const key of Object.keys(next))
    if (patch[key] !== undefined) {
      const n = Number(patch[key]);
      if (!Number.isFinite(n) || n < 0 || n > 10000)
        throw new Error("Enter a valid non-negative price.");
      next[key] = n;
    }
  return next;
}
export function estimateCost(usage, prices = DEFAULT_PRICES) {
  const p = sanitizePrices(prices);
  return (
    ((usage.fastInput || 0) * p.fastInput +
      (usage.fastOutput || 0) * p.fastOutput +
      (usage.deepInput || 0) * p.deepInput +
      (usage.deepOutput || 0) * p.deepOutput) /
      1e6 +
    ((usage.audioMs || 0) / 60000) * p.audioMinute
  );
}
