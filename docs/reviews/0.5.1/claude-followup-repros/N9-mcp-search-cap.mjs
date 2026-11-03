// New in 0.5.1 (minor): meeting_search applies the per-meeting consent filter after the search worker has already
// cut results to its top 100, so a consented meeting can be missing when 100+ older meetings recorded without
// assistant access rank above it. The MCP process also decrypts and indexes every non-consented meeting.
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingSearch } = await import(`${R}/desktop/meeting-search.mjs`);
const { MeetingMcp } = await import(`${R}/desktop/meeting-mcp.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-mcp-cap-")), key = randomBytes(32);
const w = new MeetingStore(dir, { key, keyId: "k" });
w.transaction(() => {
  for (let i = 0; i < 120; i++) {
    const id = randomUUID();
    w.put("meetings", id, id, { title: `Budget review ${i}`, people: [], status: "ended", createdAt: i, durationMs: 1 }); // before assistant access
    w.put("segments", id, "system:e1:0:run:r", { text: "Budget, budget: the budget again.", speaker: "Them", channel: "system", final: true, startMs: 0, endMs: 1 });
  }
});
const consented = randomUUID();
w.put("meetings", consented, consented, { title: "Vendor sync", people: [], status: "ended", assistantAccess: true, createdAt: 1000, durationMs: 1 });
w.put("segments", consented, "system:e1:0:run:r", { text: "We went through the agenda, the hiring plan, and finally the budget, which is approved.", speaker: "Them", channel: "system", final: true, startMs: 0, endMs: 1 });
const ro = new MeetingStore(dir, { key, keyId: "k", readOnly: true });
const search = new MeetingSearch(ro);
const mcp = new MeetingMcp({ enabled: () => true, store: ro, search });
console.log("meeting_list:", (await mcp.call("meeting_list", {})).meetings.map((m) => m.title));
console.log("meeting_search 'budget':", (await mcp.call("meeting_search", { query: "budget" })).meetings.map((m) => m.title));
console.log("meeting_search 'approved':", (await mcp.call("meeting_search", { query: "approved" })).meetings.map((m) => m.title));
search.close(); ro.close(); w.close(); rmSync(dir, { recursive: true, force: true });
