// Pre-existing (also in 0.5.0): after "Delete all Callwise data", main sets controller.preferences = {} without the
// launch defaults (liveHelp: false ...). The notice and Ready view treat the missing liveHelp as off (=== true checks),
// but CallController.setProviders() treats it as on (=== false check).
//  A. Pasting the OpenAI key again on the setup screen (desktop.connections.save) before restarting: the next meeting's
//     auto-coaching sends conversation text to OpenAI while the confirmed notice says nothing about live suggestions.
//  B. No OpenAI key: coaching falls back to Codex. That fails today only because Delete all also removed codex-work,
//     Codex's working folder (main.mjs:918), so the user sees Codex errors in a meeting shown as local-only.
// Network is stubbed; a fake Codex binary records whether it was ever executed.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const requests = [];
globalThis.fetch = async (url, init) => { requests.push({ url: String(url), body: String(init?.body || "") }); return new Response(JSON.stringify({ error: { message: "stub" } }), { status: 500 }); };
const { CallController } = await import(`${R}/core/controller.mjs`);
const { CodexProvider } = await import(`${R}/providers/codex.mjs`);
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const { startMeeting } = await import(`${R}/desktop/meeting-start.mjs`);
const dataDir = mkdtempSync(path.join(os.tmpdir(), "cw-reset-help-")), workDir = path.join(dataDir, "codex-work");
mkdirSync(workDir, { recursive: true }); // main.mjs:102, at launch only
const marker = path.join(dataDir, "codex-ran"), bin = path.join(dataDir, "fake-codex");
writeFileSync(bin, `#!/bin/sh\necho ran >> "${marker}"\nexit 1\n`);
chmodSync(bin, 0o755);
const launchDefaults = { speechEngine: "apple", language: "en-US", liveHelp: false, retainAudio: false, meetingMcpEnabled: false };
const store = new MeetingStore(path.join(dataDir, "meetings"), { key: randomBytes(32) });
const c = new CallController({ config: { openaiKey: "", fastModel: "m", strategyModel: "m" }, preferences: launchDefaults,
  codexProvider: new CodexProvider({ bin, model: "m", cwd: workDir }),
  speechFactory: () => ({ connect: async () => {}, push() {}, finish: async () => {}, close() {} }) });
const meetings = new MeetingService({ store });
c.meetingService = meetings;
meetings.attach(c);
const question = "What budget do you have for the renewal?";
async function meeting(label) {
  requests.length = 0;
  const preview = await meetings.command("meeting.notice.preview"); // what the notice sheet shows and hashes
  await startMeeting({ meetings, controller: c, payload: { source: "audio", notice: { confirmed: true, method: "spoken", configHash: preview.configHash, presentedAt: Date.now() } } });
  c.engine.ingest({ id: `system:e${c.captureEpoch}:0:run:r`, channel: "system", speaker: "Them", text: question, final: true, startMs: 1000, endMs: 3000, captureEpoch: c.captureEpoch });
  await new Promise((r) => setTimeout(r, 1200));
  console.log(`${label}:`);
  console.log(`  notice mentions live suggestions: ${/live suggestions/.test(preview.text)} | Ready shows live coaching on: ${!!c.preferences.liveHelp}`);
  console.log(`  OpenAI requests carrying the conversation: ${requests.filter((r) => r.body.includes(question)).length} | Codex binary executed: ${existsSync(marker) ? "yes" : "no"}`);
  console.log(`  errors shown: ${JSON.stringify((c.engine.snapshot?.().errors || []).map((e) => e.message.slice(0, 80)))}`);
  await c.command("end");
  await c.command("new", { clearContext: true });
}
await meeting("before Delete all");
// desktop/main.mjs "desktop.delete" (controller part, :907-944), including rmSync(workDir) at :918
c.cancelDocuments(); c.close(); rmSync(workDir, { recursive: true, force: true });
c.preferences = {}; c.sheets = []; c.config = { ...c.config, openaiKey: "", firefliesKey: "", mcpToken: "" };
c.closing = false; c.recap = null; c.engine.context.clear(); c.engine.reset(); c.setProviders(); c.mode = "demo"; c.demoStarted = false; c.engine.emitState();
await meetings.deleteAll();
await meeting("B. after Delete all, no OpenAI key (Codex fallback)");
// The setup screen's "Paste your OpenAI key" -> desktop.connections.save (main.mjs), which rebuilds config and providers
c.stopInputs(); c.config = { ...c.config, openaiKey: "sk-test-key" }; c.setProviders(); c.engine.emitState();
await meeting("A. after Delete all, OpenAI key pasted again in setup");
c.close(); meetings.close(); store.close(); rmSync(dataDir, { recursive: true, force: true });
