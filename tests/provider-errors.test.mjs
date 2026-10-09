import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../providers/openai.mjs";
import { providerError } from "../providers/errors.mjs";

test("provider failures retain only safe metadata and map quota versus rate limits", async () => {
  const provider = new OpenAIProvider({
    apiKey: "TEST_ONLY",
    model: "test",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "insufficient_quota",
            type: "insufficient_quota",
            message: "SECRET_KEY PRIVATE_TRANSCRIPT PRIVATE_PROMPT",
            account: "PRIVATE_ACCOUNT",
          },
        }),
        { status: 429 },
      ),
  });
  await assert.rejects(
    provider.generate({
      lane: "fast",
      prompt: {},
      signal: new AbortController().signal,
    }),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.code, "insufficient_quota");
      assert.equal(error.type, "insufficient_quota");
      assert.match(error.message, /out of credit/);
      assert.doesNotMatch(
        JSON.stringify(error) + error.message,
        /SECRET|PRIVATE/,
      );
      return true;
    },
  );
  assert.match(
    providerError({ status: 429, code: "rate_limit_exceeded" }).message,
    /limiting requests/,
  );
  assert.match(
    providerError({ status: 401 }).message,
    /didn't accept this key/,
  );
  assert.match(
    providerError({ status: 403, channel: "mic" }).message,
    /transcription model/,
  );
  assert.match(
    providerError({ status: 503 }).message,
    /temporarily unavailable/,
  );
  assert.equal(
    providerError({
      status: 400,
      code: "sk-secret-value",
      type: "private response body",
    }).code,
    undefined,
  );
});
