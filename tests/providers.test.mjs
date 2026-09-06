import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { OpenAIProvider } from "../providers/openai.mjs";
import {
  normalizeFireflies,
  FirefliesClient,
} from "../providers/fireflies.mjs";
import { LiveTranscriber } from "../providers/transcription.mjs";
import { ReadOnlyMcp } from "../providers/mcp.mjs";
import { CodexRpc, CodexProvider } from "../providers/codex.mjs";
const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
test("OpenAI contract uses bounded structured output, no storage, and keeps keys out of output", async () => {
  let request;
  const provider = new OpenAIProvider({
    apiKey: "TEST_ONLY_NOT_A_KEY",
    model: "gpt-5.6-luna",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: '{"cards":[]}' }],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 3 },
      });
    },
  });
  const result = await provider.generate({
    lane: "fast",
    prompt: { instructions: "coach", input: "data" },
    signal: new AbortController().signal,
  });
  assert.deepEqual(result.cards, []);
  const body = JSON.parse(request.options.body);
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.max_output_tokens, 1800);
  assert.equal(body.model, "gpt-5.6-luna");
  assert.equal(request.url, "https://api.openai.com/v1/responses");
});
test("provider errors never echo arbitrary upstream bodies", async () => {
  const p = new OpenAIProvider({
    apiKey: "TEST_ONLY",
    model: "test",
    fetchImpl: async () =>
      jsonResponse({ message: "sensitive upstream value" }, 401),
  });
  await assert.rejects(
    p.generate({
      lane: "fast",
      prompt: {},
      signal: new AbortController().signal,
    }),
    (error) =>
      error.message.includes("401") && !error.message.includes("sensitive"),
  );
});
test("Fireflies event revision IDs are stable and cross-meeting events are ignored", () => {
  const input = {
    transcript_id: "meeting",
    chunk_id: "chunk",
    speaker_name: "Alex",
    text: "Hello",
    start_time: 1.2,
  };
  assert.equal(normalizeFireflies(input, "other"), null);
  const a = normalizeFireflies(input, "meeting"),
    b = normalizeFireflies({ ...input, text: "Hello again" }, "meeting");
  assert.equal(a.id, b.id);
  assert.equal(a.startMs, 1200);
  assert.equal(b.text, "Hello again");
});
test("Fireflies history import uses authenticated GraphQL and yields a local source", async () => {
  let body;
  const p = new FirefliesClient({
    apiKey: "TEST_ONLY",
    fetchImpl: async (_url, opts) => {
      body = JSON.parse(opts.body);
      return jsonResponse({
        data: {
          transcript: {
            id: "a",
            title: "Meeting",
            sentences: [{ speaker_name: "You", text: "Hello" }],
          },
        },
      });
    },
  });
  const doc = await p.importTranscript("a");
  assert.equal(body.variables.id, "a");
  assert.equal(doc.text, "You: Hello");
  assert.equal(doc.kind, "meeting");
});
test("MCP requires a configured read-only tool and preserves queries as data", async () => {
  const requests = [];
  const p = new ReadOnlyMcp({
    url: "https://example.test/mcp",
    tool: "search",
    fetchImpl: async (_url, opts) => {
      const r = JSON.parse(opts.body);
      requests.push(r);
      let result = {};
      if (r.method === "tools/list")
        result = {
          tools: [{ name: "search", annotations: { readOnlyHint: true } }],
        };
      if (r.method === "tools/call")
        result = { content: [{ type: "text", text: "A relevant note" }] };
      return jsonResponse({ jsonrpc: "2.0", id: r.id, result });
    },
  });
  const q = 'literal "query" with $()';
  assert.equal(await p.search(q), "A relevant note");
  assert.deepEqual(requests.at(-1).params, {
    name: "search",
    arguments: { query: q },
  });
});
test("MCP refuses write-capable or undeclared tools", async () => {
  const p = new ReadOnlyMcp({
    url: "https://example.test/mcp",
    tool: "send",
    fetchImpl: async (_url, opts) => {
      const r = JSON.parse(opts.body);
      return jsonResponse({
        id: r.id,
        result:
          r.method === "tools/list"
            ? {
                tools: [{ name: "send", annotations: { readOnlyHint: false } }],
              }
            : {},
      });
    },
  });
  await assert.rejects(p.search("hello"), /readOnlyHint/);
});
test("transcription commits voice on silence, sends no silent-only audio, and stops immediately", () => {
  const sent = [];
  const p = new LiveTranscriber({
    apiKey: "TEST_ONLY",
    channel: "mic",
    onSegment: () => {},
  });
  p.ready = true;
  p.socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (m) => sent.push(JSON.parse(m)),
    removeAllListeners() {},
    on() {},
    close() {},
  };
  const silent = Buffer.alloc(4800),
    voice = Buffer.alloc(4800);
  for (let i = 0; i < voice.length; i += 2) voice.writeInt16LE(3000, i);
  for (let i = 0; i < 20; i++) p.push(silent);
  assert.equal(sent.length, 0);
  p.push(voice, 2000);
  for (let i = 0; i < 6; i++) p.push(silent, 2100 + i * 100);
  assert.ok(sent.some((e) => e.type === "input_audio_buffer.commit"));
  p.close();
  const count = sent.length;
  p.push(voice);
  assert.equal(sent.length, count);
});
test("Codex JSON-lines client correlates split frames and refuses approvals", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  const outbound = [];
  child.stdin.on("data", (data) => {
    for (const line of String(data).trim().split("\n")) {
      const m = JSON.parse(line);
      outbound.push(m);
      if (m.id && m.method) {
        const response =
          JSON.stringify({
            id: m.id,
            result:
              m.method === "account/read"
                ? { account: { type: "chatgpt" } }
                : {},
          }) + "\n";
        child.stdout.write(response.slice(0, 4));
        child.stdout.write(response.slice(4));
      }
    }
  });
  const rpc = new CodexRpc({ spawnImpl: () => child });
  await rpc.connect();
  assert.equal((await rpc.request("account/read")).account.type, "chatgpt");
  rpc.receive({ id: 900, method: "item/fileChange/requestApproval" });
  assert.deepEqual(outbound.at(-1), {
    id: 900,
    result: { decision: "decline" },
  });
  rpc.close();
});
test("Codex strategy restricts inherited connectors and parses final structured advice", async () => {
  class FakeRpc extends EventEmitter {
    constructor() {
      super();
      this.calls = [];
    }
    async connect() {}
    async request(method, params) {
      this.calls.push({ method, params });
      if (method === "account/read") return { account: { type: "chatgpt" } };
      if (method === "config/read")
        return {
          config: {
            mcp_servers: { mail: {} },
            apps: { drive: { enabled: true } },
          },
        };
      if (method === "thread/start") return { thread: { id: "t" } };
      if (method === "turn/start") {
        setImmediate(() => {
          this.emit("notification", {
            method: "item/completed",
            params: {
              threadId: "t",
              turnId: "u",
              item: {
                id: "i",
                type: "agentMessage",
                phase: "final_answer",
                text: '{"cards":[]}',
              },
            },
          });
          this.emit("notification", {
            method: "turn/completed",
            params: {
              threadId: "t",
              turn: { id: "u", status: "completed", items: [] },
            },
          });
        });
        return { turn: { id: "u" } };
      }
      return {};
    }
  }
  const rpc = new FakeRpc();
  rpc.protocol = () => ({
    sandbox: "read-only",
    approval: "untrusted",
    restrictedAccess: false,
  });
  const p = new CodexProvider({ rpc, cwd: "/tmp/callwise-test" });
  const result = await p.generate({
    prompt: { instructions: "Coach", input: "test" },
    signal: new AbortController().signal,
  });
  assert.deepEqual(result.cards, []);
  const start = rpc.calls.find((c) => c.method === "thread/start").params;
  assert.equal(start.config["mcp_servers.mail.enabled"], false);
  assert.equal(start.config["apps.drive.enabled"], false);
  assert.equal(start.config["features.browser_use"], false);
  assert.equal(start.ephemeral, true);
  assert.equal(start.sandbox, "read-only");
  assert.equal(
    rpc.calls.find((c) => c.method === "turn/start").params.outputSchema.type,
    "object",
  );
});
