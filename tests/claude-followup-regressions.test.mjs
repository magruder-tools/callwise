// Regressions for Claude's 0.5.1 follow-up review (docs/reviews/0.5.1/CLAUDE_FOLLOWUP_REVIEW.md, N1–N12).
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { MeetingStore } from "../core/meetings/store.mjs";
import { MeetingService } from "../core/meetings/service.mjs";
import { CallController } from "../core/controller.mjs";
import { AppleSpeechSession } from "../providers/apple-speech.mjs";
import {
  startMeeting,
  speechNeedsRestart,
  removeUnopenedLibrary,
} from "../desktop/meeting-start.mjs";
import { MeetingSearch } from "../desktop/meeting-search.mjs";
import { MeetingMcp, runMeetingMcp } from "../desktop/meeting-mcp.mjs";
import { noticeHash } from "../core/meetings/notice.mjs";
import { LocalDocuments, validateDocument } from "../core/meetings/recaps.mjs";
import { sealBackup } from "../core/meetings/crypto.mjs";
import { savePreferences } from "../core/preferences.mjs";

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const PASS = "a long test-only passphrase";
const keychain = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "keychain",
  encryptString: (s) => Buffer.from("x" + s),
  decryptString: (b) => Buffer.from(b).toString().slice(1),
};
function directory(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "callwise-followup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function notice(preferences) {
  return {
    confirmed: true,
    method: "spoken",
    configHash: noticeHash(preferences),
    presentedAt: Date.now(),
  };
}
// A live meeting on the real controller and service, with a stub speech source.
async function liveMeeting(t, { preferences = { liveHelp: false } } = {}) {
  const store = new MeetingStore(directory(t), { key: randomBytes(32) });
  const controller = new CallController({
    preferences,
    speechFactory: () => ({
      connect: async () => {},
      push() {},
      finish: async () => {},
      close() {},
    }),
  });
  const service = new MeetingService({ store });
  controller.meetingService = service;
  service.attach(controller);
  t.after(() => {
    controller.close();
    service.close();
    store.close();
  });
  await startMeeting({
    meetings: service,
    controller,
    payload: {
      source: "audio",
      title: "Vendor negotiation",
      people: ["Dana"],
      notice: notice(controller.preferences),
    },
  });
  return { store, controller, service, id: service.activeId };
}
class FakeHost extends EventEmitter {
  constructor(hosts) {
    super();
    this.pushes = { mic: 0, system: 0 };
    hosts?.push(this);
  }
  async request(op, args) {
    if (op === "start") this.epoch = args.epoch;
    return op === "start" ? { ready: true } : { ok: true };
  }
  send(m) {
    if (m.op === "push") this.pushes[m.channel]++;
  }
  close() {
    this.closed = true;
  }
}

test("N1: after an objection, the menu-bar Resume and global shortcuts can't resume capture", async (t) => {
  const { controller, service, id } = await liveMeeting(t);
  await service.command("meeting.notice", { meetingId: id, objection: true });
  assert.equal(controller.engine.status, "paused");
  assert.equal(service.resumeBlocked(), true);
  // desktop/main.mjs tray "Resume" and the Control+Alt+P / Control+Alt+Space actions call this directly.
  await assert.rejects(
    controller.command("start", {
      source: controller.mode,
      consent: true,
      backend: controller.strategyBackend,
    }),
    /objection/,
  );
  assert.equal(controller.engine.status, "paused");
  await service.command("meeting.objection.resolve", {
    meetingId: id,
    choice: "keep",
  });
  assert.equal(service.resumeBlocked(), false);
});

test("N1: nothing resumes capture while an objection's pause, or an earlier pause, is still draining", async (t) => {
  const store = new MeetingStore(directory(t), { key: randomBytes(32) });
  const controller = new CallController({
    preferences: { liveHelp: false },
    speechFactory: () => ({
      connect: async () => {},
      push() {},
      finish: () => tick(200),
      close() {},
    }),
  });
  const service = new MeetingService({ store });
  controller.meetingService = service;
  service.attach(controller);
  t.after(() => {
    controller.close();
    service.close();
    store.close();
  });
  await startMeeting({
    meetings: service,
    controller,
    payload: { source: "audio", notice: notice(controller.preferences) },
  });
  const id = service.activeId;
  const resume = () =>
    controller.command("start", { source: "audio", consent: true });
  // An objection while running: the menu bar or a shortcut during its drain.
  const objecting = service.command("meeting.notice", {
    meetingId: id,
    objection: true,
  });
  await tick(20);
  await assert.rejects(resume(), /objection/);
  await objecting;
  assert.equal(controller.engine.status, "paused");
  await service.command("meeting.objection.resolve", {
    meetingId: id,
    choice: "keep",
  });
  // A resume that was already waiting on an ordinary pause's drain when the objection arrived.
  await controller.command("new", { clearContext: true });
  await startMeeting({
    meetings: service,
    controller,
    payload: { source: "audio", notice: notice(controller.preferences) },
  });
  const second = service.activeId;
  const pausing = controller.command("pause");
  await tick(20);
  const waiting = resume();
  await service.command("meeting.notice", {
    meetingId: second,
    objection: true,
  });
  await pausing;
  await assert.rejects(waiting, /objection/);
  assert.equal(controller.engine.status, "paused");
});

test("N4: deleting captured content keeps the user's notes and actions, then moves them into the continuation", async (t) => {
  const { store, controller, service, id } = await liveMeeting(t);
  controller.engine.ingest({
    id: "system:e1:0:run:r",
    channel: "system",
    speaker: "Them",
    text: "Our renewal price is 40k.",
    final: true,
    startMs: 0,
    endMs: 2000,
    captureEpoch: controller.captureEpoch,
  });
  await service.command("meeting.notes", {
    meetingId: id,
    text: "Walk-away price 35k",
    version: 0,
  });
  await service.command("meeting.action", {
    meetingId: id,
    text: "Email legal",
  });
  store.put("actions", id, "ai-1", {
    text: "Send pricing",
    origin: "ai",
    refs: [],
    state: "proposed",
  });
  store.put("docs", id, "recap", { summary: [{ text: "Price is 40k" }] });
  store.writeAudio(id, "mic", 0, Buffer.from("audio"), {
    startMs: 0,
    endMs: 10000,
  });
  await service.command("meeting.notice", { meetingId: id, objection: true });
  await service.command("meeting.objection.resolve", {
    meetingId: id,
    choice: "delete",
  });
  const kept = store.get("meetings", id);
  assert.equal(kept.title, "Vendor negotiation");
  assert.equal(kept.captureDeleted, true);
  assert.equal(
    store.get("docs", id, "notes:original").text,
    "Walk-away price 35k",
  );
  assert.deepEqual(
    store.all("actions", id).map((a) => a.text),
    ["Email legal"],
  );
  assert.equal(store.all("segments", id).length, 0);
  assert.equal(store.all("audio_chunks", id).length, 0);
  assert.equal(store.get("docs", id, "recap"), null);
  assert.equal(existsSync(path.join(store.directory, "audio", id)), false);
  assert.equal(controller.engine.transcript.size, 0);
  // ui/meetings.mjs then starts the notes-only continuation.
  await controller.command("new", { clearContext: true });
  await startMeeting({
    meetings: service,
    controller,
    payload: { source: "manual", captureMode: "notes-only", continueFrom: id },
  });
  const next = store.get("meetings", service.activeId);
  assert.notEqual(next.id, id);
  assert.equal(next.title, "Vendor negotiation");
  assert.deepEqual(next.people, ["Dana"]);
  assert.equal(
    store.get("docs", next.id, "notes:original").text,
    "Walk-away price 35k",
  );
  assert.deepEqual(
    store.all("actions", next.id).map((a) => a.text),
    ["Email legal"],
  );
  assert.equal(store.get("meetings", id), null);
});

test("N4: keeping captured content continues in a titled notes-only meeting; the objection notice clears", async (t) => {
  const { store, controller, service, id } = await liveMeeting(t);
  controller.engine.ingest({
    id: "system:e1:0:run:r",
    channel: "system",
    speaker: "Them",
    text: "Let's talk pricing.",
    final: true,
    startMs: 0,
    endMs: 2000,
    captureEpoch: controller.captureEpoch,
  });
  await service.command("meeting.notice", { meetingId: id, objection: true });
  await service.command("meeting.objection.resolve", {
    meetingId: id,
    choice: "keep",
  });
  await controller.command("new", { clearContext: true });
  await startMeeting({
    meetings: service,
    controller,
    payload: { source: "manual", captureMode: "notes-only", continueFrom: id },
  });
  const next = store.get("meetings", service.activeId);
  assert.equal(next.title, "Vendor negotiation (continued)");
  assert.equal(store.all("segments", id).length, 1);
  assert.equal(service.warning, "");
});

test("N4: a meeting started without saving keeps its continuation unsaved", async (t) => {
  const store = new MeetingStore(directory(t), { key: randomBytes(32) });
  const controller = new CallController({
    preferences: { liveHelp: false },
    speechFactory: () => ({
      connect: async () => {},
      push() {},
      finish: async () => {},
      close() {},
    }),
  });
  const service = new MeetingService({ store });
  controller.meetingService = service;
  service.attach(controller);
  t.after(() => {
    controller.close();
    service.close();
    store.close();
  });
  await startMeeting({
    meetings: service,
    controller,
    payload: {
      source: "audio",
      title: "Off the record",
      withoutSaving: true,
      notice: notice(controller.preferences),
    },
  });
  const id = service.activeId;
  await service.command("meeting.notes", {
    meetingId: id,
    text: "Dana's salary is 180k",
    version: 0,
  });
  await service.command("meeting.notice", { meetingId: id, objection: true });
  await service.command("meeting.objection.resolve", {
    meetingId: id,
    choice: "delete",
  });
  await controller.command("new", { clearContext: true });
  await startMeeting({
    meetings: service,
    controller,
    payload: { source: "manual", captureMode: "notes-only", continueFrom: id },
  });
  const next = service.get("meetings", service.activeId);
  assert.equal(next.saving, false);
  assert.equal(
    service.get("docs", next.id, "notes:original").text,
    "Dana's salary is 180k",
  );
  assert.equal(store.all("meetings").length, 0);
  assert.equal(store.all("docs").length, 0);
});

test("N2: with the notebook attached, an unset live-help preference means no cloud coaching", () => {
  const withNotebook = new CallController({
    config: { openaiKey: "TEST_ONLY", fastModel: "m", strategyModel: "m" },
    preferences: {},
  });
  withNotebook.meetingService = {
    snapshot: () => ({}),
    resumeBlocked: () => false,
  };
  withNotebook.mode = "audio";
  withNotebook.setProviders();
  assert.deepEqual(withNotebook.engine.providers, {});
  assert.equal(withNotebook.engine.config.autoCoach, false);
  withNotebook.preferences = { liveHelp: true };
  withNotebook.setProviders();
  assert.ok(withNotebook.engine.providers.fast);
  withNotebook.close();
  // The legacy coaching flow keeps its default.
  const legacy = new CallController({
    config: { openaiKey: "TEST_ONLY", fastModel: "m", strategyModel: "m" },
    preferences: {},
  });
  legacy.mode = "audio";
  legacy.setProviders();
  assert.ok(legacy.engine.providers.fast);
  legacy.close();
});

test("N3: the headless MCP server reopens the library after Delete all instead of serving deleted meetings", async (t) => {
  const userData = directory(t);
  const prefs = path.join(userData, "preferences.bin");
  savePreferences(prefs, keychain, { meetingMcpEnabled: true });
  const store = new MeetingStore(path.join(userData, "meetings"), {
    storage: keychain,
  });
  const service = new MeetingService({ store });
  t.after(() => {
    service.close();
    store.close();
  });
  const add = (id, title) =>
    store.put("meetings", id, id, {
      title,
      people: [],
      status: "ended",
      assistantAccess: true,
      createdAt: Date.now(),
      durationMs: 1,
    });
  const deleted = randomUUID();
  add(deleted, "Confidential salary talk");
  const input = new PassThrough(),
    output = new PassThrough(),
    queue = [];
  createInterface({ input: output }).on("line", (l) =>
    queue.shift()?.(JSON.parse(l)),
  );
  let n = 0;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      queue.push(resolve);
      input.write(
        JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) + "\n",
      );
    });
  const done = runMeetingMcp({
    app: null,
    storage: keychain,
    directory: userData,
    input,
    output,
  });
  // End the server loop even when an assertion fails, so the runner can exit.
  t.after(async () => {
    input.end();
    await done;
  });
  const call = async (name, args = {}) =>
    (await rpc("tools/call", { name, arguments: args })).result.content[0].text;
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {} });
  assert.match(await call("meeting_list"), /Confidential salary talk/);
  assert.match(
    await call("meeting_search", { query: "salary" }),
    /Confidential salary talk/,
  );
  // desktop.delete: preferences removed, then MeetingService.deleteAll() -> store.reset()
  rmSync(prefs);
  await service.deleteAll();
  assert.match(await call("meeting_list"), /access is off/);
  savePreferences(prefs, keychain, { meetingMcpEnabled: true });
  add(randomUUID(), "First meeting after the reset");
  const list = await call("meeting_list");
  assert.match(list, /First meeting after the reset/);
  assert.doesNotMatch(list, /Confidential/);
  assert.doesNotMatch(
    await call("meeting_search", { query: "salary" }),
    /Confidential/,
  );
  assert.match(
    await call("meeting_get", { meetingId: deleted }),
    /Meeting not found/,
  );
});

test("N5: one overload line keeps the channel transcribing; a sustained overload stops it", async () => {
  const hosts = [],
    statuses = [],
    rows = [];
  const session = new AppleSpeechSession({
    binary: "fake",
    resources: "fake",
    epoch: 1,
    hostFactory: () => new FakeHost(hosts),
  });
  for (const channel of ["mic", "system"])
    session.adapter({
      channel,
      onSegment: (r) => rows.push(r),
      onStatus: (s) => statuses.push(`${channel}:${s}`),
      onDiscard() {},
    });
  await session.connect();
  const packet = Buffer.alloc(4800);
  let at = 100;
  const push = (count) => {
    for (let i = 0; i < count; i++, at += 100) {
      session.push("mic", packet, at);
      session.push("system", packet, at);
    }
  };
  push(5);
  hosts[0].emit("message", {
    type: "error",
    channel: "system",
    code: "speech_input_overloaded",
  });
  const before = hosts[0].pushes.system;
  push(10);
  assert.equal(hosts[0].pushes.system - before, 10);
  assert.equal(hosts.length, 1);
  assert.equal(statuses.includes("system:failed"), false);
  assert.equal(rows.filter((r) => r.gap && r.channel === "system").length, 1);
  for (let i = 0; i < 101; i++)
    hosts[0].emit("message", {
      type: "error",
      channel: "system",
      code: "speech_input_overloaded",
    });
  assert.equal(statuses.includes("system:failed"), true);
  assert.equal(statuses.includes("mic:failed"), false);
  session.close();
});

test("Retry audio restarts Apple speech when a speech channel failed, not when a capture device failed", () => {
  const controller = (capture, captureInputs, sessionStopped = false) => ({
    transcribers: new Map([
      ["mic", { stopped: false, session: { stopped: sessionStopped } }],
    ]),
    capture,
    captureInputs,
  });
  const ok = { mic: "receiving", system: "receiving" };
  assert.equal(
    speechNeedsRestart(controller({ mic: "failed", system: "receiving" }, ok)),
    true,
  );
  assert.equal(speechNeedsRestart(controller(ok, ok, true)), true);
  assert.equal(
    speechNeedsRestart(
      controller(
        { mic: "failed", system: "receiving" },
        { mic: "failed", system: "receiving" },
      ),
    ),
    false,
  );
  assert.equal(speechNeedsRestart(controller(ok, ok)), false);
});

test("N8: helper restarts far apart keep transcribing; three within ten minutes stop", async () => {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    const run = async (gapMs) => {
      const statuses = [];
      const session = new AppleSpeechSession({
        binary: "fake",
        resources: "fake",
        epoch: 1,
        hostFactory: () => new FakeHost(),
      });
      for (const channel of ["mic", "system"])
        session.adapter({
          channel,
          onSegment() {},
          onStatus: (s) => statuses.push(s),
          onDiscard() {},
        });
      await session.connect();
      for (let i = 0; i < 4; i++) {
        offset += gapMs;
        session.host.emit("exit");
        await tick(5);
      }
      const stopped = session.stopped;
      session.close();
      return { stopped, last: statuses.at(-1) };
    };
    assert.deepEqual(await run(20 * 60000), {
      stopped: false,
      last: "connected",
    });
    assert.equal((await run(60000)).stopped, true);
  } finally {
    Date.now = realNow;
  }
});

test("N11: a helper restart drops the old run's partial line that the replay transcribes again", async (t) => {
  const hosts = [];
  let session;
  const c = new CallController({
    preferences: { liveHelp: false },
    speechFactory: (o) => {
      if (
        !session ||
        session.stopped ||
        session.captureEpoch !== o.captureEpoch
      ) {
        session?.close();
        session = new AppleSpeechSession({
          binary: "fake",
          resources: "fake",
          epoch: o.captureEpoch,
          hostFactory: () => new FakeHost(hosts),
        });
        session.captureEpoch = o.captureEpoch;
      }
      return session.adapter(o);
    },
  });
  t.after(() => c.close());
  await c.command("start", { source: "audio", consent: true });
  for (let i = 0; i < 5; i++) c.audio("system", Buffer.alloc(4800));
  const say = (host, text, final) =>
    host.emit("message", {
      type: "segment",
      row: {
        id: `system:e${host.epoch}:0`,
        channel: "system",
        speaker: "Them",
        text,
        startMs: 0,
        endMs: 1500,
        final,
      },
    });
  say(hosts[0], "We can offer forty", false);
  hosts[0].emit("exit");
  await tick(20);
  say(hosts[1], "We can offer forty thousand for the renewal.", true);
  await c.command("end");
  assert.deepEqual(
    [...c.engine.transcript.values()].filter((r) => !r.gap).map((r) => r.text),
    ["We can offer forty thousand for the renewal."],
  );
});

test("N11: a restart that fails keeps the old run's partial line", async (t) => {
  const hosts = [];
  let session;
  class FailingRestartHost extends FakeHost {
    async request(op, args) {
      if (op === "start" && hosts.length > 1)
        throw new Error("helper can't start");
      return super.request(op, args);
    }
  }
  const c = new CallController({
    preferences: { liveHelp: false },
    speechFactory: (o) => {
      if (
        !session ||
        session.stopped ||
        session.captureEpoch !== o.captureEpoch
      ) {
        session?.close();
        session = new AppleSpeechSession({
          binary: "fake",
          resources: "fake",
          epoch: o.captureEpoch,
          hostFactory: () => new FailingRestartHost(hosts),
        });
        session.captureEpoch = o.captureEpoch;
      }
      return session.adapter(o);
    },
  });
  t.after(() => c.close());
  await c.command("start", { source: "audio", consent: true });
  for (let i = 0; i < 5; i++) c.audio("system", Buffer.alloc(4800));
  hosts[0].emit("message", {
    type: "segment",
    row: {
      id: "system:e1:0",
      channel: "system",
      speaker: "Them",
      text: "Our final offer is forty two thousand",
      startMs: 0,
      endMs: 1500,
      final: false,
    },
  });
  hosts[0].emit("exit");
  await tick(1800); // three failed restarts, 500 ms apart, then it gives up
  assert.equal(session.stopped, true);
  await c.command("end");
  assert.deepEqual(
    [...c.engine.transcript.values()].filter((r) => !r.gap).map((r) => r.text),
    ["Our final offer is forty two thousand"],
  );
});

test("N6: a missing audio file doesn't fail backups; playback explains it and the backup records it as missing", async (t) => {
  const dir = directory(t),
    key = randomBytes(32),
    mid = randomUUID();
  const first = new MeetingStore(path.join(dir, "a"), { key, keyId: "k" });
  first.put("meetings", mid, mid, {
    title: "Recorded",
    people: [],
    status: "ended",
    createdAt: 1,
  });
  for (let i = 0; i < 3; i++)
    first.writeAudio(mid, "mic", i, Buffer.alloc(100, i), {
      startMs: i,
      endMs: i + 1,
    });
  rmSync(
    path.join(first.directory, first.get("audio_chunks", mid, "mic:1").path),
  );
  first.close();
  const store = new MeetingStore(path.join(dir, "a"), { key, keyId: "k" });
  t.after(() => store.close());
  assert.throws(() => store.readAudio(mid, "mic:1"), /no longer available/);
  assert.deepEqual(store.backupToFile(path.join(dir, "a.cwbackup"), PASS), {
    missingAudio: 1,
  });
  const restored = new MeetingStore(path.join(dir, "b"), {
    key: randomBytes(32),
    keyId: "b",
  });
  t.after(() => restored.close());
  restored.restoreFile(path.join(dir, "a.cwbackup"), PASS);
  assert.equal(restored.all("audio_chunks", mid).length, 3);
  assert.equal(restored.get("audio_chunks", mid, "mic:1").missing, true);
  assert.equal(restored.readAudio(mid, "mic:2").at(0), 2);
  assert.throws(() => restored.readAudio(mid, "mic:1"), /no longer available/);
});

test("N6: launch doesn't decrypt audio rows whose files are gone, so an unreadable one can't lock the library", (t) => {
  const dir = directory(t),
    key = randomBytes(32),
    mid = randomUUID();
  const first = new MeetingStore(dir, { key, keyId: "k" });
  first.put("meetings", mid, mid, {
    title: "Recorded",
    people: [],
    status: "ended",
    createdAt: 1,
  });
  first.db
    .prepare(
      "INSERT INTO audio_chunks(id,meeting_id,at,revision,data) VALUES(?,?,?,?,?)",
    )
    .run("mic:0", mid, 0, 1, Buffer.from("not a sealed record"));
  first.close();
  const reopened = new MeetingStore(dir, { key, keyId: "k" });
  t.after(() => reopened.close());
  assert.equal(reopened.get("meetings", mid).title, "Recorded");
});

test("N6: deleting a meeting during a backup neither fails the backup nor blocks for the busy timeout", (t) => {
  const dir = directory(t),
    key = randomBytes(32);
  const writer = new MeetingStore(dir, { key, keyId: "k" });
  t.after(() => writer.close());
  const keep = randomUUID(),
    gone = randomUUID();
  for (const m of [keep, gone]) {
    writer.put("meetings", m, m, {
      title: m,
      people: [],
      status: "ended",
      createdAt: 1,
    });
    writer.writeAudio(m, "mic", 0, Buffer.alloc(100, 1), {
      startMs: 0,
      endMs: 1,
    });
  }
  const reader = new MeetingStore(dir, { key, keyId: "k", readOnly: true });
  writer.backupStarted();
  const frames = reader.backupRecords();
  frames.next();
  const started = Date.now();
  writer.deleteMeeting(gone);
  assert.ok(Date.now() - started < 2000);
  const all = [...frames];
  assert.equal(all.at(-1).type, "end");
  assert.equal(all.at(-1).missingAudio, 1);
  reader.close();
  writer.backupFinished();
  assert.equal(writer.checkpointPending, false);
});

test("N7: a 0.5.0 backup with an orphan audio chunk restores fully; a failed legacy restore leaves the library empty", (t) => {
  const store = new MeetingStore(directory(t), { key: randomBytes(32) });
  t.after(() => store.close());
  const audio = (meetingId, channel = "mic") => ({
    meetingId,
    id: `${channel}:0`,
    channel,
    sequence: 0,
    path: `audio/${meetingId}/${channel}/0.cwa`,
    startMs: 0,
    endMs: 10000,
  });
  const backup = (chunk) =>
    sealBackup(
      {
        schema: 1,
        records: {
          meetings: [
            { id: "kept", meetingId: "kept", status: "ended", people: [] },
          ],
          docs: [
            {
              id: "notes:original",
              meetingId: "kept",
              text: "My notes",
              version: 1,
            },
          ],
          audio_chunks: [chunk, audio("deleted")],
        },
        audio: [
          { meetingId: chunk.meetingId, id: chunk.id, data: "AQID" },
          { meetingId: "deleted", id: "mic:0", data: "BAUG" },
        ],
      },
      PASS,
    );
  assert.throws(
    () => store.restore(backup(audio("kept", "speaker")), PASS),
    /Invalid audio chunk/,
  );
  assert.equal(store.all("meetings").length, 0);
  store.restore(backup(audio("kept")), PASS);
  assert.equal(store.get("docs", "kept", "notes:original").text, "My notes");
  assert.deepEqual([...store.readAudio("kept", "mic:0")], [1, 2, 3]);
  assert.equal(store.all("audio_chunks").length, 1);
});

test("N9: assistant search returns consented meetings behind many older ones and indexes only those", async (t) => {
  const dir = directory(t),
    key = randomBytes(32);
  const writer = new MeetingStore(dir, { key, keyId: "k" });
  writer.transaction(() => {
    for (let i = 0; i < 120; i++) {
      const id = randomUUID();
      writer.put("meetings", id, id, {
        title: `Budget review ${i}`,
        people: [],
        status: "ended",
        createdAt: i,
      });
      writer.put("segments", id, "system:e1:0", {
        text: "Budget, budget: the budget again.",
        final: true,
        startMs: 0,
      });
    }
  });
  const consented = randomUUID();
  writer.put("meetings", consented, consented, {
    title: "Vendor sync",
    people: [],
    status: "ended",
    assistantAccess: true,
    createdAt: 1000,
  });
  writer.put("segments", consented, "system:e1:0", {
    text: "We went through the agenda and finally the budget, which is approved.",
    final: true,
    startMs: 0,
  });
  const reader = new MeetingStore(dir, { key, keyId: "k", readOnly: true });
  const search = new MeetingSearch(reader, { assistantOnly: true });
  t.after(() => {
    search.close();
    reader.close();
    writer.close();
  });
  const mcp = new MeetingMcp({ enabled: () => true, store: reader, search });
  assert.deepEqual(
    (await mcp.call("meeting_search", { query: "budget" })).meetings.map(
      (m) => m.title,
    ),
    ["Vendor sync"],
  );
  assert.deepEqual(await search.search("review"), []);
});

test("N10: the local model sees short evidence aliases, and its references map back to segment IDs", async () => {
  const prompts = [];
  const rows = Array.from({ length: 3 }, (_, i) => ({
    id: `system:e1:${i}:run:${randomUUID()}`,
    final: true,
    speaker: "Dana",
    text: i === 1 ? "I will send the proposal on Friday." : `Line ${i}.`,
  }));
  const documents = new LocalDocuments({
    run: async (mode, { prompt }) => {
      prompts.push(JSON.parse(prompt));
      return {
        summary: [{ text: "Proposal coming", segmentIds: ["s2"] }],
        decisions: [{ text: "Echoed a real ID", segmentIds: [rows[2].id] }],
        openQuestions: [],
        actions: [
          {
            text: "Send the proposal",
            segmentIds: ["s2"],
            ownerQuote: "I will send the proposal",
            dueQuote: "on Friday",
          },
        ],
      };
    },
  });
  const result = await documents.generate(rows, { task: "recap" });
  assert.deepEqual(
    prompts[0].evidence.map((e) => e.id),
    ["s1", "s2", "s3"],
  );
  assert.deepEqual(result.summary[0].refs, [rows[1].id]);
  assert.deepEqual(result.decisions[0].refs, [rows[2].id]);
  assert.equal(result.actions[0].owner.name, "Dana");
  assert.equal(result.actions[0].due.text, "on Friday");
});

test("N10: aliases survive section merges, and the model never sees run-scoped IDs", async () => {
  const run = randomUUID();
  const rows = Array.from({ length: 300 }, (_, i) => ({
    id: `system:e1:${i}:run:${run}`,
    final: true,
    speaker: "Dana",
    text: `Line ${i} of a long meeting with enough words to fill several local-model chunks.`,
  }));
  let sections = 0,
    merges = 0,
    leaked = false;
  const documents = new LocalDocuments({
    run: async (mode, { prompt }) => {
      if (prompt.includes(":run:")) leaked = true;
      const p = JSON.parse(prompt);
      const ids = p.evidence
        ? [p.evidence[0].id]
        : [p.sections[0].summary[0]?.segmentIds?.[0]].filter(Boolean);
      p.evidence ? sections++ : merges++;
      return {
        summary: [{ text: `From ${ids[0]}`, segmentIds: ids }],
        decisions: [],
        openQuestions: [],
        actions: [],
      };
    },
  });
  const result = await documents.generate(rows, { task: "recap" });
  assert.ok(sections > 2 && merges > 1);
  assert.equal(leaked, false);
  assert.deepEqual(result.summary[0].refs, [rows[0].id]);
});

test("N12: Delete all removes a library that couldn't be opened at launch", async (t) => {
  const dir = path.join(directory(t), "meetings");
  const first = new MeetingStore(dir, { storage: keychain });
  const id = randomUUID();
  first.put("meetings", id, id, {
    title: "Private",
    people: [],
    status: "ended",
    createdAt: 1,
  });
  first.close();
  const meetings = new MeetingService({ store: null });
  await meetings.deleteAll();
  const opened = removeUnopenedLibrary({
    meetings,
    directory: dir,
    open: () => {
      throw new Error("Keychain locked.");
    },
  });
  assert.equal(opened, null);
  assert.equal(existsSync(dir), false);
  const later = new MeetingStore(dir, { storage: keychain });
  t.after(() => later.close());
  assert.equal(later.all("meetings").length, 0);
});

test("Improvements: a malformed audio index row no longer locks the library; generic labels aren't owners; MCP explains in-progress meetings", async (t) => {
  const dir = directory(t),
    key = randomBytes(32),
    mid = randomUUID();
  const first = new MeetingStore(dir, { key, keyId: "k" });
  first.put("meetings", mid, mid, {
    title: "Recorded",
    people: [],
    status: "ended",
    createdAt: 1,
  });
  first.writeAudio(mid, "mic", 0, Buffer.alloc(10, 1), {
    startMs: 0,
    endMs: 1,
  });
  first.put("audio_chunks", mid, "unexpected", { channel: "mic" });
  mkdirSync(path.join(dir, "audio", mid, "notes"), { recursive: true });
  writeFileSync(path.join(dir, "audio", mid, "notes", "keep.txt"), "x");
  first.close();
  const reopened = new MeetingStore(dir, { key, keyId: "k" });
  t.after(() => reopened.close());
  assert.equal(reopened.get("meetings", mid).title, "Recorded");
  assert.deepEqual(readdirSync(path.join(dir, "audio", mid, "notes")), [
    "keep.txt",
  ]);
  const owner = (speaker) =>
    validateDocument(
      {
        actions: [
          {
            text: "Send it",
            segmentIds: ["a"],
            ownerQuote: "I'll send it",
          },
        ],
      },
      [{ id: "a", final: true, speaker, text: "I'll send it today." }],
    ).actions[0].owner.name;
  assert.equal(owner("Them"), null);
  assert.equal(owner("Speaker 2"), null);
  assert.equal(owner("Dana"), "Dana");
  assert.equal(owner("You"), "You");
  reopened.put("meetings", "running", "running", {
    title: "Live",
    people: [],
    status: "running",
    assistantAccess: true,
    createdAt: 2,
  });
  const mcp = new MeetingMcp({
    enabled: () => true,
    store: reopened,
    search: { search: async () => [] },
  });
  await assert.rejects(
    mcp.call("meeting_get", { meetingId: "running" }),
    /still in progress/,
  );
});
