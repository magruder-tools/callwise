import test from "node:test";
import assert from "node:assert/strict";
import { MeetingMcp, MEETING_TOOLS } from "../desktop/meeting-mcp.mjs";
import {
  previewAssistantInstall,
  installAssistant,
} from "../desktop/meeting-mcp-install.mjs";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};
const request = (method, params = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params,
});
function server() {
  let enabled = true;
  const m = {
    id: "m",
    title: "Sample",
    people: [],
    createdAt: 1,
    status: "ended",
  };
  return {
    set: (v) => (enabled = v),
    s: new MeetingMcp({
      enabled: () => enabled,
      store: { all: (t) => (t === "meetings" ? [m] : []), get: () => m },
      search: { search: async () => [] },
    }),
  };
}
test("meeting MCP supports stateless modern metadata, discovery and legacy initialization", async () => {
  const { s } = server();
  const d = await s.handle(request("server/discover", { _meta: meta }));
  assert.equal(d.resultType, "complete");
  assert.equal(d.supportedVersions[0], "2026-07-28");
  assert.equal(
    (await s.handle(request("tools/list", { _meta: meta }))).tools.length,
    7,
  );
  await assert.rejects(
    s.handle(request("tools/list")),
    (e) => e.code === -32602,
  );
  await s.handle(request("initialize", { protocolVersion: "2025-06-18" }));
  assert.equal((await s.handle(request("tools/list"))).tools.length, 7);
  await assert.rejects(
    s.handle(
      request("tools/list", {
        _meta: {
          ...meta,
          "io.modelcontextprotocol/protocolVersion": "1900-01-01",
        },
      }),
    ),
    (e) => e.code === -32022,
  );
});
test("meeting access is checked on every call and tools expose no writes or audio", async () => {
  const { s, set } = server();
  assert.ok(
    MEETING_TOOLS.every(
      (t) => t.annotations.readOnlyHint && !t.annotations.destructiveHint,
    ),
  );
  await s.call("meeting_list", {});
  set(false);
  await assert.rejects(s.call("meeting_list", {}), /access is off/);
  set(true);
  await assert.rejects(s.call("meeting_delete", { meetingId: "m" }), /Unknown/);
  await assert.rejects(s.call("meeting_list", { arbitrary: true }), /Invalid/);
});
test("assistant setup preserves personal_mac and unrelated configuration, backs up and rejects a stale preview", (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "callwise-install-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, ".codex"));
  const file = path.join(home, ".codex/config.toml"),
    before =
      '[mcp_servers.personal_mac]\ncommand = "existing"\n\n[other]\nchoice = true\n';
  writeFileSync(file, before);
  const args = {
    target: "codex",
    executable: "/Applications/Callwise.app/Contents/MacOS/Callwise",
    packaged: true,
    home,
  };
  let p = previewAssistantInstall(args);
  assert.match(p.after, /personal_mac/);
  const result = installAssistant(p);
  assert.equal(readFileSync(result.backup, "utf8"), before);
  p = previewAssistantInstall(args);
  assert.equal((p.after.match(/\[mcp_servers.callwise\]/g) || []).length, 1);
  writeFileSync(file, "changed");
  assert.throws(() => installAssistant(p), /changed/);
});
