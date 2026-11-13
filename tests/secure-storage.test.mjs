import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSecureStorage } from "../desktop/secure-storage.mjs";
import { MeetingStore } from "../core/meetings/store.mjs";
import { readPreferences, savePreferences } from "../core/preferences.mjs";
import { readConnections } from "../core/connections.mjs";
import { readSheets } from "../core/call-sheets.mjs";
import { readReadiness } from "../desktop/readiness.mjs";
import { MeetingMcp } from "../desktop/meeting-mcp.mjs";

test("assistant discovery never asks to unlock storage", async () => {
  let attempts = 0;
  const storage = createSecureStorage(() => {
    attempts++;
    throw new Error("Synthetic Keychain prompt");
  });
  const server = new MeetingMcp({
    enabled: () => storage.isEncryptionAvailable(),
    store: {},
    search: {},
  });
  await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", clientInfo: { name: "test" } },
  });
  assert.equal(
    (await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })).tools
      .length,
    7,
  );
  assert.equal(attempts, 0);
});

test("one denied unlock covers startup files, saving and repeated assistant calls without replacing files", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "callwise-denied-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = Buffer.from("Synthetic existing encrypted file");
  const files = [
    "preferences.bin",
    "calls.bin",
    "readiness.bin",
    "connections.bin",
  ];
  for (const file of files) writeFileSync(path.join(directory, file), original);
  let unlocks = 0;
  const storage = createSecureStorage(() => ({
    isEncryptionAvailable() {
      unlocks++;
      return false;
    },
    encryptString() {
      assert.fail("Encryption must not be retried after denial");
    },
    decryptString() {
      assert.fail("Decryption must not be retried after denial");
    },
  }));
  assert.throws(
    () => new MeetingStore(path.join(directory, "meetings"), { storage }),
    /locked/,
  );
  assert.deepEqual(
    readReadiness(path.join(directory, "readiness.bin"), storage),
    {},
  );
  assert.throws(() => readSheets(path.join(directory, "calls.bin"), storage));
  assert.throws(() =>
    readConnections(path.join(directory, "connections.bin"), storage),
  );
  assert.throws(() =>
    readPreferences(path.join(directory, "preferences.bin"), storage),
  );
  const server = new MeetingMcp({
    enabled: () => {
      try {
        return (
          readPreferences(path.join(directory, "preferences.bin"), storage)
            .meetingMcpEnabled === true
        );
      } catch {
        return false;
      }
    },
    store: {},
    search: {},
  });
  for (let i = 0; i < 25; i++) {
    await assert.rejects(server.call("meeting_list", {}), /access is off/);
    assert.throws(() =>
      savePreferences(path.join(directory, "preferences.bin"), storage, {
        quiet: true,
      }),
    );
  }
  assert.equal(unlocks, 1);
  for (const file of files)
    assert.deepEqual(readFileSync(path.join(directory, file)), original);
});

test("a thrown Keychain initialization is not retried until a new process gate is created", () => {
  let attempts = 0;
  const load = () => {
    attempts++;
    throw new Error("Synthetic locked Keychain");
  };
  const storage = createSecureStorage(load);
  for (let i = 0; i < 20; i++) {
    assert.equal(storage.isEncryptionAvailable(), false);
    assert.throws(
      () => storage.decryptString(Buffer.from("x")),
      /quit and reopen/,
    );
  }
  assert.equal(attempts, 1);
  assert.equal(createSecureStorage(load).isEncryptionAvailable(), false);
  assert.equal(attempts, 2);
});

test("successful storage is reused and a corrupt file does not lock other readable files", () => {
  let unlocks = 0;
  const delegate = {
    marker: "synthetic:",
    isEncryptionAvailable() {
      unlocks++;
      return true;
    },
    getSelectedStorageBackend: () => "keychain",
    encryptString(value) {
      return Buffer.from(this.marker + value);
    },
    decryptString(value) {
      const text = value.toString();
      if (!text.startsWith(this.marker))
        throw new Error("Synthetic corrupt file");
      return text.slice(this.marker.length);
    },
  };
  const storage = createSecureStorage(() => delegate);
  const value = storage.encryptString("synthetic note");
  assert.throws(
    () => storage.decryptString(Buffer.from("corrupt")),
    /corrupt file/,
  );
  for (let i = 0; i < 20; i++) {
    assert.equal(storage.isEncryptionAvailable(), true);
    assert.equal(storage.decryptString(value), "synthetic note");
  }
  assert.equal(unlocks, 1);
});

test("encryption failure stops later save attempts without switching to plaintext", () => {
  let encryptions = 0;
  const storage = createSecureStorage(() => ({
    isEncryptionAvailable: () => true,
    encryptString() {
      encryptions++;
      throw new Error("Synthetic storage failure");
    },
  }));
  assert.throws(
    () => storage.encryptString("first"),
    /Synthetic storage failure/,
  );
  for (let i = 0; i < 20; i++)
    assert.throws(() => storage.encryptString("later"), /quit and reopen/);
  assert.equal(encryptions, 1);
  assert.equal(storage.isEncryptionAvailable(), false);
});

test("a plaintext storage backend is refused before storing anything", () => {
  const storage = createSecureStorage(() => ({
    getSelectedStorageBackend: () => "basic_text",
    isEncryptionAvailable() {
      assert.fail("Plaintext backend must be refused");
    },
    encryptString() {
      assert.fail("No plaintext fallback");
    },
  }));
  assert.equal(storage.isEncryptionAvailable(), false);
  assert.throws(() => storage.encryptString("private"), /unavailable/);
});
