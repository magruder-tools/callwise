import { OpenAIProvider } from "../providers/openai.mjs";
import { LiveTranscriber } from "../providers/transcription.mjs";
import { httpProviderError } from "../providers/errors.mjs";
const TEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
};
export async function runSelfTest(
  config,
  {
    fetchImpl = fetch,
    transcriberFactory = (o) => new LiveTranscriber(o),
    signal = new AbortController().signal,
    clock = Date.now,
  } = {},
) {
  if (!config.openaiKey)
    return [
      {
        label: "API key",
        ok: false,
        detail: "Save your OpenAI API key first.",
      },
    ];
  const results = [];
  const check = async (label, fn) => {
    const at = clock();
    try {
      await fn();
      results.push({
        label,
        ok: true,
        elapsedMs: clock() - at,
        detail: "Passed",
      });
    } catch (error) {
      results.push({
        label,
        ok: false,
        detail:
          /fetch failed|network|ECONN|ENOTFOUND|timed out|timeout/i.test(
            error.message,
          ) || error.name === "TimeoutError"
            ? "Couldn't reach OpenAI. Check your internet connection."
            : error.message,
        action: error.action || "",
      });
    }
  };
  await check("API key", async () => {
    const response = await fetchImpl("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${config.openaiKey}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) throw await httpProviderError(response);
    await response.body?.cancel();
  });
  if (!results[0].ok) return results;
  for (const [label, model, lane] of [
    ["Fast answers", config.fastModel, "fast"],
    ["Preparation and recaps", config.strategyModel, "strategy"],
  ])
    await check(label, async () => {
      const provider = new OpenAIProvider({
        apiKey: config.openaiKey,
        model,
        effort: "none",
        fetchImpl,
        clock,
      });
      const result = await provider.generate({
        lane,
        schema: TEST_SCHEMA,
        maxTokens: lane === "fast" ? 40 : 512,
        prompt: {
          instructions: 'Return exactly {"ok":true} matching the schema.',
          input: "Callwise setup check.",
        },
        signal,
      });
      if (result.ok !== true)
        throw new Error("The model returned an unexpected test result.");
    });
  await check("Live transcription", async () => {
    const transcriber = transcriberFactory({
      apiKey: config.openaiKey,
      model: config.transcriptionModel,
      channel: "mic",
      onSegment: () => {},
      retryWindowMs: 10000,
    });
    const abort = () => transcriber.close();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await transcriber.connect();
    } finally {
      signal.removeEventListener("abort", abort);
      transcriber.close();
    }
  });
  return results;
}
