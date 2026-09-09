import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexRpc, MAX_CODEX_MESSAGE_BYTES } from "../providers/codex.mjs";

async function connected() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {
    child.killed = true;
  };
  const rpc = new CodexRpc({ spawnImpl: () => child });
  const starting = rpc.connect();
  child.stdout.write('{"id":1,"result":{}}\n');
  await starting;
  return { rpc, child };
}

test("large catalog notifications do not break subsequent account replies", async () => {
  const { rpc, child } = await connected();
  try {
    const seen = [];
    rpc.on("notification", (m) => seen.push(m.method));
    const pending = rpc.request("account/read");
    const catalog =
      JSON.stringify({
        method: "app/list/updated",
        params: { data: "x".repeat(4_850_000) },
      }) + "\n";
    for (let i = 0; i < catalog.length; i += 65536)
      child.stdout.write(catalog.slice(i, i + 65536));
    child.stdout.write('{"id":2,"result":{"account":{"type":"chatgpt"}}}\n');
    assert.equal((await pending).account.type, "chatgpt");
    assert.deepEqual(seen, ["app/list/updated"]);
    assert.equal(child.killed, undefined);
  } finally {
    rpc.close();
  }
});

test("coalesced messages are limited individually, not as one read", async () => {
  const { rpc, child } = await connected();
  try {
    let count = 0;
    rpc.on("notification", () => count++);
    const line =
      JSON.stringify({ method: "test", params: "x".repeat(9_000_000) }) + "\n";
    child.stdout.write(line + line);
    assert.equal(count, 2);
    assert.equal(child.killed, undefined);
  } finally {
    rpc.close();
  }
});

for (const terminated of [true, false]) {
  test(`oversized ${terminated ? "complete" : "partial"} UTF-8 messages close and reject pending requests`, async () => {
    const { rpc, child } = await connected();
    const pending = rpc.request("account/read");
    const rejected = assert.rejects(pending, /oversized response/);
    // Multibyte content exceeds the byte cap while remaining under it in characters.
    const line = JSON.stringify({
      method: "test",
      params: "é".repeat(MAX_CODEX_MESSAGE_BYTES / 2),
    });
    child.stdout.write(line + (terminated ? "\n" : ""));
    await rejected;
    assert.equal(child.killed, true);
    assert.equal(rpc.buffer, "");
    assert.equal(rpc.pending.size, 0);
  });
}
