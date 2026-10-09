// Provider bodies are untrusted. Only constrained status/code/type metadata survives.
export function safeErrorLabel(value) {
  return typeof value === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/.test(value) &&
    !value.startsWith("sk_")
    ? value
    : undefined;
}

export function providerError({ status, code, type, channel } = {}) {
  code = safeErrorLabel(code);
  type = safeErrorLabel(type);
  let message = "OpenAI couldn't finish this request. Try again.";
  let action = "";
  if (
    status === 401 ||
    ["invalid_api_key", "authentication_error"].includes(code)
  ) {
    message = "OpenAI didn't accept this key.";
    action = "replace-key";
  } else if (
    code === "insufficient_quota" ||
    type === "insufficient_quota" ||
    code === "billing_hard_limit_reached"
  ) {
    message = "Your OpenAI account is out of credit.";
    action = "open-billing";
  } else if (
    [403, 404].includes(status) ||
    ["model_not_found", "permission_denied"].includes(code)
  ) {
    message = `This key can't use the ${channel ? "transcription" : "configured coaching"} model.`;
    action = "reset-models";
  } else if (status === 429 || code === "rate_limit_exceeded")
    message =
      "OpenAI is limiting requests. Suggestions will be slower for a minute.";
  else if (status >= 500)
    message = "OpenAI is temporarily unavailable. Try again in a moment.";
  else if (["timeout", "request_timeout"].includes(code))
    message =
      "OpenAI is slow right now. Suggestions may lag. Try again in a moment.";
  else if (code === "connection_lost")
    message =
      "Connection dropped. Check your internet connection, then try again.";
  const error = new Error(message);
  Object.assign(error, {
    status: Number.isInteger(status) ? status : undefined,
    code,
    type,
    action,
  });
  return error;
}

export function fatalTranscriptionError(error) {
  return (
    [401, 403].includes(error?.status) ||
    [
      "invalid_api_key",
      "authentication_error",
      "permission_denied",
      "insufficient_quota",
      "billing_hard_limit_reached",
    ].includes(error?.code) ||
    error?.type === "insufficient_quota"
  );
}

export async function httpProviderError(response) {
  let metadata = {};
  try {
    // Do not retain or echo error.message or arbitrary body fields.
    const data = await response.json();
    metadata = { code: data?.error?.code, type: data?.error?.type };
  } catch {
    /* HTTP status still supplies a useful error. */
  }
  return providerError({ status: response.status, ...metadata });
}
