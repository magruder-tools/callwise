import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { resolveCodexBin } from "../core/codex-path.mjs";
import { CodexLogin, approvedLoginUrl } from "../desktop/codex-login.mjs";
import { CallController } from "../core/controller.mjs";

test("Finder launch resolves the bundled Codex helper without a shell PATH", () => {
  assert.equal(resolveCodexBin(undefined, { resources: "/App/Resources", platform: "darwin", exists: p => p === "/App/Resources/codex/codex" }), "/App/Resources/codex/codex");
});
test("an explicit Codex binary override takes precedence", () => {
  assert.equal(resolveCodexBin("/custom/codex", { exists: () => true }), "/custom/codex");
});
test("source launches retain the ordinary CLI fallback", () => {
  assert.equal(resolveCodexBin(undefined, { resources: null, platform: "darwin", exists: () => false }), "codex");
});
test("only official HTTPS ChatGPT login pages can open from the login helper", () => {
  for (const url of ["http://chatgpt.com/auth", "https://chatgpt.com.evil.example/auth", "https://user@chatgpt.com/auth", "file:///secret", "https://chatgpt.com:123/auth", "javascript:alert(1)"])
    assert.equal(approvedLoginUrl(url), "");
  assert.equal(approvedLoginUrl("https://auth.openai.com/oauth/authorize?state=example"), "https://auth.openai.com/oauth/authorize?state=example");
});
class FakeLoginRpc extends EventEmitter {
  constructor(account = null) { super(); this.account = account; this.calls = []; }
  async connect() {}
  async request(method, payload) {
    this.calls.push({ method, payload });
    if (method === "account/read") return { account: this.account };
    if (method === "account/login/start") return { type: "chatgpt", loginId: "login-1", authUrl: this.url || "https://auth.openai.com/oauth/authorize" };
    return {};
  }
  close() { this.emit("failure", new Error("closed")); }
  complete(success = true) { this.emit("notification", { method: "account/login/completed", params: { loginId: "login-1", success } }); }
}
test("existing ChatGPT sign-in is reused without launching a browser or starting a new login", async () => {
  const rpc = new FakeLoginRpc({ type: "chatgpt" });
  const login = new CodexLogin({ rpc, openBrowser: () => assert.fail("must not open") });
  assert.equal((await login.signIn()).reused, true);
  assert.deepEqual(rpc.calls.map(c => c.method), ["account/read"]);
});
test("the sign-in button uses the official browser flow, never keys or inference", async () => {
  const rpc = new FakeLoginRpc(); let opened;
  const login = new CodexLogin({ rpc, openBrowser: async url => { opened = url; rpc.complete(); } });
  assert.equal((await login.signIn()).signedIn, true);
  assert.equal(opened, "https://auth.openai.com/oauth/authorize");
  assert.deepEqual(rpc.calls.map(c => c.method), ["account/read", "account/login/start"]);
  assert.equal(rpc.listenerCount("notification"), 0);
});
test("Codex sign-in does not silently replace a different authentication method", async () => {
  const login = new CodexLogin({ rpc: new FakeLoginRpc({ type: "apiKey" }), openBrowser: () => assert.fail("must not open") });
  await assert.rejects(login.signIn(), /has not replaced/);
});
test("untrusted login links are rejected and never opened", async () => {
  const rpc = new FakeLoginRpc(); rpc.url = "https://attacker.example/signin";
  const login = new CodexLogin({ rpc, openBrowser: () => assert.fail("must not open") });
  await assert.rejects(login.signIn(), /unrecognized sign-in/);
});
test("cancelled login ignores late success and can retry", async () => {
  const rpc = new FakeLoginRpc(); let opened = false;
  const login = new CodexLogin({ rpc, openBrowser: async () => { opened = true; } });
  const promise = login.signIn(); const rejected = assert.rejects(promise, /cancelled/);
  while (!opened) await wait(1);
  login.cancel(); await rejected; rpc.complete();
  assert.equal(login.busy, false); assert.equal(rpc.listenerCount("notification"), 0);
});
test("internal session-limit pause closes input sockets rather than only stopping the renderer", () => {
  const controller = new CallController(); let closes = 0, stopped = 0;
  controller.engine.start();
  controller.transcribers.set("mic", { close() { closes++; } });
  controller.on("stop-capture", () => stopped++);
  controller.engine.pause();
  assert.equal(closes, 1); assert.equal(controller.transcribers.size, 0); assert.ok(stopped > 0);
  controller.close();
});
test("Mac package includes the helper, explicit audio permissions and no runtime secret files", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.build.extraResources.some(r => r.to === "codex"));
  assert.ok(pkg.build.mac.extendInfo.NSAudioCaptureUsageDescription);
  assert.ok(!pkg.build.files.some(r => /\.env|connections\.bin/.test(r)));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});
