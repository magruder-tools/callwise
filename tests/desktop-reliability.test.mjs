import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Diagnostics } from "../desktop/diagnostics.mjs";
import { SessionShortcuts, SESSION_SHORTCUTS } from "../desktop/shortcuts.mjs";
import { importFiles } from "../desktop/import-files.mjs";
import { ContextStore } from "../core/context.mjs";

test("shortcuts register only while running, report conflicts, and release on pause and end", () => {
  const active = new Set(),
    failures = [],
    registered = [];
  const shortcuts = new SessionShortcuts(
    {
      register: (accelerator, action) => {
        assert.equal(typeof action, "function");
        registered.push(accelerator);
        if (accelerator.endsWith("Space")) return false;
        active.add(accelerator);
        return true;
      },
      unregister: (accelerator) => active.delete(accelerator),
    },
    Object.fromEntries(
      Object.keys(SESSION_SHORTCUTS).map((key) => [key, () => {}]),
    ),
    (key) => {
      failures.push(key);
      shortcuts.sync("running");
    },
  );
  shortcuts.sync("idle");
  assert.equal(active.size, 0);
  shortcuts.sync("running");
  assert.equal(active.size, 4);
  assert.equal(failures.length, 1);
  shortcuts.sync("running");
  assert.equal(
    registered.length,
    5,
    "snapshots do not re-register or repeat conflicts",
  );
  assert.ok(
    registered.every((accelerator) => accelerator.startsWith("Control+Alt+")),
  );
  shortcuts.sync("paused");
  assert.equal(active.size, 0);
  shortcuts.sync("running");
  assert.equal(active.size, 4);
  shortcuts.sync("ended");
  assert.equal(active.size, 0);
});

test("file import handles valid, oversized, missing, and empty files independently", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "callwise-import-"));
  try {
    const filenames = [
      "first.txt",
      "large.txt",
      "second.md",
      "missing.txt",
      "empty.txt",
    ].map((name) => path.join(dir, name));
    writeFileSync(filenames[0], "First useful note");
    writeFileSync(filenames[1], "x".repeat(10 * 1024 * 1024 + 1));
    writeFileSync(filenames[2], "Second useful note");
    writeFileSync(filenames[4], "  ");
    const context = new ContextStore();
    const result = await importFiles(filenames, context, "Test project");
    assert.equal(result.imported, 2);
    assert.equal(result.skipped.length, 3);
    assert.match(
      result.message,
      /2 added, 3 skipped: too large.*could not read.*no extractable text/,
    );
    assert.equal(context.list().length, 2);
    assert.equal(context.docs.values().next().value.project, "Test project");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("diagnostics rotate five bounded files, copy 200 recent events, and never include keys or call content", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "callwise-log-"));
  try {
    const log = new Diagnostics(dir, {
      maxBytes: 10000,
      versions: {
        app: "0.3.1",
        os: "darwin 25.0",
        electron: "44.2.0",
        node: "22.12.0",
      },
    });
    for (let i = 0; i < 500; i++)
      log.write("provider.error", {
        status: 401,
        code: "invalid_api_key",
        type: "authentication_error",
        attempt: i,
        apiKey: "SECRET_KEY",
        transcript: "PRIVATE_TRANSCRIPT",
        prompt: "PRIVATE_PROMPT",
        response: "PRIVATE_RESPONSE",
        goal: "PRIVATE_GOAL",
        state: "PRIVATE_CAPTURE_STATE",
      });
    log.write("transcription.error", {
      code: "sk-project-sensitive",
      type: "Transcript with spaces",
    });
    const files = readdirSync(dir);
    assert.equal(files.length, 5);
    assert.ok(
      files.every((file) => statSync(path.join(dir, file)).size <= 10000),
    );
    assert.ok(
      files.every(
        (file) => (statSync(path.join(dir, file)).mode & 0o777) === 0o600,
      ),
    );
    const content = files
      .map((file) => readFileSync(path.join(dir, file), "utf8"))
      .join("");
    assert.doesNotMatch(content, /SECRET|PRIVATE|sk-project/);
    const copied = log.copy({
      status: "running",
      source: "audio",
      config: {
        openaiKey: "SECRET_KEY",
        mcpToken: "SECRET_TOKEN",
        fastModel: "PRIVATE_MODEL",
      },
      preferences: {
        goal: "PRIVATE_GOAL",
        profile: "PRIVATE_PROFILE",
        project: "PRIVATE_PROJECT",
        contextApps: ["PRIVATE_APP"],
        contextBackend: "codex",
      },
    });
    assert.doesNotMatch(copied, /SECRET|PRIVATE/);
    const events = copied.split("Recent events\n")[1].split("\n");
    assert.equal(events.length, 200);
    assert.equal(JSON.parse(events.at(-2)).attempt, 499);
    assert.match(copied, /44.2.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
