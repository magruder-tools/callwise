// Resolve stable family aliases from account-visible metadata, never from document text.
export const RECOMMENDED_MODELS = {
  fastModel: "gpt-6-luna",
  strategyModel: "gpt-6.1-sol",
};
export function latestFamilyModel(ids, family) {
  const candidates = ids.flatMap((id) => {
    const match = String(id).match(/^gpt-(\d+(?:\.\d+)*)-(luna|sol)$/);
    return match?.[2] === family
      ? [{ id, version: match[1].split(".").map(Number) }]
      : [];
  });
  candidates.sort((a, b) => {
    for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
      const difference = (b.version[i] || 0) - (a.version[i] || 0);
      if (difference) return difference;
    }
    return 0;
  });
  return candidates[0]?.id;
}
export async function resolveLatestModels(config, { fetchImpl = fetch, signal } = {}) {
  if (!config.autoLatestModels || !config.openaiKey) return { ...config };
  try {
    const response = await fetchImpl("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${config.openaiKey}` },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
        : AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Model metadata unavailable");
    }
    const body = await response.json();
    if (!Array.isArray(body.data)) throw new Error("Invalid model metadata");
    const ids = body.data.map((m) => m.id);
    const fastModel = latestFamilyModel(ids, "luna");
    const strategyModel = latestFamilyModel(ids, "sol");
    if (!fastModel || !strategyModel) throw new Error("Family not available");
    return { ...config, fastModel, strategyModel, modelUpdateWarning: "" };
  } catch {
    return {
      ...config,
      modelUpdateWarning: "Couldn’t check the latest models. Using the last selected models for this call.",
    };
  }
}
