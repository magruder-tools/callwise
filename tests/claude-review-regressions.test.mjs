import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { MeetingStore } from "../core/meetings/store.mjs";
import { MeetingService } from "../core/meetings/service.mjs";
import { CallController } from "../core/controller.mjs";
import { AppleSpeechSession } from "../providers/apple-speech.mjs";
import { startMeeting } from "../desktop/meeting-start.mjs";
import { MeetingSearch } from "../desktop/meeting-search.mjs";
import { MeetingMcp } from "../desktop/meeting-mcp.mjs";
import { noticeHash, noticeText } from "../core/meetings/notice.mjs";
import { validateDocument } from "../core/meetings/recaps.mjs";
import { sealBackup } from "../core/meetings/crypto.mjs";
import { parseHTML } from "linkedom";
import { renderRegions } from "../ui/render.mjs";
import { AppleFollowThrough } from "../desktop/apple-followthrough.mjs";
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const row = (id = "s") => ({
  id,
  text: "We agreed to send the outline.",
  speaker: "Dana",
  speakerKey: "them",
  channel: "system",
  startMs: 0,
  endMs: 900,
  final: true,
});
function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "callwise-review-"));
  const key = randomBytes(32),
    store = new MeetingStore(directory, { key });
  store.testCleanup = [];
  t.after(() => {
    for (const close of store.testCleanup) close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, directory, key };
}
function meeting(store, id = "m", extra = {}) {
  store.put("meetings", id, id, {
    title: "Planning",
    people: [],
    status: "ended",
    createdAt: 1000,
    contentRevision: 0,
    ...extra,
  });
  store.put("docs", id, "notes:original", {
    text: "My original notes",
    version: 0,
  });
  return id;
}
function notice(preferences) {
  return {
    confirmed: true,
    method: "spoken",
    configHash: noticeHash(preferences),
    presentedAt: Date.now(),
  };
}

test("H1: a reopened library is visible and queued document jobs resume serially", async (t) => {
  const { store } = fixture(t);
  meeting(store);
  store.put("segments", "m", "s", row());
  for (const id of ["recap", "enhance"])
    store.put("jobs", "m", id, { status: "queued" });
  let active = 0,
    maximum = 0,
    calls = 0;
  const service = new MeetingService({
    store,
    native: {
      async run() {
        calls++;
        maximum = Math.max(maximum, ++active);
        await tick();
        active--;
        return {
          summary: [{ text: "Agreed outline", segmentIds: ["s"] }],
          enhancedNotes: "My original notes.",
        };
      },
    },
  });
  store.testCleanup.push(() => service.close());
  assert.equal(service.snapshot().library[0].title, "Planning");
  service.attach({ on() {}, engine: { emitState() {} } });
  await tick(450);
  assert.ok(calls >= 2);
  assert.equal(maximum, 1);
  assert.ok(service.all("jobs").every((j) => j.status === "done"));
});

test("H2: helper crash then pause/resume preserves all earlier final speech", async () => {
  const hosts = [];
  class Host extends EventEmitter {
    async request(op, p) {
      if (op === "start") this.epoch = p.epoch;
      return {};
    }
    send() {}
    close() {}
    say(text) {
      this.emit("message", {
        type: "segment",
        row: { ...row(`mic:e${this.epoch}:0`), channel: "mic", text },
      });
    }
  }
  let session;
  const c = new CallController({
    preferences: { liveHelp: false },
    speechFactory(options) {
      if (
        !session ||
        session.stopped ||
        session.captureEpoch !== options.captureEpoch
      ) {
        session?.close();
        session = new AppleSpeechSession({
          epoch: options.captureEpoch,
          hostFactory() {
            const host = new Host();
            hosts.push(host);
            return host;
          },
        });
        session.captureEpoch = options.captureEpoch;
      }
      return session.adapter(options);
    },
  });
  try {
    await c.command("start", { source: "audio", consent: true });
    hosts.at(-1).say("Alpha");
    hosts.at(-1).emit("exit", 1);
    await tick();
    hosts.at(-1).say("Bravo");
    await c.command("pause");
    await c.command("start", { source: "audio", consent: true });
    hosts.at(-1).say("Charlie");
    const rows = [...c.engine.transcript.values()].filter((r) => !r.gap);
    assert.deepEqual(
      rows.map((r) => r.text),
      ["Alpha", "Bravo", "Charlie"],
    );
    assert.equal(new Set(rows.map((r) => r.id)).size, 3);
  } finally {
    c.close();
  }
});

test("H3: concurrent start rejection cannot end the first meeting or prevent saving", async (t) => {
  const { store } = fixture(t);
  let connected;
  const wait = new Promise((resolve) => {
    connected = resolve;
  });
  const c = new CallController({
    preferences: { liveHelp: false },
    speechFactory: () => ({
      connect: () => wait,
      finish: async () => {},
      push() {},
      close() {},
    }),
  });
  const service = new MeetingService({ store });
  c.meetingService = service;
  service.attach(c);
  store.testCleanup.push(() => {
    c.close();
    service.close();
  });
  const payload = { source: "audio", notice: notice(c.preferences) };
  const starting = startMeeting({ meetings: service, controller: c, payload });
  await assert.rejects(
    startMeeting({ meetings: service, controller: c, payload }),
    /still starting/,
  );
  connected();
  await starting;
  assert.equal(service.get("meetings", service.activeId).status, "running");
  c.engine.ingest(row());
  await c.command("end");
  assert.equal(
    store.all("segments", service.activeId).filter((r) => !r.gap).length,
    1,
  );
});

test("H4: the notebook never invokes the legacy cloud summary or recap", async () => {
  let calls = 0;
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    preferences: { liveHelp: true },
    documentProvider: {
      async generate() {
        calls++;
        return {};
      },
    },
  });
  c.meetingService = { snapshot: () => ({}) };
  try {
    c.lastSummaryMs = -1000000;
    c.engine.transcript.set("s", row());
    c.maybeSummarize();
    await c.makeRecap();
    assert.equal(calls, 0);
  } finally {
    c.close();
  }
  assert.match(noticeText({ liveHelp: true }), /OpenAI/);
});

test("H5 and L2: only selected recap evidence leaves the notebook, with trusted preferences", async (t) => {
  const { store } = fixture(t);
  meeting(store, "old");
  store.put("docs", "old", "recap", {
    summary: [{ text: "Safe recap" }],
    decisions: [{ text: "Safe decision" }],
  });
  store.put("docs", "old", "notes:original", {
    text: "PRIVATE RAW NOTES",
    version: 0,
  });
  store.put("segments", "old", "s", {
    ...row(),
    text: "PRIVATE OLD TRANSCRIPT",
  });
  const service = new MeetingService({ store });
  store.testCleanup.push(() => service.close());
  const materials = [];
  const controller = {
    preferences: { liveHelp: false },
    engine: { status: "idle", context: { add: (v) => materials.push(v) } },
    command: async () => ({}),
  };
  await startMeeting({
    meetings: service,
    controller,
    payload: {
      source: "manual",
      captureMode: "notes-only",
      prior: ["old"],
      preferences: { liveHelp: true, retainAudio: true },
    },
  });
  assert.equal(service.current().engine, "manual");
  assert.equal(service.current().liveHelp, false);
  assert.match(materials[0].text, /Safe recap/);
  assert.doesNotMatch(materials[0].text, /PRIVATE/);
  controller.engine.status = "paused";
  await assert.rejects(
    startMeeting({
      meetings: service,
      controller,
      payload: { source: "audio" },
    }),
    /changing its source/,
  );
});

test("H6 and M1: streamed backup preserves more than 100,000 rows under a new key", (t) => {
  const { store, directory } = fixture(t),
    other = fixture(t).store;
  meeting(store);
  const count = 100005;
  store.transaction(() => {
    for (let i = 0; i < count; i++)
      store.put("segments", "m", `s${i}`, row(`s${i}`));
  });
  assert.equal(store.all("segments", "m").length, count);
  const file = path.join(directory, "library.cwbackup");
  store.backupToFile(file, "a long test-only passphrase");
  other.restoreFile(file, "a long test-only passphrase");
  assert.equal(
    other.db.prepare("SELECT count(*) AS n FROM segments").get().n,
    count,
  );
  assert.equal(other.get("segments", "m", "s100004").text, row().text);
});

test("H7: recovery retains the last indexed audio file beyond the old cap", (t) => {
  const { store, directory } = fixture(t);
  meeting(store);
  store.transaction(() => {
    for (let i = 0; i < 100005; i++)
      store.put("audio_chunks", "m", `mic:${i}`, {
        channel: "mic",
        sequence: i,
        path: `audio/m/mic/${i}.cwa`,
      });
  });
  const file = path.join(directory, "audio/m/mic/100004.cwa");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "retained");
  store.recover();
  assert.equal(readFileSync(file, "utf8"), "retained");
});

test("M1: truncated streamed backups roll back, while legacy backups still restore", (t) => {
  const source = fixture(t).store,
    target = fixture(t).store;
  meeting(source);
  const bytes = source.backup("a long test-only passphrase");
  assert.throws(
    () =>
      target.restore(
        bytes.subarray(0, bytes.length - 10),
        "a long test-only passphrase",
      ),
    /incomplete/,
  );
  assert.equal(target.all("meetings").length, 0);
  const legacy = sealBackup(
    {
      schema: 1,
      records: {
        meetings: [
          { id: "legacy", meetingId: "legacy", status: "ended", people: [] },
        ],
      },
      audio: [],
    },
    "a long test-only passphrase",
  );
  target.restore(legacy, "a long test-only passphrase");
  assert.equal(target.get("meetings", "legacy").id, "legacy");
});

test("M2: delete all clears decrypted state, key, backups and stale editing targets", async (t) => {
  const { store, directory } = fixture(t);
  meeting(store);
  store.put("segments", "m", "s", row());
  const service = new MeetingService({ store });
  store.testCleanup.push(() => service.close());
  service.selectedId = "m";
  service.snapshot();
  mkdirSync(path.join(directory, "backups"));
  writeFileSync(path.join(directory, "backups/old"), "old");
  const key = Buffer.from(store.key);
  await service.deleteAll();
  assert.deepEqual(service.snapshot().library, []);
  assert.equal(service.current(), null);
  assert.equal(existsSync(path.join(directory, "backups")), false);
  assert.equal(store.key.equals(key), false);
  await assert.rejects(
    service.command("meeting.edit", { meetingId: "m", title: "Resurrected" }),
    /not found/,
  );
});

test("M3: a long-lived reader sees newly saved meetings in search", async (t) => {
  const { store, directory, key } = fixture(t);
  meeting(store, "first");
  const reader = new MeetingStore(directory, { key, readOnly: true }),
    search = new MeetingSearch(reader);
  t.after(() => {
    search.close();
    reader.close();
  });
  await search.search("Planning");
  meeting(store, "second", { title: "LaterLaunch" });
  assert.equal((await search.search("LaterLaunch"))[0].id, "second");
});

test("M4/M5: negotiate old MCP versions, allow legacy metadata, and enforce per-meeting consent", async (t) => {
  const { store } = fixture(t);
  meeting(store, "allowed", { assistantAccess: true });
  meeting(store, "private");
  meeting(store, "live", { status: "running", assistantAccess: true });
  const server = new MeetingMcp({
    store,
    enabled: () => true,
    search: { search: async () => [{ id: "private" }, { id: "allowed" }] },
  });
  const response = await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  assert.equal(response.protocolVersion, "2025-11-25");
  const result = await server.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "meeting_list",
      arguments: {},
      _meta: { progressToken: "p" },
    },
  });
  assert.equal(result.isError, false);
  assert.deepEqual(
    (await server.call("meeting_list", {})).meetings.map((m) => m.id),
    ["allowed"],
  );
  assert.deepEqual(
    (await server.call("meeting_search", { query: "Planning" })).meetings.map(
      (m) => m.id,
    ),
    ["allowed"],
  );
  await assert.rejects(
    server.call("meeting_get", { meetingId: "private" }),
    /notice/,
  );
});

test("M7: an owner suggestion is a speaker name with separate evidence", () => {
  const evidence = {
    ...row(),
    text: "I will send the outline.",
    speaker: "Dana",
  };
  const d = validateDocument(
    {
      actions: [
        { text: "Send outline", segmentIds: ["s"], ownerQuote: evidence.text },
      ],
    },
    [evidence],
  );
  assert.equal(d.actions[0].owner.name, "Dana");
  assert.equal(d.actions[0].owner.evidence, evidence.text);
  assert.equal(d.actions[0].owner.confirmed, false);
});

test("M8: renaming 1,500 lines emits once and preserves diarization eligibility", (t) => {
  const { store } = fixture(t);
  meeting(store);
  store.put("speakers", "m", "them", { label: "Them" });
  store.transaction(() => {
    for (let i = 0; i < 1500; i++)
      store.put("segments", "m", `s${i}`, row(`s${i}`));
  });
  const service = new MeetingService({ store });
  store.testCleanup.push(() => service.close());
  let events = 0;
  service.on("state", () => events++);
  service.renameSpeaker("m", { speakerKey: "them", name: "Dana" });
  assert.equal(events, 1);
  assert.ok(
    service
      .all("segments", "m")
      .every((r) => r.speaker === "Dana" && !r.speakerOverride),
  );
});

test("M9: history questions use bounded relevant excerpts with a cancel signal", async (t) => {
  const { store } = fixture(t);
  meeting(store);
  store.transaction(() => {
    for (let i = 0; i < 1500; i++)
      store.put("segments", "m", `s${i}`, {
        ...row(`s${i}`),
        startMs: i * 1000,
      });
  });
  const service = new MeetingService({
    store,
    search: {
      search: async () => [{ id: "m", excerpts: [{ segmentId: "s700" }] }],
      close() {},
    },
  });
  store.testCleanup.push(() => service.close());
  let submitted;
  service.documents.generate = async (rows, options) => {
    submitted = rows;
    assert.ok(options.signal);
    return { answer: "Agreed", answerRefs: [], engine: "apple" };
  };
  await service.command("meeting.ask", { question: "What did we agree?" });
  assert.equal(submitted.length, 3);
  assert.ok(submitted.some((r) => r.id === "m:s700"));
});

test("M10/L4: one failed speech channel does not restart the other and discards retain run identity", async () => {
  const hosts = [],
    rows = [],
    discarded = [],
    states = [];
  class Host extends EventEmitter {
    request() {
      return Promise.resolve({});
    }
    send() {}
    close() {}
  }
  const session = new AppleSpeechSession({
    hostFactory() {
      const h = new Host();
      hosts.push(h);
      return h;
    },
  });
  session.adapter({
    channel: "mic",
    onSegment: (r) => rows.push(r),
    onDiscard: (ids) => discarded.push(...ids),
  });
  session.adapter({ channel: "system", onStatus: (s) => states.push(s) });
  try {
    await session.connect();
    const h = hosts[0];
    h.emit("message", { type: "error", channel: "system", code: "failed" });
    h.emit("message", {
      type: "segment",
      row: { ...row("mic:e0:0"), channel: "mic", final: false },
    });
    h.emit("message", { type: "discard", channel: "mic", ids: ["mic:e0:0"] });
    assert.equal(hosts.length, 1);
    assert.equal(states.at(-1), "failed");
    assert.equal(discarded[0], rows[0].id);
  } finally {
    session.close();
  }
});

test("L1: End waits for Pause's drain and still reaches ended", async () => {
  let release;
  const draining = new Promise((resolve) => {
    release = resolve;
  });
  const c = new CallController({
    preferences: { liveHelp: false },
    speechFactory: () => ({
      connect: async () => {},
      push() {},
      close() {},
      finish: () => draining,
    }),
  });
  try {
    await c.command("start", { source: "audio", consent: true });
    const pausing = c.command("pause");
    const ending = c.command("end");
    release();
    await pausing;
    await ending;
    assert.equal(c.engine.status, "ended");
  } finally {
    c.close();
  }
});

test("L8: colon-containing identifiers cannot alias encrypted record identities", (t) => {
  const { store } = fixture(t);
  store.put("docs", "legacy:a", "b", { text: "Secret" });
  const bytes = store.db
    .prepare("SELECT data FROM docs WHERE meeting_id=? AND id=?")
    .get("legacy:a", "b").data;
  store.db
    .prepare(
      "INSERT INTO docs(id,meeting_id,at,revision,data) VALUES(?,?,?,?,?)",
    )
    .run("a:b", "legacy", 0, 1, bytes);
  assert.throws(() => store.get("docs", "legacy", "a:b"));
});

test("L10: crash recovery creates a transcript gap and queues exactly one recap", (t) => {
  const { store } = fixture(t);
  meeting(store, "m", { status: "running" });
  store.recover();
  store.recover();
  assert.equal(store.all("segments", "m").filter((r) => r.gap).length, 1);
  assert.equal(store.get("jobs", "m", "recap").status, "queued");
});

test("L11: an unrelated title edit cannot hide the first recap as a draft", async (t) => {
  const { store } = fixture(t);
  meeting(store);
  store.put("segments", "m", "s", row());
  const service = new MeetingService({ store });
  store.testCleanup.push(() => service.close());
  service.documents.generate = async () => {
    await service.command("meeting.edit", {
      meetingId: "m",
      title: "User title",
    });
    return {
      engine: "apple",
      summary: [{ text: "Outline", refs: ["s"] }],
      decisions: [],
      openQuestions: [],
      actions: [],
    };
  };
  await service.generate("m");
  assert.ok(service.current("m").recap);
  assert.equal(service.current("m").recapDraft, null);
});

test("L12: deleted meetings reject late audio writes and remove finishing chunks", async (t) => {
  const { store, directory } = fixture(t);
  meeting(store);
  const service = new MeetingService({ store });
  store.testCleanup.push(() => service.close());
  const recorder = {
    close: async () => {
      const file = path.join(directory, "audio/m/mic/0.cwa");
      await tick();
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "late");
    },
  };
  service.finishingConsumers.add({ meetingId: "m", recorder });
  await service.delete("m");
  assert.equal(existsSync(path.join(directory, "audio/m")), false);
  assert.throws(
    () => store.writeAudio("m", "mic", 0, Buffer.from("late"), {}),
    /not found/,
  );
});

test("M6: an objection prevents resume and offers deletion before notes-only continuation", async (t) => {
  const { store } = fixture(t);
  const c = new CallController({
    preferences: { liveHelp: false, preferredSource: "manual" },
  });
  const service = new MeetingService({ store });
  c.meetingService = service;
  service.attach(c);
  store.testCleanup.push(() => {
    c.close();
    service.close();
  });
  await startMeeting({
    meetings: service,
    controller: c,
    payload: { source: "manual", notice: notice(c.preferences) },
  });
  const id = service.activeId;
  await service.command("meeting.notice", { meetingId: id, objection: true });
  assert.equal(c.engine.status, "paused");
  await assert.rejects(
    startMeeting({
      meetings: service,
      controller: c,
      payload: { source: "manual" },
    }),
    /objection/,
  );
  await service.command("meeting.objection.resolve", {
    meetingId: id,
    choice: "delete",
  });
  // 0.5.2: "Delete transcript and audio" removes what was captured, not the meeting or the user's notes
  // (see tests/claude-followup-regressions.test.mjs, N4).
  assert.equal(store.get("meetings", id).captureDeleted, true);
  assert.equal(store.all("segments", id).length, 0);
});

test("L3: adopted enhanced notes refresh while ordinary snapshots retain a typed draft", () => {
  const { document } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  const root = document.getElementById("app");
  const view = (text, version = 1) =>
    `<div data-region="notes"><textarea id="enhanced-m" data-editor-version="${version}">${text}</textarea></div>`;
  renderRegions(root, view("First"));
  root.querySelector("textarea").value = "Unsaved edit";
  renderRegions(root, view("First"));
  assert.equal(root.querySelector("textarea").value, "Unsaved edit");
  renderRegions(root, view("Adopted version", 2));
  assert.equal(root.querySelector("textarea").value, "Adopted version");
});

test("L5: a second Notes save cannot race an in-flight export", async (t) => {
  const { store } = fixture(t);
  meeting(store);
  const service = new MeetingService({ store });
  store.testCleanup.push(() => service.close());
  const apple = new AppleFollowThrough({
    meetings: service,
    native: {},
    resources: "/fixed/resources",
  });
  let finish,
    calls = 0;
  apple.notes = async (request) => {
    if (request.op === "folders") return [{ id: "folder", title: "Test" }];
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const preview = await apple.preview({ meetingId: "m", destination: "notes" });
  const p = { token: preview.token, confirm: true, destinationId: "folder" };
  const saving = apple.commit(p);
  await assert.rejects(apple.commit(p), /already being saved/);
  finish({ id: "note", existing: false });
  await saving;
  assert.equal(calls, 1);
});

test("L5: large Notes export text travels over stdin, never command arguments", async () => {
  const content = "Literal $(not-a-command) <script>data</script> ".repeat(
    30000,
  );
  let sent, argumentsUsed;
  const apple = new AppleFollowThrough({
    meetings: {},
    native: {},
    resources: "/fixed/resources",
    run(_binary, args, _options, callback) {
      argumentsUsed = args;
      return {
        stdin: {
          on() {},
          end(text) {
            sent = text;
            callback(null, '{"id":"synthetic"}');
          },
        },
      };
    },
  });
  await apple.notes({ op: "export", text: content });
  assert.deepEqual(argumentsUsed, [
    "-l",
    "JavaScript",
    "/fixed/resources/apple-notes.js",
    "--stdin",
  ]);
  assert.equal(JSON.parse(sent).text, content);
});
