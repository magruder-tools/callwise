// Only the configured search tool can be called. No generic tool execution surface.
export class ReadOnlyMcp {
  constructor({
    url,
    token,
    tool,
    argumentsTemplate = '{"query":"{{query}}"}',
    fetchImpl = fetch,
  }) {
    this.url = url;
    this.token = token;
    this.tool = tool;
    this.template = argumentsTemplate;
    this.fetch = fetchImpl;
    this.nextId = 0;
    this.sessionId = "";
    this.ready = false;
    if (url) {
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" &&
        !(
          parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
        )
      )
        throw new Error("MCP requires HTTPS or localhost.");
      if (parsed.username || parsed.password)
        throw new Error("Use the private token setting, not URL credentials.");
    }
  }
  async rpc(method, params, signal, notification = false) {
    const id = ++this.nextId;
    const response = await this.fetch(this.url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        "MCP-Protocol-Version": "2025-03-26",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(notification ? {} : { id }),
        method,
        params,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
    });
    if (!response.ok)
      throw new Error(
        `Context search returned HTTP ${response.status}. Check MCP configuration.`,
      );
    this.sessionId = response.headers.get("mcp-session-id") || this.sessionId;
    if (notification || response.status === 202) return {};
    let message;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let pending = "",
        bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 2_000_000)
            throw new Error("Context response is too large.");
          pending += decoder.decode(value, { stream: true });
          const blocks = pending.split(/\r?\n\r?\n/);
          pending = blocks.pop();
          for (const block of blocks) {
            const data = block
              .split(/\r?\n/)
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("\n");
            if (!data) continue;
            const event = JSON.parse(data);
            if (event.id === id) {
              message = event;
              break;
            }
          }
          if (message) break;
        }
      } finally {
        await reader.cancel();
      }
    } else {
      const text = await response.text();
      if (text.length > 2_000_000)
        throw new Error("Context response is too large.");
      message = JSON.parse(text);
    }
    if (message?.error)
      throw new Error(
        "The configured context tool could not complete the search.",
      );
    if (!message || message.id !== id)
      throw new Error("Unexpected MCP response.");
    return message.result;
  }
  async search(query, signal) {
    if (!this.url || !this.tool)
      throw new Error(
        "Configure a read-only MCP search endpoint and tool first.",
      );
    if (!this.ready) {
      await this.rpc(
        "initialize",
        {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "callwise", version: "0.1.0" },
        },
        signal,
      );
      await this.rpc("notifications/initialized", {}, signal, true);
      const result = await this.rpc("tools/list", {}, signal);
      const tool = result.tools?.find((t) => t.name === this.tool);
      if (
        !tool ||
        tool.annotations?.readOnlyHint !== true ||
        tool.annotations?.destructiveHint === true
      )
        throw new Error(
          "The configured MCP tool must advertise readOnlyHint=true and must not be destructive.",
        );
      this.ready = true;
    }
    const replace = (value) =>
      typeof value === "string"
        ? value.replaceAll("{{query}}", query)
        : Array.isArray(value)
          ? value.map(replace)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, replace(v)]),
              )
            : value;
    const args = replace(JSON.parse(this.template));
    const result = await this.rpc(
      "tools/call",
      { name: this.tool, arguments: args },
      signal,
    );
    if (result.isError) throw new Error("Context search failed.");
    return (result.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .slice(0, 30000);
  }
}
