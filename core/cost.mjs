// Standard token rates for GPT-6 Luna and GPT-6.1 Sol, checked 2026-11-12.
// Fast processing doubles token rates. Editable estimates, never a billing report.
export const DEFAULT_PRICES = {
  fastInput: 0.1,
  fastOutput: 0.5,
  deepInput: 2,
  deepOutput: 10,
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
export function estimateCost(usage, prices = DEFAULT_PRICES, serviceTier = "default") {
  const p = sanitizePrices(prices);
  return (
    ((usage.fastInput || 0) * p.fastInput +
      (usage.fastOutput || 0) * p.fastOutput +
      (usage.deepInput || 0) * p.deepInput +
      (usage.deepOutput || 0) * p.deepOutput) /
      1e6 * (serviceTier === "fast" ? 2 : 1) +
    ((usage.audioMs || 0) / 60000) * p.audioMinute
  );
}
