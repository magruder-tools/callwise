import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import { CodexRpc } from "../providers/codex.mjs";
import {
  CodexContextProvider,
  contextPolicy,
  toolEvidence,
  verifyContext,
  readOnlyTools,
} from "../providers/codex-context.mjs";
import { ContextRetrieval, shouldSearch } from "../core/retrieval.mjs";
import { CallController } from "../core/controller.mjs";
import { CoachEngine } from "../core/engine.mjs";
import { ContextStore } from "../core/context.mjs";

const APP = {
  id: "gmail-test",
  name: "Gmail",
  isAccessible: true,
  isEnabled: true,
  toolSummaries: [
    { name: "search_email", isEnabled: true, isReadOnly: true },
    { name: "send_email", isEnabled: true, isReadOnly: false },
    { name: "unknown_action", isEnabled: true },
    { name: "disabled_search", isEnabled: false, isReadOnly: true },
  ],
};
const EXCERPT =
  "We agreed to review the original campaign exports before moving the advertising account.";
const URL = "https://mail.google.com/mail/u/0/#inbox/test-message";
const item = (overrides = {}) => ({
  id: "tool-1",
  type: "mcpToolCall",
  status: "completed",
  readOnlyHint: true,
  server: "codex_apps",
  tool: "gmail_search_email",
  appContext: { connectorId: APP.id, actionName: "search_email" },
  result: {
    structuredContent: { title: "Transition email", url: URL, text: EXCERPT },
    content: [{ type: "text", text: `Transition email\n${URL}\n${EXCERPT}` }],
  },
  ...overrides,
});
const answer = (overrides = {}) => ({
  sources: [
    {
      toolCallId: "tool-1",
      appId: APP.id,
      title: "Transition email",
      url: URL,
      excerpt: EXCERPT,
      ...overrides,
    },
  ],
});
const proofs = () => new Map([["tool-1", toolEvidence(item(), [APP])]]);
const options = {
  query: "What did we agree last call?",
  project: "Example client",
  sessionId: "s1",
  appIds: [APP.id],
};

class FakeRpc extends EventEmitter {
  constructor({
    accountType = "chatgpt",
    missing = false,
    blocked = false,
    hold = false,
    forged = false,
    secondPage = false,
  } = {}) {
    super();
    Object.assign(this, {
      accountType,
      missing,
      blocked,
      hold,
      forged,
      secondPage,
    });
    this.calls = [];
    this.closed = 0;
  }
  protocol() {
    return {
      sandbox: "read-only",
      approval: "untrusted",
      restrictedAccess: false,
    };
  }
  async connect() {
    this.connected = true;
  }
  close() {
    this.closed++;
    this.emit("failure", new Error("closed"));
  }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "account/read")
      return { account: { type: this.accountType } };
    if (method === "app/list")
      return this.secondPage && !params.cursor
        ? { data: [], nextCursor: "page-2" }
        : { data: [APP], nextCursor: null };
    if (method === "app/read")
      return { apps: this.missing ? [] : [APP], missingAppIds: [] };
    if (method === "app/installed")
      return {
        apps: [
          {
            id: APP.id,
            enabled: true,
            callable: !(this.blocked && params.threadId),
          },
        ],
      };
    if (method === "config/read")
      return {
        config: {
          apps: {
            _default: { enabled: true },
            [APP.id]: {
              tools: {
                send_email: { enabled: true, approval_mode: "approve" },
              },
            },
          },
          mcp_servers: { anything: { enabled: true } },
          plugins: { anything: { enabled: true } },
        },
      };
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") {
      this.turn = params;
      if (!this.hold) setImmediate(() => this.complete());
      return { turn: { id: "turn-1" } };
    }
    if (method === "thread/unsubscribe") return {};
    throw new Error(`Unexpected RPC ${method}`);
  }
  notify(method, item) {
    this.emit("notification", {
      method,
      params: { threadId: "thread-1", turnId: "turn-1", item },
    });
  }
  complete() {
    this.notify("item/started", item({ status: "inProgress", result: null }));
    this.notify("item/completed", item());
    this.notify("item/completed", {
      id: "msg-1",
      type: "agentMessage",
      text: JSON.stringify(
        answer(
          this.forged
            ? {
                excerpt:
                  "This fabricated budget has never appeared in any actual source.",
              }
            : {},
        ),
      ),
    });
    this.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", items: [] },
      },
    });
  }
}
const provider = (rpc) =>
  new CodexContextProvider({ rpc, cwd: "/tmp/callwise-test", timeoutMs: 2000 });

test("only explicitly enabled read-only tools are admitted", () => {
  assert.deepEqual(
    readOnlyTools(APP).map((x) => x.name),
    ["search_email"],
  );
});
test("per-tool policy overrides broad inherited approvals and disables unselected apps/MCP/plugins", () => {
  const policy = contextPolicy(
    {
      apps: {
        _default: { enabled: true },
        other: { enabled: true },
        [APP.id]: {
          tools: {
            send_email: { approval_mode: "approve" },
            hidden: { enabled: true },
          },
        },
      },
      mcp_servers: { shell: { enabled: true } },
      plugins: { hook: { enabled: true } },
    },
    [APP],
  );
  assert.equal(policy.apps._default.enabled, false);
  assert.equal(policy.apps.other.enabled, false);
  const p = policy.apps[APP.id];
  assert.equal(p.default_tools_enabled, false);
  assert.equal(p.destructive_enabled, false);
  assert.deepEqual(p.tools.search_email, {
    enabled: true,
    approval_mode: "writes",
  });
  for (const name of [
    "send_email",
    "unknown_action",
    "disabled_search",
    "hidden",
  ])
    assert.equal(p.tools[name].enabled, false);
  assert.equal(policy.mcp_servers.shell.enabled, false);
  assert.equal(policy.plugins.hook.enabled, false);
  assert.equal(policy["features.shell_tool"], false);
  assert.equal(policy["features.code_mode.enabled"], false);
});
test("context policy preserves explicit open-world restrictions", () => {
  assert.equal(
    contextPolicy({ apps: { _default: { open_world_enabled: false } } }, [APP])
      .apps[APP.id].open_world_enabled,
    false,
  );
});
for (const [label, change] of [
  ["failed", { status: "failed" }],
  ["read-only hint absent", { readOnlyHint: null }],
  ["read-only hint false", { readOnlyHint: false }],
  [
    "unselected app",
    { appContext: { connectorId: "other", actionName: "search_email" } },
  ],
  [
    "write action",
    { appContext: { connectorId: APP.id, actionName: "send_email" } },
  ],
  ["missing provenance", { appContext: null }],
])
  test(`tool evidence rejects ${label}`, () =>
    assert.equal(toolEvidence(item(change), [APP]), null));
test("source validation accepts exact evidence and preserves provenance without inventing modification dates", () => {
  const docs = verifyContext(answer(), proofs(), { ...options, now: 1000 });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].text, EXCERPT);
  assert.equal(docs[0].url, URL);
  assert.equal(docs[0].provenance.toolCallId, "tool-1");
  assert.equal(docs[0].updatedAt, null);
  assert.equal(docs[0].retrievedAt, "1970-01-01T00:00:01.000Z");
});
for (const [label, change] of [
  [
    "fabricated excerpt",
    {
      excerpt: "A fabricated claim that never came from the connected source.",
    },
  ],
  ["fabricated URL", { url: "https://example.com/invented" }],
  ["wrong connector", { appId: "wrong" }],
  ["unsafe URL", { url: "javascript:alert(1)" }],
  ["too-short excerpt", { excerpt: "We agreed" }],
])
  test(`source validation rejects ${label}`, () =>
    assert.deepEqual(verifyContext(answer(change), proofs()), []));
test("model-facing call IDs can resolve to an unambiguous actual result, not a made-up source", () => {
  assert.equal(
    verifyContext(answer({ toolCallId: "model-id-123" }), proofs()).length,
    1,
  );
  const proof = proofs();
  proof.set("tool-2", { ...proof.get("tool-1"), id: "tool-2" });
  assert.equal(verifyContext(answer({ toolCallId: "" }), proof).length, 0);
});
test("invented title is replaced with actual app/action metadata; missing URL is permitted", () => {
  const [doc] = verifyContext(
    answer({ title: "Fake title", url: "" }),
    proofs(),
  );
  assert.equal(doc.title, "Gmail • search_email");
  assert.equal(doc.url, "");
});
test("evidence ignores arguments and sensitive metadata", () => {
  const proof = toolEvidence(
    item({
      arguments: { key: "not-evidence" },
      result: {
        content: [],
        structuredContent: {
          _meta: "not-evidence",
          headers: "not-evidence",
          body: EXCERPT,
        },
      },
    }),
    [APP],
  );
  assert.equal(proof.text, EXCERPT);
});
test("Codex discovery paginates and exposes runtime ready state without changing global configuration", async () => {
  const rpc = new FakeRpc({ secondPage: true }),
    p = provider(rpc);
  const result = await p.inspect();
  assert.equal(result.apps[0].ready, true);
  assert.equal(result.apps[0].readOnlyToolCount, 1);
  assert.equal(rpc.calls.filter((c) => c.method === "app/list").length, 2);
  assert.ok(rpc.calls.every((c) => !c.method.includes("write")));
  p.close();
});
test("discovery handles catalogs beyond 2100 entries and still rejects repeated cursors", async () => {
  const rpc = new FakeRpc();
  const original = rpc.request.bind(rpc);
  let pages = 0;
  rpc.request = async (method, params, ...rest) => {
    if (method !== "app/list") return original(method, params, ...rest);
    pages++;
    return {
      data: pages === 37 ? [APP] : [],
      nextCursor: pages < 37 ? String(pages) : null,
    };
  };
  const p = provider(rpc);
  assert.equal((await p.inspect()).apps[0].ready, true);
  assert.equal(pages, 37);
  rpc.request = async () => ({ data: [], nextCursor: "repeated" });
  await assert.rejects(p.inventory(), /discovery did not finish/);
  p.close();
});
test("retrieval scopes a dedicated thread, uses exact app mentions, and accepts only actual tool evidence", async () => {
  const rpc = new FakeRpc(),
    p = provider(rpc);
  const docs = await p.search(options);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].project, options.project);
  const thread = rpc.calls.find((c) => c.method === "thread/start").params;
  assert.equal(thread.ephemeral, true);
  assert.equal(thread.config.apps[APP.id].tools.send_email.enabled, false);
  assert.equal(rpc.turn.input[1].path, `app://${APP.id}`);
  assert.equal(rpc.turn.sandboxPolicy.networkAccess, false);
  assert.equal(rpc.calls.at(-1).method, "thread/unsubscribe");
  assert.equal(p.busy, false);
  p.close();
});
for (const [label, config, pattern] of [
  ["API-key-only account", { accountType: "apiKey" }, /ChatGPT account/],
  ["missing read-only metadata", { missing: true }, /read-only tools/],
  ["blocked runtime", { blocked: true }, /policy prevents/],
  ["invented model evidence", { forged: true }, /could not be verified/],
])
  test(`Codex retrieval fails closed for ${label}`, async () => {
    const rpc = new FakeRpc(config),
      p = provider(rpc);
    await assert.rejects(p.search(options), pattern);
    assert.equal(p.busy, false);
    p.close();
  });
test("cancel closes the retrieval process and late events do not return sources", async () => {
  const rpc = new FakeRpc({ hold: true }),
    p = provider(rpc),
    ac = new AbortController();
  const task = p.search({ ...options, signal: ac.signal });
  const rejected = assert.rejects(task, /cancelled/);
  while (!rpc.turn) await wait(1);
  ac.abort();
  await rejected;
  rpc.complete();
  assert.ok(rpc.closed > 0);
  assert.equal(p.busy, false);
  assert.equal(rpc.listenerCount("notification"), 0);
});
test("retrieval times out and recovers for the next lookup", async () => {
  const rpc = new FakeRpc({ hold: true }),
    p = new CodexContextProvider({ rpc, cwd: "/tmp/test", timeoutMs: 20 });
  // A live socket holds the event loop open; the fake needs an equivalent handle.
  const keepalive = setInterval(() => {}, 100);
  try {
    await assert.rejects(p.search(options), /exceeded/);
    rpc.hold = false;
    p.timeoutMs = 2000;
    assert.equal((await p.search(options)).length, 1);
  } finally {
    clearInterval(keepalive);
    p.close();
  }
});
test("tool-call budget interrupts excessive retrieval", async () => {
  const rpc = new FakeRpc({ hold: true }),
    p = new CodexContextProvider({ rpc, cwd: "/tmp/test", maxToolCalls: 1 });
  const task = p.search(options),
    rejected = assert.rejects(task, /tool-call budget/);
  while (!rpc.turn) await wait(1);
  rpc.notify("item/started", item({ id: "one" }));
  rpc.notify("item/started", item({ id: "two" }));
  await rejected;
  assert.ok(rpc.closed > 0);
  p.close();
});
test("automatic gating requires both named scope and a prior-context cue; manual lookup can be generic", () => {
  assert.equal(
    shouldSearch({
      project: "A",
      recent: [{ text: "What did we agree last call?" }],
    }),
    true,
  );
  assert.equal(
    shouldSearch({ recent: [{ text: "What did we agree last call?" }] }),
    false,
  );
  assert.equal(
    shouldSearch({
      project: "A",
      recent: [{ text: "Good morning, how are you?" }],
    }),
    false,
  );
  assert.equal(shouldSearch({ query: "Budget", manual: true }), true);
});
function coordinator() {
  let now = 1000,
    calls = 0;
  const p = {
    cancel() {},
    async search() {
      calls++;
      return verifyContext(answer(), proofs(), options);
    },
  };
  const r = new ContextRetrieval({
    provider: p,
    clock: () => now,
    maxSearches: 2,
    cooldownMs: 100,
    cacheMs: 300,
  });
  return { r, p, advance: (n) => (now += n), calls: () => calls };
}
test("coordinator caches scoped evidence, returns copies, and expires it", async () => {
  const { r, advance, calls } = coordinator();
  const args = { ...options, manual: true };
  const first = await r.search(args);
  first[0].text = "mutated";
  const cached = await r.search(args);
  assert.equal(cached[0].text, EXCERPT);
  assert.equal(calls(), 1);
  advance(301);
  await r.search(args);
  assert.equal(calls(), 2);
});
test("coordinator does not reuse evidence across projects or app selections", async () => {
  const { r, calls } = coordinator();
  await r.search({ ...options, manual: true });
  await r.search({ ...options, project: "Different client", manual: true });
  assert.equal(calls(), 2);
});
test("coordinator enforces per-session lookup quota even across scope changes", async () => {
  const { r, calls } = coordinator();
  await r.search({ ...options, manual: true });
  await r.search({ ...options, query: "another lookup", manual: true });
  assert.deepEqual(
    await r.search({
      ...options,
      project: "B",
      query: "third lookup",
      manual: true,
    }),
    [],
  );
  assert.equal(calls(), 2);
  assert.equal(r.snapshot().status, "limited");
});
test("coordinator similarity suppression eventually expires", async () => {
  const { r, advance, calls } = coordinator();
  const args = {
    ...options,
    recent: [{ text: "What did we agree last call?" }],
  };
  await r.search(args);
  advance(301);
  await r.search(args);
  assert.equal(calls(), 2);
});
test("coordinator cancellation discards even an uncooperative late provider", async () => {
  let resolve;
  const { r, p } = coordinator();
  p.search = () => new Promise((r) => (resolve = r));
  const task = r.search({ ...options, manual: true });
  const rejected = assert.rejects(task);
  r.cancel();
  resolve(verifyContext(answer(), proofs(), options));
  await rejected;
  assert.equal(r.cache.size, 0);
  assert.equal(r.snapshot().status, "idle");
});
function controller() {
  return new CallController({
    contextProvider: {
      cancel() {},
      close() {},
      async inspect() {
        return { apps: [{ ...APP, ready: true, readOnlyToolCount: 1 }] };
      },
      async search(args) {
        return verifyContext(answer(), proofs(), args);
      },
    },
  });
}
async function enable(c) {
  await c.command("context.discover");
  await c.command("configure", {
    project: "Example client",
    contextBackend: "codex",
    contextApps: [APP.id],
    contextConsent: true,
  });
}
test("pre-call lookup works without an OpenAI key; consent and an explicit selection are required", async () => {
  const c = controller();
  try {
    await assert.rejects(
      c.command("context.connected", { query: "budget" }),
      /Allow selected/,
    );
    await enable(c);
    assert.equal(
      (await c.command("context.connected", { query: options.query })).added,
      1,
    );
    assert.equal(c.engine.status, "idle");
  } finally {
    c.close();
  }
});
test("unknown and malformed context selections are rejected", async () => {
  const c = controller();
  try {
    await assert.rejects(
      c.command("configure", { contextApps: ["unknown"] }),
      /Refresh/,
    );
    await assert.rejects(
      c.command("configure", { contextApps: "bad" }),
      /list/,
    );
  } finally {
    c.close();
  }
});
test("new sessions discard connector evidence but preserve saved choices and explicitly retained notes", async () => {
  const c = controller();
  try {
    await enable(c);
    await c.command("context.connected", { query: options.query });
    await c.command("context.add", {
      title: "My note",
      text: "Notes deliberately retained",
    });
    c.mode = "manual";
    await c.command("end");
    await c.command("new", { clearContext: false });
    assert.equal(c.engine.context.list().length, 1);
    assert.equal(c.engine.context.list()[0].kind, "note");
    assert.equal(c.engine.settings.contextConsent, true);
    assert.deepEqual(c.engine.settings.contextApps, [APP.id]);
    assert.equal(c.retrieval.snapshot().searches, 0);
  } finally {
    c.close();
  }
});
test("changing source permissions invalidates cached and loaded connector evidence", async () => {
  const c = controller();
  try {
    await enable(c);
    await c.command("context.connected", { query: options.query });
    await c.command("configure", { contextConsent: false });
    assert.equal(c.engine.context.list().length, 0);
    assert.equal(c.retrieval.cache.size, 0);
  } finally {
    c.close();
  }
});
test("manual note input cannot spoof verified connector provenance", async () => {
  const c = controller();
  try {
    await c.command("context.add", {
      title: "fake",
      text: EXCERPT,
      kind: "connector",
      provenance: { provider: "codex" },
    });
    const doc = c.engine.context.list()[0];
    assert.equal(doc.kind, "note");
    assert.equal(doc.provenance, undefined);
  } finally {
    c.close();
  }
});
test("fictional demo never uses connected searches", async () => {
  const c = controller();
  try {
    await enable(c);
    await c.command("start", { source: "demo" });
    await assert.rejects(
      c.command("context.connected", { query: options.query }),
      /unavailable during Practice/,
    );
    assert.equal(c.retrieval.snapshot().searches, 0);
  } finally {
    c.close();
  }
});
test("project-scoped sources cannot be retrieved by clearing the project", () => {
  const c = new ContextStore();
  c.add({ id: "a", title: "Budget", text: "Client A budget", project: "A" });
  assert.equal(c.search("budget", { project: "" }).length, 0);
});
test("fast coaching is independent of slow context retrieval", async () => {
  let finish;
  const generate = async () => ({ cards: [] });
  const e = new CoachEngine({
    providers: { fast: { generate }, strategy: { generate } },
  });
  e.configure({ autoSearch: true, quiet: true });
  e.retriever = () => new Promise((r) => (finish = r));
  e.start();
  e.ingest({ id: "a", text: options.query });
  const slow = e.run("strategy", "Find related context");
  await e.run("fast");
  assert.equal(e.snapshot().thinking.fast, false);
  assert.equal(e.snapshot().thinking.strategy, true);
  e.pause();
  finish(verifyContext(answer(), proofs(), options));
  await slow;
  assert.equal(e.context.list().length, 0);
  e.end();
});
test("RPC rejects write approvals, permissions and interactive requests rather than granting them", () => {
  const rpc = new CodexRpc();
  const sent = [];
  rpc.send = (m) => sent.push(m);
  for (const method of [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "mcpServer/elicitation/request",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
  ])
    rpc.receive({ id: sent.length, method });
  assert.equal(sent[0].result.decision, "decline");
  assert.equal(sent[1].result.decision, "decline");
  assert.equal(sent[2].result.action, "decline");
  assert.ok(sent[3].error);
  assert.ok(sent[4].error);
});
test("RPC aborted requests release their pending entry and ignore late responses", async () => {
  const rpc = new CodexRpc();
  let request;
  rpc.send = (m) => (request = m);
  const ac = new AbortController();
  const task = rpc.request("app/read", {}, 10000, ac.signal),
    rejected = assert.rejects(task, /cancelled/);
  ac.abort();
  await rejected;
  assert.equal(rpc.pending.size, 0);
  rpc.receive({ id: request.id, result: { apps: [] } });
});

test("changing clients after conversation starts requires a new session", async () => {
  const c = controller();
  try {
    await c.command("configure", { project: "A" });
    c.engine.start();
    c.engine.ingest({ id: "1", text: "Client A private context" });
    c.engine.pause();
    await assert.rejects(
      c.command("configure", { project: "B" }),
      /another call/,
    );
    assert.equal(c.engine.settings.project, "A");
  } finally {
    c.close();
  }
});

test("reserved app identifiers cannot override the default-deny policy", () => {
  assert.throws(
    () => contextPolicy({}, [{ ...APP, id: "_default" }]),
    /unsupported app/,
  );
});
test("a URL from a different search result is not attached to a verified excerpt", () => {
  const mixed = item({
    result: {
      content: [],
      structuredContent: {
        results: [
          { text: EXCERPT, url: URL, title: "Correct record" },
          {
            text: "A completely different source result.",
            url: "https://example.com/other",
            title: "Wrong record",
          },
        ],
      },
    },
  });
  const evidence = new Map([["tool-1", toolEvidence(mixed, [APP])]]);
  const [doc] = verifyContext(
    answer({ url: "https://example.com/other", title: "Wrong record" }),
    evidence,
  );
  assert.equal(doc.text, EXCERPT);
  assert.equal(doc.url, "");
  assert.equal(doc.title, "Gmail • search_email");
});
test("JSON-encoded text results are decoded before excerpt and record verification", () => {
  const text =
    'The agreed wording was "pause and review" before Monday.\nThis supersedes the older note.';
  const json = item({
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify({ text, url: URL, title: "Latest note" }),
        },
      ],
    },
  });
  const evidence = new Map([["tool-1", toolEvidence(json, [APP])]]);
  const [doc] = verifyContext(
    answer({ excerpt: text, title: "Latest note" }),
    evidence,
  );
  assert.equal(doc.url, URL);
  assert.match(doc.text, /pause and review/);
});
test("semantically selected context is not dropped by a second keyword-only filter", async () => {
  let seen;
  const e = new CoachEngine({
    providers: {
      strategy: {
        async generate({ sources }) {
          seen = sources;
          return { cards: [] };
        },
      },
    },
  });
  e.configure({ quiet: true, autoSearch: true, goal: "Help" });
  e.retriever = async () => [
    {
      id: "semantic",
      title: "Decision",
      text: "Spend remains capped at forty thousand dollars.",
    },
  ];
  e.start();
  e.ingest({
    id: "x",
    text: "Remind us what everyone committed to previously.",
  });
  await e.run("strategy", "Find related context");
  assert.equal(seen[0].id, "semantic");
  e.end();
});
