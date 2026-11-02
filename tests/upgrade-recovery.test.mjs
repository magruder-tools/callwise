import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readConnectionsWithMigration } from "../core/connection-migration.mjs";
import { readConnections, saveConnections } from "../core/connections.mjs";
import { sendToWindows, closeOnce } from "../desktop/lifecycle.mjs";

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) =>
    Buffer.from("encrypted:" + Buffer.from(s).toString("base64")),
  decryptString: (b) => {
    assert.ok(b.toString().startsWith("encrypted:"));
    return Buffer.from(b.toString().slice(10), "base64").toString();
  },
};
function withDirectory(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "callwise-upgrade-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("upgrades recover legacy credentials into encrypted settings and survive restart", () =>
  withDirectory((dir) => {
    const legacy =
      'OPENAI_API_KEY="TEST_LEGACY_KEY"\nCALLWISE_FAST_MODEL=gpt-5.6-luna\n';
    writeFileSync(path.join(dir, ".env.local"), legacy);
    const migrated = readConnectionsWithMigration(dir, storage);
    assert.equal(migrated.openaiKey, "TEST_LEGACY_KEY");
    assert.equal(migrated.fastModel, "gpt-5.6-luna");
    assert.deepEqual(
      readConnections(path.join(dir, "connections.bin"), storage),
      migrated,
    );
    assert.equal(readFileSync(path.join(dir, ".env.local"), "utf8"), legacy);
    assert.doesNotMatch(
      readFileSync(path.join(dir, "connections.bin")).toString(),
      /TEST_LEGACY_KEY/,
    );
    assert.deepEqual(readConnectionsWithMigration(dir, storage), migrated);
  }));
test("migration retains newer encrypted choices and only fills missing settings", () =>
  withDirectory((dir) => {
    saveConnections(path.join(dir, "connections.bin"), storage, {
      openaiKey: "NEWER_SAVED_KEY",
      strategyModel: "gpt-6-astra",
    });
    writeFileSync(
      path.join(dir, ".env.local"),
      "OPENAI_API_KEY=TEST_LEGACY_KEY\nCALLWISE_STRATEGY_MODEL=older-model\nCALLWISE_TRANSCRIPTION_MODEL=gpt-live-transcribe\nCALLWISE_CODEX_BIN=/untrusted/tool\n",
    );
    assert.deepEqual(readConnectionsWithMigration(dir, storage), {
      openaiKey: "NEWER_SAVED_KEY",
      strategyModel: "gpt-6-astra",
      transcriptionModel: "gpt-live-transcribe",
    });
  }));
test("migration preserves an unreadable vault instead of overwriting credentials", () =>
  withDirectory((dir) => {
    writeFileSync(path.join(dir, "connections.bin"), "UNREADABLE_VAULT");
    writeFileSync(
      path.join(dir, ".env.local"),
      "OPENAI_API_KEY=TEST_LEGACY_KEY",
    );
    assert.throws(
      () => readConnectionsWithMigration(dir, storage),
      /could not be unlocked/,
    );
    assert.equal(
      readFileSync(path.join(dir, "connections.bin"), "utf8"),
      "UNREADABLE_VAULT",
    );
  }));
test("migration rejects linked settings and unavailable encryption without creating a vault", () =>
  withDirectory((dir) => {
    writeFileSync(path.join(dir, "original"), "OPENAI_API_KEY=TEST_LEGACY_KEY");
    symlinkSync(path.join(dir, "original"), path.join(dir, ".env.local"));
    assert.throws(() => readConnectionsWithMigration(dir, storage), /invalid/);
    assert.equal(existsSync(path.join(dir, "connections.bin")), false);
    rmSync(path.join(dir, ".env.local"));
    writeFileSync(
      path.join(dir, ".env.local"),
      "OPENAI_API_KEY=TEST_LEGACY_KEY",
    );
    assert.throws(
      () =>
        readConnectionsWithMigration(dir, {
          isEncryptionAvailable: () => false,
        }),
      /Secure storage/,
    );
    assert.equal(existsSync(path.join(dir, "connections.bin")), false);
  }));
test("an invalid legacy file cannot hide newer encrypted credentials", () =>
  withDirectory((dir) => {
    const vault = path.join(dir, "connections.bin");
    const saved = saveConnections(vault, storage, {
      openaiKey: "NEWER_SAVED_KEY",
    });
    writeFileSync(path.join(dir, "original"), "OPENAI_API_KEY=SHORT");
    symlinkSync(path.join(dir, "original"), path.join(dir, ".env.local"));
    assert.deepEqual(readConnectionsWithMigration(dir, storage), saved);
    rmSync(path.join(dir, ".env.local"));
    writeFileSync(
      path.join(dir, ".env.local"),
      "CALLWISE_FAST_MODEL=invalid-model-url/",
    );
    assert.deepEqual(readConnectionsWithMigration(dir, storage), saved);
    assert.deepEqual(readConnections(vault, storage), saved);
  }));
test("shutdown skips destroyed web contents even before the window closes", () => {
  const received = [];
  const closing = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => true,
      send: () => assert.fail("destroyed contents must not receive"),
    },
  };
  const live = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (...args) => received.push(args),
    },
  };
  sendToWindows([closing, null, live], "callwise:stop-capture");
  assert.deepEqual(received, [["callwise:stop-capture", undefined]]);
});
test("a destruction race does not abort shutdown but unrelated IPC errors stay visible", () => {
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send() {
        throw new Error("Object has been destroyed");
      },
    },
  };
  assert.doesNotThrow(() => sendToWindows([window], "callwise:stop-capture"));
  window.webContents.send = () => {
    throw new Error("Unexpected IPC error");
  };
  assert.throws(
    () => sendToWindows([window], "callwise:state"),
    /Unexpected IPC/,
  );
});
test("multiple native quit events close input sockets and providers only once", () => {
  let cleanupCount = 0;
  const shutdown = closeOnce(() => {
    cleanupCount++;
    shutdown();
  });
  shutdown();
  shutdown();
  shutdown();
  assert.equal(cleanupCount, 1);
});
