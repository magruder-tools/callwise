// Native macOS regression: two real assistant connections, synthetic data only.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import path from "node:path";
import { rmSync } from "node:fs";
import os from "node:os";

assert.equal(process.platform, "darwin", "Run this check on a Mac.");
const bundle = path.resolve(process.argv[2]);
assert.equal(execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :LSUIElement", path.join(bundle, "Contents/Info.plist")], { encoding: "utf8" }).trim(), "true");
const version = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", path.join(bundle, "Contents/Info.plist")], { encoding: "utf8" }).trim();
const executable = path.join(bundle, "Contents/MacOS/Callwise");
const connections = [];
function connection() {
  const child = spawn(executable, ["--mcp-server", "--smoke"], { stdio: ["pipe", "pipe", "pipe"] });
  const replies = new Map(); let buffered = "", stderr = "", id = 0;
  const closed = once(child, "exit");
  child.stdout.on("data", chunk => {
    buffered += chunk;
    let end;
    while ((end = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
      const result = JSON.parse(line); replies.set(result.id, result);
    }
  });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const c = { child, closed, get stderr() { return stderr; }, async call(method, params = {}) {
    const requestId = ++id;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
    const deadline = Date.now() + 10000;
    while (!replies.has(requestId) && Date.now() < deadline) {
      assert.equal(child.exitCode, null, stderr); await wait(20);
    }
    assert.ok(replies.has(requestId), `Assistant response timed out: ${method}`);
    const result = replies.get(requestId); assert.equal(result.error, undefined); return result.result;
  } };
  connections.push(c); return c;
}
try {
  const first = connection(), second = connection();
  for (const c of [first, second]) {
    const init = await c.call("initialize", { protocolVersion: "2025-11-25", clientInfo: { name: "synthetic-background-check" } });
    assert.equal(init.serverInfo.version, version);
    assert.equal((await c.call("tools/list")).tools.length, 7);
    assert.equal((await c.call("tools/call", { name: "prep_guide", arguments: {} })).isError, false);
    assert.equal((await c.call("tools/call", { name: "meeting_list", arguments: {} })).isError, true);
    assert.equal((await c.call("tools/call", { name: "prep_pack_list", arguments: {} })).isError, true);
  }
  await wait(400);
  for (const c of [first, second]) {
    const ready = c.stderr.split("\n").find(line => line.includes('"event":"assistant.ready"'));
    assert.ok(ready, "Missing native background startup observation");
    assert.deepEqual(JSON.parse(ready), { event: "assistant.ready", windows: 0, dockVisible: false });
    assert.equal(c.stderr.includes('"event":"assistant.activation"'), false, "Background startup must not open the GUI");
  }
  first.child.kill("SIGTERM");
  assert.deepEqual(await Promise.race([first.closed, wait(5000).then(() => { throw new Error("Assistant did not shut down gracefully"); })]), [0, null]);
  assert.deepEqual(await second.call("ping"), {});
  second.child.stdin.end();
  assert.deepEqual(await Promise.race([second.closed, wait(5000).then(() => { throw new Error("Assistant did not close after stdin EOF"); })]), [0, null]);
  console.log("Packaged assistant check passed: two background connections, no Dock or window activation, seven tools, public guide, disabled consent gates, graceful stop, independent connection and EOF cleanup. Synthetic data only.");
} finally {
  for (const c of connections) {
    if (c.child.exitCode === null) { c.child.kill("SIGKILL"); await c.closed; }
    rmSync(path.join(os.tmpdir(), `callwise-native-smoke-${c.child.pid}`), { recursive: true, force: true });
  }
}
