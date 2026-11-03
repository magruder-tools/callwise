// New in 0.5.1: "Delete all Callwise data" replaces meetings/ (store.reset() removes the directory and creates a new
// library and key), but a headless MCP server that already opened the library keeps its read connection to the
// deleted files and its copy of the old key. Once assistant access is switched on again, the same Claude/Codex
// session reads the deleted meetings, and cannot see new ones, until the assistant app restarts the server.
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { runMeetingMcp } = await import(`${R}/desktop/meeting-mcp.mjs`);
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const { savePreferences } = await import(`${R}/core/preferences.mjs`);
const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "keychain",
  encryptString: (s) => Buffer.from("x" + s), decryptString: (b) => Buffer.from(b).toString().slice(1) };
const userData = mkdtempSync(path.join(os.tmpdir(), "cw-mcp-reset-"));
const prefs = path.join(userData, "preferences.bin");
savePreferences(prefs, storage, { meetingMcpEnabled: true });
const store = new MeetingStore(path.join(userData, "meetings"), { storage }); // the app's writer
const meetings = new MeetingService({ store });
const add = (id, title, notes) => {
  store.put("meetings", id, id, { title, people: ["Dana"], status: "ended", assistantAccess: true, createdAt: Date.now(), durationMs: 60000 });
  store.put("docs", id, "notes:original", { text: notes, version: 1, lineTimes: [] });
  store.put("segments", id, "system:e1:0:run:r", { text: notes, speaker: "Them", channel: "system", final: true, startMs: 0, endMs: 2000 });
};
const secret = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
add(secret, "Confidential salary talk", "Dana's current salary is 180k.");
// Claude Desktop / Codex keeps this process for its whole session.
const input = new PassThrough(), output = new PassThrough(), replies = createInterface({ input: output });
const queue = [];
replies.on("line", (l) => queue.shift()?.(JSON.parse(l)));
let n = 0;
const rpc = (method, params) => new Promise((resolve) => { queue.push(resolve); input.write(JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) + "\n"); });
const done = runMeetingMcp({ app: null, storage, directory: userData, input, output });
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); return r.result.content[0].text; };
const titles = (s) => { try { return JSON.parse(s).meetings.map((m) => m.title); } catch { return s; } };
await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "claude-desktop" } });
console.log("1. before Delete all, meeting_list:", titles(await call("meeting_list", {})), "| meeting_search 'salary':", titles(await call("meeting_search", { query: "salary" })));
// desktop.delete in main.mjs: preferences removed, meetings.deleteAll() -> store.reset()
unlinkSync(prefs);
await meetings.deleteAll();
console.log("2. right after Delete all, meeting_list:", titles(await call("meeting_list", {})));
// Later the user sets Callwise up again and turns assistant access back on; a new meeting is saved.
savePreferences(prefs, storage, { meetingMcpEnabled: true });
add("ffffffff-ffff-4fff-8fff-ffffffffffff", "First meeting after the reset", "Kickoff notes.");
console.log("   rows in the app's new library:", store.db.prepare("SELECT count(*) c FROM meetings").get().c);
console.log("3. same MCP session, meeting_list:", titles(await call("meeting_list", {})));
console.log("   meeting_search 'salary':", titles(await call("meeting_search", { query: "salary" })));
const got = await call("meeting_get", { meetingId: secret });
let shown;
try { shown = `notes: ${JSON.parse(JSON.parse(got).content).notes?.text}`; } catch { shown = got; }
console.log("   meeting_get deleted meeting ->", shown);
input.end();
await done;
meetings.close(); store.close();
rmSync(userData, { recursive: true, force: true });
