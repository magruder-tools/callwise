import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureAssistantActivation, mainWindowLaunch, promoteMainApplication } from "../desktop/activation.mjs";
import { runMeetingMcp } from "../desktop/meeting-mcp.mjs";
const tick = () => new Promise(resolve => setImmediate(resolve));

class App extends EventEmitter {
  isPackaged = true;
  policy = null;
  graphicsDisabled = false;
  dockVisible = false;
  dock = { show: async () => { this.dockVisible = true; } };
  setActivationPolicy(policy) { this.policy = policy; }
  disableHardwareAcceleration() { this.graphicsDisabled = true; }
}

test("assistant startup stays background-only and only a user activation opens the normal app", async () => {
  const app = new App(), commands = []; let finish;
  const stop = configureAssistantActivation({ app, headless: true, platform: "darwin", executable: "/Applications/Callwise.app/Contents/MacOS/Callwise", root: "/source", launch: command => { commands.push(command); return new Promise(resolve => finish = resolve); } });
  assert.equal(app.policy, "accessory"); assert.equal(app.graphicsDisabled, true);
  await tick(); assert.equal(commands.length, 0);
  app.emit("activate"); app.emit("activate"); await tick();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], { command: "/usr/bin/open", args: ["-n", "/Applications/Callwise.app", "--args", "--show-window"] });
  finish(); await tick();
  stop(); app.emit("activate"); await tick(); assert.equal(commands.length, 1);
});

test("normal GUI and non-Mac startup preserve their graphics and platform behavior", async () => {
  const app = new App(); configureAssistantActivation({ app, headless: false, platform: "darwin", root: "/source" });
  assert.equal(app.policy, null); assert.equal(app.graphicsDisabled, false); assert.equal(app.listenerCount("activate"), 0);
  await promoteMainApplication(app, "darwin"); assert.equal(app.policy, "regular"); assert.equal(app.dockVisible, true);
  const linux = new App(); configureAssistantActivation({ app: linux, headless: true, platform: "linux", root: "/source" });
  promoteMainApplication(linux, "linux"); assert.equal(linux.policy, null); assert.equal(linux.graphicsDisabled, false);
});

test("GUI activation preserves development paths as arguments and recovers after an open error", async () => {
  assert.deepEqual(mainWindowLaunch({ executable: "/Build Tools/Electron.app/Contents/MacOS/Electron", root: "/Work Folder/callwise", packaged: false }).args,
    ["-n", "/Build Tools/Electron.app", "--args", "/Work Folder/callwise", "--show-window"]);
  const app = new App(), errors = []; let calls = 0;
  const stop = configureAssistantActivation({ app, headless: true, platform: "darwin", executable: "/Applications/Callwise.app/Contents/MacOS/Callwise", root: "/source", launch: async () => { if (++calls === 1) throw new Error("Synthetic open failure"); }, onError: error => errors.push(error.message) });
  app.emit("activate"); await tick(); app.emit("activate"); await tick();
  assert.equal(calls, 2); assert.deepEqual(errors, ["Synthetic open failure"]); stop();
});

test("assistant connection shutdown is graceful, leaves other connections working and never opens storage during discovery", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "callwise-background-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  function connection() {
    const input = new PassThrough(), output = new PassThrough(), signals = new EventEmitter(), replies = [];
    let text = "", quit = 0;
    output.on("data", chunk => { text += chunk; let i; while ((i = text.indexOf("\n")) >= 0) { replies.push(JSON.parse(text.slice(0, i))); text = text.slice(i + 1); } });
    const storage = new Proxy({}, { get() { assert.fail("Public discovery must not touch Keychain or saved files"); } });
    const done = runMeetingMcp({ directory, input, output, signals, storage, app: { quit: () => quit++ } });
    const send = (id, method, params = {}) => input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return { input, signals, replies, done, send, quit: () => quit };
  }
  const a = connection(), b = connection();
  for (const c of [a, b]) c.send(1, "initialize", { protocolVersion: "2025-11-25" });
  const deadline = Date.now() + 3000;
  while ((!a.replies.length || !b.replies.length) && Date.now() < deadline) await tick();
  assert.equal(a.replies[0].result.serverInfo.version, JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version);
  a.send(2, "tools/list"); a.send(3, "tools/call", { name: "prep_guide", arguments: {} });
  while (a.replies.length < 3 && Date.now() < deadline) await tick();
  assert.equal(a.replies[1].result.tools.length, 7); assert.equal(a.replies[2].result.isError, false);
  a.signals.emit("SIGTERM"); await a.done; assert.equal(a.quit(), 1); assert.equal(a.signals.listenerCount("SIGTERM"), 0);
  b.send(2, "ping");
  while (b.replies.length < 2 && Date.now() < deadline) await tick();
  assert.deepEqual(b.replies[1].result, {}); assert.equal(b.quit(), 0);
  b.input.end(); await b.done; assert.equal(b.quit(), 1);
});
