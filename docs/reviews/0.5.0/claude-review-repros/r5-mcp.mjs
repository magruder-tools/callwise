// Repro: (a) the headless MCP search index is built once and never refreshed; (b) legacy requests that carry _meta
// (e.g. progressToken) are rejected; (c) initialize does not negotiate an older protocol version.
import { mkdtempSync, rmSync } from "node:fs";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import os from "node:os"; import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { runMeetingMcp, MeetingMcp } = await import(`${R}/desktop/meeting-mcp.mjs`);
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { savePreferences } = await import(`${R}/core/preferences.mjs`);
// Stand-in for Electron safeStorage (same interface the app uses)
const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "keychain",
  encryptString: (s) => Buffer.from("x" + s), decryptString: (b) => Buffer.from(b).toString().slice(1) };
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-mcp-"));
savePreferences(path.join(dir, "preferences.bin"), storage, { meetingMcpEnabled: true });
const app = new MeetingStore(path.join(dir, "meetings"), { storage }); // the running Callwise app's writer
const add = (id, title, words) => { app.put("meetings", id, id, { title, people: ["Dana"], status: "ended", createdAt: Date.now(), durationMs: 60000 });
  app.put("segments", id, "system:e1:0", { text: words, speaker: "Them", channel: "system", final: true, startMs: 0, endMs: 2000 }); };
add("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Alpha budget review", "We approved the alpha budget.");
const input = new PassThrough(), output = new PassThrough(), replies = createInterface({ input: output });
const queue = []; replies.on("line", (l) => queue.shift()?.(JSON.parse(l)));
const rpc = (id, method, params) => new Promise((resolve) => { queue.push(resolve); input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const done = runMeetingMcp({ app: null, storage, directory: dir, input, output });
const text = (r) => r.result ? r.result.content?.[0]?.text : `error ${r.error.code}: ${r.error.message}`;
console.log("initialize 2025-06-18:", (await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "client" } })).result?.protocolVersion);
const search = async (id, q) => JSON.parse(text(await rpc(id, "tools/call", { name: "meeting_search", arguments: { query: q } }))).meetings.map((m) => m.title);
console.log("search 'alpha':", await search(2, "alpha"));
add("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Bravo pricing call", "Bravo pricing goes up in March.");
console.log("meeting_list after a new meeting is saved:", JSON.parse(text(await rpc(3, "tools/call", { name: "meeting_list", arguments: {} }))).meetings.map((m) => m.title));
console.log("search 'bravo' in the same MCP session:", await search(4, "bravo"));
console.log("legacy tools/call with _meta.progressToken:", text(await rpc(5, "tools/call", { name: "meeting_list", arguments: {}, _meta: { progressToken: "p1" } })));
input.end(); await done;
const legacy = new MeetingMcp({ enabled: () => true, store: {}, search: {} });
for (const v of ["2024-11-05", "2025-12-31"]) {
  try { console.log(`initialize ${v}:`, (await legacy.handle({ jsonrpc: "2.0", id: 9, method: "initialize", params: { protocolVersion: v, capabilities: {} } })).protocolVersion); }
  catch (e) { console.log(`initialize ${v}: error ${e.code} ${e.message}`); }
}
app.close(); rmSync(dir, { recursive: true, force: true });
