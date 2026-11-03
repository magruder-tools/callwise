import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { MeetingStore } from "../core/meetings/store.mjs";
import { MeetingService } from "../core/meetings/service.mjs";
import { CallController } from "../core/controller.mjs";
import { sealBackup } from "../core/meetings/crypto.mjs";
import { createSecureStorage } from "../desktop/secure-storage.mjs";
import { retrySavedData } from "../desktop/storage-recovery.mjs";
import {
  stageRestore,
  publishRestore,
  recoverRestoreSwap,
} from "../desktop/library-restore.mjs";
import { createMeetingCommands } from "../desktop/meeting-commands.mjs";
import { meetingProcessingStatus } from "../core/meetings/processing-status.mjs";
import {
  checkForUpdate,
  newerVersion,
  parseReleaseVersion,
  PREVIEW_RELEASES_URL,
  RELEASES_URL,
} from "../desktop/updates.mjs";
const PASS = "synthetic backup passphrase only";
const keychain = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "keychain",
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "callwise-054-"));
  const stores = [];
  t.after(() => {
    for (const s of stores) s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    store(name, storage) {
      const s = new MeetingStore(
        path.join(dir, name),
        storage ? { storage } : { key: randomBytes(32) },
      );
      stores.push(s);
      return s;
    },
  };
}
function release(tag, extra = {}) {
  return {
    tag_name: tag,
    html_url: `https://github.com/magruder-tools/callwise/releases/tag/${tag}`,
    ...extra,
  };
}

test("preview updates recognize published Callwise tags and select by version, excluding drafts and unsafe URLs", async () => {
  let url;
  const update = await checkForUpdate("0.5.3", {
    includePreview: true,
    fetchImpl: async (u) => {
      url = u;
      return new Response(
        JSON.stringify([
          release("v0.5.2"),
          release("callwise-0.5.4-preview"),
          release("v0.6.0", { draft: true }),
          release("v0.5.3"),
          release("v99.0.0", { html_url: "https://evil.example/" }),
          release("v0.5.4-beta.2"),
          release("v0.5.4-beta.10"),
        ]),
      );
    },
  });
  assert.equal(url, PREVIEW_RELEASES_URL);
  assert.equal(update.version, "callwise-0.5.4-preview");
  assert.equal(update.preview, true);
  assert.equal(
    newerVersion("0.5.4-beta.2", "v0.5.4-beta.10", { includePreview: true }),
    true,
  );
  assert.equal(
    newerVersion("0.5.4", "callwise-0.5.4-preview", { includePreview: true }),
    false,
  );
  for (const tag of [
    "v01.2.3",
    "v1.2.3-evil",
    "v1.2.3-preview.9007199254740993",
    "1.2.3/foo",
  ])
    assert.equal(parseReleaseVersion(tag), null);
});
test("stable updates stay stable and network failure does not raise an update", async () => {
  let url;
  assert.equal(
    await checkForUpdate("0.5.3", {
      fetchImpl: async (u) => {
        url = u;
        return new Response(
          JSON.stringify(
            release("callwise-0.5.4-preview", { prerelease: true }),
          ),
        );
      },
    }),
    null,
  );
  assert.equal(url, RELEASES_URL);
  assert.equal(
    await checkForUpdate("0.5.3", {
      includePreview: true,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }),
    null,
  );
});
test("processing labels use the meeting's confirmed snapshot and distinguish recording, transcription and cloud help", () => {
  const meeting = {
    engine: "apple",
    retainAudio: false,
    liveHelp: true,
    assistantAccess: true,
  };
  assert.deepEqual(meetingProcessingStatus(meeting, "running"), [
    "Transcription: on this Mac",
    "Audio recording: off",
    "Cloud coaching: enabled",
    "Assistant access: allowed after meeting",
  ]);
  assert.match(
    meetingProcessingStatus(
      { ...meeting, engine: "openai", retainAudio: true },
      "paused",
    ).join(" / "),
    /Cloud transcription: OpenAI.*Audio recording: paused/,
  );
  assert.match(
    meetingProcessingStatus(
      { engine: "manual", retainAudio: true },
      "running",
    ).join(" / "),
    /Notes only.*Audio recording: off/,
  );
  assert.match(
    meetingProcessingStatus(
      { ...meeting, liveHelp: false, retainAudio: true },
      "ended",
    ).join(" / "),
    /Audio retention: enabled.*Cloud coaching: off/,
  );
});
test("explicit storage retry alone clears a denied gate, including another denial", () => {
  let calls = 0,
    allowed = false;
  const storage = createSecureStorage(() => ({
    ...keychain,
    isEncryptionAvailable: () => {
      calls++;
      return allowed;
    },
  }));
  for (let i = 0; i < 10; i++)
    assert.equal(storage.isEncryptionAvailable(), false);
  assert.equal(calls, 1);
  assert.equal(storage.retryAccess(), false);
  for (let i = 0; i < 10; i++) assert.throws(() => storage.encryptString("x"));
  assert.equal(calls, 2);
  allowed = true;
  assert.equal(storage.retryAccess(), true);
  assert.equal(storage.blocked, false);
  assert.equal(calls, 3);
});
test("unlock recovers an existing encrypted library without replacing open unsaved notes or persisting them", async (t) => {
  const f = fixture(t),
    original = f.store("library", keychain);
  original.put("meetings", "old", "old", {
    title: "Previously saved",
    status: "ended",
  });
  original.close();
  const meetings = new MeetingService(),
    controller = new CallController();
  t.after(() => {
    controller.meetingService = null;
    controller.close();
    meetings.close();
  });
  meetings.memory.set("meetings:draft:draft", {
    id: "draft",
    meetingId: "draft",
    status: "ended",
    saving: false,
  });
  meetings.memory.set("docs:draft:notes:original", {
    id: "notes:original",
    meetingId: "draft",
    text: "Unsent thoughts",
  });
  meetings.unsavedMeeting = meetings.selectedId = "draft";
  const storage = createSecureStorage(() => keychain);
  let applied;
  await retrySavedData({
    storage,
    meetings,
    controller,
    openStore: () => f.store("library", storage),
    installStore: (s) => {
      meetings.store = s;
    },
    load: () => ({ warnings: [], preferences: { liveHelp: false } }),
    apply: (v) => {
      applied = v;
    },
  });
  assert.equal(applied.preferences.liveHelp, false);
  assert.equal(meetings.selectedId, "draft");
  assert.equal(
    meetings.get("docs", "draft", "notes:original").text,
    "Unsent thoughts",
  );
  assert.equal(meetings.store.get("docs", "draft", "notes:original"), null);
  assert.equal(meetings.get("meetings", "old").title, "Previously saved");
});
test("busy unlock and an unreadable archive key cannot replace files or apply defaults", async (t) => {
  const f = fixture(t),
    meetings = new MeetingService(),
    controller = new CallController();
  t.after(() => {
    controller.meetingService = null;
    controller.close();
    meetings.close();
  });
  let attempts = 0;
  const storage = createSecureStorage(() => {
    attempts++;
    return keychain;
  });
  const options = {
    storage,
    meetings,
    controller,
    openStore: () => new MeetingStore(path.join(f.dir, "bad"), { storage }),
    installStore: () => assert.fail("Must not install"),
    load: () => assert.fail("Must not load"),
    apply: () => assert.fail("Must not apply"),
  };
  controller.engine.status = "paused";
  await assert.rejects(retrySavedData(options), /End the meeting/);
  assert.equal(attempts, 0);
  controller.engine.status = "ended";
  mkdirSync(path.join(f.dir, "bad"));
  const file = path.join(f.dir, "bad", "archive-key.bin");
  writeFileSync(file, "unreadable existing key");
  await assert.rejects(retrySavedData(options), /not been replaced/);
  assert.equal(readFileSync(file, "utf8"), "unreadable existing key");
  assert.equal(meetings.unlocking, false);
});
test("large restore decrypts in a worker with progress while the main event loop stays responsive, and retains the wrapped key", async (t) => {
  const f = fixture(t),
    source = f.store("source"),
    target = f.store("target", keychain);
  source.put("meetings", "m", "m", { title: "Restored", status: "ended" });
  for (let i = 0; i < 1800; i++)
    source.put("segments", "m", `s${i}`, {
      text: `Synthetic transcript ${i}`,
      final: true,
    });
  source.writeAudio("m", "mic", 0, Buffer.from("synthetic-mp3"), {
    startMs: 0,
    endMs: 1000,
  });
  const file = path.join(f.dir, "backup.cwbackup");
  source.backupToFile(file, PASS);
  const wrapped = readFileSync(path.join(target.directory, "archive-key.bin"));
  writeFileSync(
    path.join(target.directory, "keep.txt"),
    "auxiliary encrypted backups remain",
  );
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  t.after(() => clearInterval(timer));
  const progress = [],
    staged = await stageRestore(target, file, PASS, (p) => progress.push(p));
  assert.ok(
    ticks >= 2,
    "worker must leave event loop available during key derivation and imports",
  );
  assert.ok(progress.some((p) => p.completed >= 128));
  assert.equal(target.isEmpty(), true);
  assert.equal(
    JSON.stringify(progress).includes("Synthetic transcript"),
    false,
  );
  const identity = target;
  publishRestore(target, staged.stage);
  assert.equal(target, identity);
  assert.equal(target.closed, false);
  assert.equal(target.all("segments", "m").length, 1800);
  assert.equal(target.readAudio("m", "mic:0").toString(), "synthetic-mp3");
  assert.deepEqual(
    readFileSync(path.join(target.directory, "archive-key.bin")),
    wrapped,
  );
  assert.equal(
    readFileSync(path.join(target.directory, "keep.txt"), "utf8"),
    "auxiliary encrypted backups remain",
  );
  target.close();
  assert.equal(
    f.store("target", keychain).get("meetings", "m").title,
    "Restored",
  );
});
test("wrong passphrase, truncation, timeout and draft ID collisions preserve the original empty library", async (t) => {
  const f = fixture(t),
    source = f.store("source"),
    target = f.store("target", keychain);
  source.put("meetings", "m", "m", { status: "ended" });
  const file = path.join(f.dir, "backup.cwbackup");
  source.backupToFile(file, PASS);
  const key = readFileSync(path.join(target.directory, "archive-key.bin"));
  await assert.rejects(stageRestore(target, file, "incorrect passphrase"));
  await assert.rejects(
    stageRestore(target, file, PASS, () => {}, { timeout: 1 }),
    /too long/,
  );
  await assert.rejects(
    stageRestore(target, file, PASS, () => {}, { reservedIds: ["m"] }),
    /unsaved meeting/,
  );
  const bytes = readFileSync(file);
  writeFileSync(file, bytes.subarray(0, bytes.length - 8));
  await assert.rejects(stageRestore(target, file, PASS));
  assert.equal(target.isEmpty(), true);
  assert.equal(target.closed, false);
  assert.deepEqual(
    readFileSync(path.join(target.directory, "archive-key.bin")),
    key,
  );
});
test("legacy backups restore through the background path too", async (t) => {
  const f = fixture(t),
    target = f.store("target");
  const file = path.join(f.dir, "old.cwbackup");
  writeFileSync(
    file,
    sealBackup(
      {
        schema: 1,
        records: {
          meetings: [
            { id: "old", meetingId: "old", title: "Legacy", status: "ended" },
          ],
        },
        audio: [],
      },
      PASS,
    ),
  );
  const staged = await stageRestore(target, file, PASS);
  publishRestore(target, staged.stage);
  assert.equal(target.get("meetings", "old").title, "Legacy");
});
test("nonempty orphan rows block restore, and capture/deletion are blocked throughout the file chooser", async (t) => {
  const f = fixture(t),
    store = f.store("target"),
    controller = new CallController();
  const meetings = new MeetingService({ store });
  controller.meetingService = meetings;
  t.after(() => {
    controller.meetingService = null;
    controller.close();
    meetings.close();
  });
  let pick;
  const command = createMeetingCommands({
    meetings,
    controller,
    paths: {},
    native: {},
    getWindow: () => null,
    dialog: {
      showOpenDialog: () =>
        new Promise((r) => {
          pick = r;
        }),
    },
  });
  store.put("events", "orphan", "event", { type: "synthetic" });
  await assert.rejects(
    command("desktop.meeting.restore", { confirm: true, passphrase: PASS }),
    /empty/,
  );
  store.remove("events", "orphan", "event");
  const restoring = command("desktop.meeting.restore", {
    confirm: true,
    passphrase: PASS,
  });
  assert.equal(meetings.archiveOperation.phase, "Choose a backup");
  await assert.rejects(controller.command("practice"), /restore/);
  await assert.rejects(controller.start(), /restore/);
  await assert.rejects(
    meetings.command("meeting.delete", { meetingId: "x" }),
    /restore/,
  );
  await assert.rejects(meetings.deleteAll(), /restore/);
  await assert.rejects(command("desktop.meeting.backup"), /restore/);
  pick({ canceled: true });
  assert.deepEqual(await restoring, { cancelled: true });
  assert.equal(meetings.archiveOperation, null);
});
test("interrupted directory publication recovers before a fresh key could be created", (t) => {
  const f = fixture(t),
    original = f.store("library", keychain);
  const directory = original.directory,
    token = randomUUID(),
    stage = `${directory}.restore-${token}`,
    previous = `${directory}.before-${token}`;
  original.close();
  const restored = new MeetingStore(stage, { storage: keychain });
  restored.put("meetings", "m", "m", { title: "Ready", status: "ended" });
  restored.close();
  writeFileSync(`${directory}.restore.json`, JSON.stringify({ token }));
  renameSync(directory, previous);
  recoverRestoreSwap(directory);
  assert.equal(
    f.store("library", keychain).get("meetings", "m").title,
    "Ready",
  );
  assert.equal(existsSync(previous), false);
  assert.equal(existsSync(`${directory}.restore.json`), false);
});
test("startup removes an abandoned worker staging copy without touching unrelated files or the original library", (t) => {
  const f = fixture(t),
    target = f.store("library", keychain);
  const stage = `${target.directory}.restore-${randomUUID()}`;
  mkdirSync(stage);
  writeFileSync(path.join(stage, "private-copy"), "synthetic old data");
  const unrelated = `${target.directory}.restore-personal`;
  mkdirSync(unrelated);
  const original = readFileSync(path.join(target.directory, "archive-key.bin"));
  recoverRestoreSwap(target.directory);
  assert.equal(existsSync(stage), false);
  assert.equal(existsSync(unrelated), true);
  assert.deepEqual(
    readFileSync(path.join(target.directory, "archive-key.bin")),
    original,
  );
  assert.equal(target.isEmpty(), true);
});
test("a failed staged-library opening rolls publication back and leaves the original key usable", async (t) => {
  const f = fixture(t),
    source = f.store("source"),
    target = f.store("target", keychain);
  source.put("meetings", "m", "m", { status: "ended" });
  const file = path.join(f.dir, "backup.cwbackup");
  source.backupToFile(file, PASS);
  const staged = await stageRestore(target, file, PASS);
  writeFileSync(
    path.join(staged.stage, "library.db"),
    "invalid staged database",
  );
  assert.throws(() => publishRestore(target, staged.stage));
  assert.equal(target.isEmpty(), true);
  assert.equal(target.closed, false);
  target.put("meetings", "after", "after", {
    title: "Original survived",
    status: "ended",
  });
  target.close();
  assert.equal(
    f.store("target", keychain).get("meetings", "after").title,
    "Original survived",
  );
});
