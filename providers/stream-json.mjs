// Only read generated string fields. Never evaluate or repair arbitrary JSON.
export function partialAdvice(text) {
  const speak = /"speak"\s*:\s*(true|false)/.exec(text);
  const stringField = (name) => {
    const match = new RegExp(`"${name}"\\s*:\\s*"`).exec(text);
    if (!match) return "";
    const tail = text.slice(match.index + match[0].length);
    let value = "",
      escaped = false;
    for (const char of tail) {
      if (!escaped && char === '"') break;
      if (!escaped && char === "\\") {
        escaped = true;
        continue;
      }
      if (escaped) {
        if (char === "u") break;
        value += { n: "\n", r: "\r", t: "\t" }[char] ?? char;
        escaped = false;
      } else value += char;
    }
    return value;
  };
  return {
    speak: speak ? speak[1] === "true" : undefined,
    kind: stringField("kind"),
    lead: stringField("lead"),
  };
}
export async function* sseEvents(body) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") {
          try {
            yield JSON.parse(data);
          } catch {
            throw new Error("OpenAI returned an unreadable stream.");
          }
        }
      }
      if (buffer.length > 1000000)
        throw new Error("OpenAI response exceeded the stream limit.");
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
