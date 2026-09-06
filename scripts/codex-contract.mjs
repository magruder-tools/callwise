// Credential-free protocol verification. NO turn/start, inference, account reuse,
// key reads, connector content, or changes to the user's Codex configuration.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexRpc } from "../providers/codex.mjs";
import { contextPolicy } from "../providers/codex-context.mjs";
const home = mkdtempSync(path.join(tmpdir(), "callwise-contract-"));
const cwd = path.join(home, "work"),
  codexHome = path.join(home, "codex");
mkdirSync(cwd);
mkdirSync(codexHome);
const bin = process.env.CALLWISE_CODEX_BIN || "codex";
const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome };
const rpc = new CodexRpc({
  bin,
  cwd,
  spawnImpl: (b, args, opts) => spawn(b, args, { ...opts, env }),
});
const report = { noCredentials: true, noInference: true };
try {
  report.version = execFileSync(bin, ["--version"], {
    encoding: "utf8",
    env,
    timeout: 5000,
  }).trim();
  report.protocol = rpc.protocol();
  await rpc.connect();
  report.handshake = true;
  const { account } = await rpc.request("account/read", {}, 10000);
  assert.equal(account, null);
  report.isolatedAccount = true;
  const meta = await rpc.request(
    "app/read",
    { appIds: [], includeTools: true },
    10000,
  );
  assert.ok(Array.isArray(meta.apps));
  report.appReadAccepted = true;
  const runtime = await rpc.request(
    "app/installed",
    { forceRefresh: false },
    10000,
  );
  assert.ok(Array.isArray(runtime.apps));
  report.runtimeAccepted = true;
  const policy = contextPolicy({}, [
    {
      id: "callwise-test-app",
      name: "Example",
      toolSummaries: [{ name: "search", isEnabled: true, isReadOnly: true }],
    },
  ]);
  const { thread } = await rpc.request(
    "thread/start",
    {
      model: "gpt-6-astra",
      cwd,
      ephemeral: true,
      approvalPolicy: report.protocol.approval,
      sandbox: report.protocol.sandbox,
      config: policy,
      developerInstructions:
        "Offline configuration probe only. No inference or tools.",
    },
    15000,
  );
  assert.ok(thread?.id);
  report.policyAccepted = true;
  await rpc.request("thread/unsubscribe", { threadId: thread.id }, 5000);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`Codex contract verification failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rpc.close();
  rmSync(home, { recursive: true, force: true });
}
