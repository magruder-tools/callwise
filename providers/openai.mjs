import { COACH_SCHEMA, SLOW_SCHEMA } from "../core/prompts.mjs";
import { partialAdvice, sseEvents } from "./stream-json.mjs";
import { providerError, httpProviderError } from "./errors.mjs";
export function modelOptions(model, effort = "none") {
  if (/^gpt-(?:6-astra|6\.1-sol)(?:-|$)/.test(model || ""))
    return {
      reasoning: { effort: effort === "none" ? "low" : effort },
      verbosity: "low",
    };
  // Known families support none and low verbosity; custom models receive no unsupported options.
  if (/^gpt-(?:5\.[56]|6)(?:[.-]|$)/.test(model || ""))
    return { reasoning: { effort }, verbosity: "low" };
  if (/^gpt-5/.test(model || ""))
    return {
      reasoning: { effort: effort === "none" ? "low" : effort },
      verbosity: "low",
    };
  if (/^o[134]/.test(model || ""))
    return { reasoning: { effort: effort === "none" ? "low" : effort } };
  return {};
}
export class OpenAIProvider {
  constructor({
    apiKey,
    model,
    effort = "none",
    fetchImpl = fetch,
    firstTokenMs = 6000,
    clock = Date.now,
  }) {
    Object.assign(this, {
      apiKey,
      model,
      effort,
      fetch: fetchImpl,
      firstTokenMs,
      clock,
    });
  }
  async generate({
    lane = "fast",
    prompt,
    signal = new AbortController().signal,
    onPartial = () => {},
    onToken = () => {},
    schema,
    maxTokens,
  }) {
    if (!this.apiKey)
      throw new Error(
        "Open Settings and save your OpenAI API key. Practice works without a key.",
      );
    const options = modelOptions(this.model, this.effort),
      streamController = new AbortController();
    const fast = lane === "fast",
      timeout = schema ? 60000 : fast ? this.firstTokenMs : 20000;
    let token = false,
      text = "",
      completed;
    const timer = setTimeout(
      () =>
        streamController.abort(
          new DOMException("First words timed out", "TimeoutError"),
        ),
      timeout,
    );
    const combined = AbortSignal.any([
      signal,
      streamController.signal,
      AbortSignal.timeout(fast ? 15000 : 90000),
    ]);
    try {
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await this.fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: this.model,
              instructions: prompt.instructions,
              input: prompt.input,
              store: false,
              stream: true,
              ...(options.reasoning ? { reasoning: options.reasoning } : {}),
              max_output_tokens: maxTokens ?? (fast ? 350 : 6000),
              text: {
                ...(options.verbosity ? { verbosity: options.verbosity } : {}),
                format: {
                  type: "json_schema",
                  name: schema ? "callwise_document" : "callwise_advice",
                  strict: true,
                  schema: schema || (fast ? COACH_SCHEMA : SLOW_SCHEMA),
                },
              },
            }),
            signal: combined,
          });
          if (!response.ok) {
            if (response.status >= 500 && attempt === 0 && !combined.aborted) {
              await response.body?.cancel();
              continue;
            }
            throw await httpProviderError(response);
          }
          break;
        } catch (error) {
          if (
            attempt === 0 &&
            !combined.aborted &&
            !error.status &&
            error.name !== "TimeoutError"
          )
            continue;
          throw error;
        }
      }
      if (
        !response.body ||
        !response.headers?.get("content-type")?.includes("text/event-stream")
      ) {
        const data = await response.json();
        completed = data;
        text =
          data.output_text ||
          data.output
            ?.flatMap((i) => i.content || [])
            .filter((c) => c.type === "output_text")
            .map((c) => c.text)
            .join("") ||
          "";
        if (text) {
          onToken(this.clock());
          onPartial(partialAdvice(text));
        }
      } else
        for await (const event of sseEvents(response.body)) {
          if (event.type === "response.output_text.delta") {
            if (!token) {
              token = true;
              clearTimeout(timer);
              onToken(this.clock());
            }
            text += event.delta || "";
            if (text.length > 200000)
              throw new Error("OpenAI response exceeded its limit.");
            if (!schema) {
              const partial = partialAdvice(text);
              if (partial.speak === false)
                return {
                  speak: false,
                  kind: "",
                  lead: "",
                  points: [],
                  sourceIds: [],
                  covers: [],
                };
              onPartial(partial);
            }
          }
          if (event.type === "response.completed") completed = event.response;
          if (event.type === "error" || event.type === "response.failed")
            throw providerError({
              status: event.response?.error?.status,
              code: event.code || event.response?.error?.code,
              type: event.type,
            });
          if (event.type === "response.incomplete")
            throw new Error("OpenAI couldn't finish the answer. Try again.");
        }
      if (completed?.status === "incomplete")
        throw new Error("OpenAI couldn't finish the answer. Try again.");
      if (!text) throw new Error("OpenAI did not return an answer.");
      try {
        return { ...JSON.parse(text), usage: completed?.usage };
      } catch {
        throw new Error("OpenAI returned an unreadable answer.");
      }
    } catch (error) {
      if (signal.aborted) throw error;
      if (error.status || error.code) throw error;
      throw providerError({
        code: combined.aborted ? "timeout" : "connection_lost",
      });
    } finally {
      clearTimeout(timer);
      streamController.abort();
    }
  }
}
