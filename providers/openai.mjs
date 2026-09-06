import { COACH_SCHEMA } from "../core/prompts.mjs";
export class OpenAIProvider {
  constructor({ apiKey, model, effort = "low", fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.model = model;
    this.effort = effort;
    this.fetch = fetchImpl;
  }
  async generate({ lane, prompt, signal }) {
    if (!this.apiKey)
      throw new Error(
        "Add OPENAI_API_KEY to the private .env.local file, then restart Callwise. Demo works without a key.",
      );
    const response = await this.fetch("https://api.openai.com/v1/responses", {
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
        reasoning: { effort: this.effort },
        max_output_tokens: lane === "fast" ? 1800 : 6000,
        text: {
          format: {
            type: "json_schema",
            name: "callwise_advice",
            strict: true,
            schema: COACH_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(lane === "fast" ? 20000 : 90000),
      ]),
    });
    if (!response.ok)
      throw new Error(
        `OpenAI returned HTTP ${response.status}. ${response.status === 401 ? "Check your API key." : response.status === 429 ? "Check your usage limits or retry later." : "Check model access and the configured model name."}`,
      );
    const data = await response.json();
    if (data.status === "incomplete")
      throw new Error(
        "The reasoning response hit its output limit. Try a lower reasoning effort or increase the output allowance.",
      );
    const output =
      data.output
        ?.filter((i) => i.type === "message")
        .flatMap((i) => i.content || [])
        .filter((c) => c.type === "output_text")
        .map((c) => c.text)
        .join("") || data.output_text;
    if (!output) throw new Error("OpenAI did not return a coaching response.");
    try {
      return { ...JSON.parse(output), usage: data.usage };
    } catch {
      throw new Error("OpenAI returned an unreadable coaching response.");
    }
  }
}
