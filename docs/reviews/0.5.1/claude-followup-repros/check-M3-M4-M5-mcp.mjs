// 0.5.1 re-check of M3 (search freshness), M4 (legacy metadata and version negotiation) and M5 (per-meeting consent)
// through the real headless server loop (runMeetingMcp) against a separate writer connection.
import { mkdtempSync, rmSync } from "node:fs";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { runMeetingMcp } = await import(`${R}/desktop/meeting-mcp.mjs`);
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { savePreferences } = await import(`${R}/core/preferences.mjs`);
const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "keychain",
  encryptString: (s) => Buffer.from("x" + s), decryptString: (b) => Buffer.from(b).toString().slice(1) };
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-mcp51-"));
savePreferences(path.join(dir, "preferences.bin"), storage, { meetingMcpEnabled: true });
const app = new MeetingStore(path.join(dir, "meetings"), { storage }); // the running app's writer
const ids = { A: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", C: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", D: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
const add = (k, title, words, extra) => {
  app.put("meetings", ids[k], ids[k], { title, people: ["Dana"], createdAt: Date.now(), durationMs: 60000, ...extra });
  app.put("segments", ids[k], "system:e1:0:run:r", { text: words, speaker: "Them", channel: "system", final: true, startMs: 0, endMs: 2000 });
};
add("A", "Alpha budget review", "We approved the alpha budget.", { status: "ended", assistantAccess: true });
add("B", "Bravo budget (recorded before assistant access)", "Bravo budget is confidential.", { status: "ended" });
add("C", "Charlie budget (still running)", "Charlie budget draft.", { status: "running", assistantAccess: true });
const input = new PassThrough(), output = new PassThrough(), replies = createInterface({ input: output });
const queue = [];
replies.on("line", (l) => queue.shift()?.(JSON.parse(l)));
const rpc = (id, method, params) => new Promise((resolve) => { queue.push(resolve); input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const done = runMeetingMcp({ app: null, storage, directory: dir, input, output });
const text = (r) => (r.result ? r.result.content?.[0]?.text : `error ${r.error.code}: ${r.error.message}`);
const call = async (id, name, args, extra = {}) => text(await rpc(id, "tools/call", { name, arguments: args, ...extra }));
const titles = (s) => { try { return JSON.parse(s).meetings.map((m) => m.title); } catch { return s; } };
console.log("initialize 2025-06-18 ->", (await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "client" } })).result?.protocolVersion);
console.log("M5 search 'budget':", titles(await call(2, "meeting_search", { query: "budget" })));
console.log("M5 list:", titles(await call(3, "meeting_list", {})));
console.log("M5 get B (no consent):", await call(4, "meeting_get", { meetingId: ids.B }));
console.log("M5 excerpt C (running):", await call(5, "meeting_excerpt", { meetingId: ids.C }));
add("D", "Delta budget", "Delta budget saved after the first search.", { status: "ended", assistantAccess: true });
console.log("M3 search 'delta' after a meeting is saved by the app:", titles(await call(6, "meeting_search", { query: "delta" })));
console.log("M4 legacy tools/call with _meta.progressToken:", titles(await call(7, "meeting_list", {}, { _meta: { progressToken: "p1" } })));
input.end();
await done;
const { MeetingMcp } = await import(`${R}/desktop/meeting-mcp.mjs`);
const legacy = new MeetingMcp({ enabled: () => true, store: {}, search: {} });
for (const v of ["2024-11-05", "2025-12-31"])
  console.log(`M4 initialize ${v} ->`, (await legacy.handle({ jsonrpc: "2.0", id: 9, method: "initialize", params: { protocolVersion: v, capabilities: {} } })).protocolVersion);
app.close();
rmSync(dir, { recursive: true, force: true });
