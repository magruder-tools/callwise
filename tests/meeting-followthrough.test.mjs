import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { MeetingStore } from "../core/meetings/store.mjs";
import { MeetingService } from "../core/meetings/service.mjs";
import { MeetingRecorder } from "../desktop/meeting-recorder.mjs";
import { MeetingSearch } from "../desktop/meeting-search.mjs";
import { AppleFollowThrough } from "../desktop/apple-followthrough.mjs";
function setup(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "callwise-exports-")),
    store = new MeetingStore(dir, { key: randomBytes(32) });
  t.after(() => {
    store.close();
    rmSync(dir, { force: true, recursive: true });
  });
  const service = new MeetingService({ store });
  const meeting = service.begin({ captureMode: "notes-only" });
  return { dir, store, service, meeting };
}
test("audio worker encodes, seals and indexes separate chunks with playback timing", async (t) => {
  const { store, dir, meeting } = setup(t),
    recorder = new MeetingRecorder(),
    errors = [];
  recorder.on("error", (e) => errors.push(e));
  recorder.start({ store, meetingId: meeting.id, enabled: true });
  for (let i = 0; i < 110; i++) {
    const pcm = Buffer.alloc(4800);
    for (let j = 0; j < 2400; j++)
      pcm.writeInt16LE(
        Math.round(
          Math.sin(((i * 2400 + j) * 2 * Math.PI * 440) / 24000) * 5000,
        ),
        j * 2,
      );
    recorder.push("mic", pcm, (i + 1) * 100);
  }
  await recorder.finish();
  assert.deepEqual(errors, []);
  const chunks = store.all("audio_chunks", meeting.id);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].startMs, 0);
  assert.equal(chunks[1].endMs, 11000);
  const bytes = store.readAudio(meeting.id, chunks[0].id);
  assert.ok(bytes.length > 5000);
  assert.notDeepEqual(
    readFileSync(path.join(dir, chunks[0].path)).subarray(0, 20),
    bytes.subarray(0, 20),
  );
});
test("search worker finds encrypted transcript evidence with people and action filters", async (t) => {
  const { store, meeting } = setup(t);
  store.put("meetings", meeting.id, meeting.id, {
    ...meeting,
    title: "Launch decision",
    people: ["Taylor"],
    status: "ended",
  });
  store.put("segments", meeting.id, "evidence", {
    text: "The copper lantern will launch on Friday.",
    final: true,
  });
  store.put("actions", meeting.id, "action", {
    text: "Send the plan",
    state: "confirmed",
    completed: false,
  });
  const search = new MeetingSearch(store);
  try {
    const hits = await search.search("copper lantern", {
      person: "Taylor",
      openActions: true,
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].excerpts[0].segmentId, "evidence");
    assert.deepEqual(await search.search("copper", { person: "Nobody" }), []);
  } finally {
    search.close();
  }
});
test("Apple exports require preview and explicit destination, reject stale content, and retry without duplicates", async (t) => {
  const { store, service, meeting } = setup(t);
  const action = service.updateAction(meeting.id, {
    text: "Send proposal",
    owner: "Taylor",
    confirmOwner: false,
    due: "2026-11-06",
    confirmDue: false,
  });
  const creates = [];
  const apple = new AppleFollowThrough({
    meetings: service,
    resources: "/fixed/resources",
    native: {
      run: async (mode, args) => {
        if (args.op === "lists") return [{ id: "list", title: "My tasks" }];
        creates.push(args);
        return [{ key: args.actions[0].key, existing: creates.length > 1 }];
      },
    },
  });
  await assert.rejects(
    apple.commit({ token: "no", confirm: true, destinationId: "list" }),
    /Review/,
  );
  let preview = await apple.preview({
    meetingId: meeting.id,
    destination: "reminders",
    actionIds: [action.id],
  });
  await assert.rejects(
    apple.commit({
      token: preview.token,
      destinationId: "wrong",
      confirm: true,
    }),
    /destination/,
  );
  await apple.commit({
    token: preview.token,
    destinationId: "list",
    confirm: true,
  });
  assert.equal(creates[0].actions[0].dueDate, undefined);
  assert.doesNotMatch(creates[0].actions[0].notes, /Owner:/);
  preview = await apple.preview({
    meetingId: meeting.id,
    destination: "reminders",
    actionIds: [action.id],
  });
  const again = await apple.commit({
    token: preview.token,
    destinationId: "list",
    confirm: true,
  });
  assert.equal(again.existing, true);
  assert.equal(creates.length, 1);
  preview = await apple.preview({
    meetingId: meeting.id,
    destination: "reminders",
    actionIds: [action.id],
  });
  service.updateAction(meeting.id, { id: action.id, text: "Changed proposal" });
  await assert.rejects(
    apple.commit({
      token: preview.token,
      destinationId: "list",
      confirm: true,
    }),
    /changed/,
  );
});
test("Notes text is passed as JSON data to the fixed script, including quotes and shell syntax", async (t) => {
  const { service, meeting } = setup(t),
    calls = [];
  service.saveNotes(meeting.id, {
    text: 'Literal "quotes"; $(touch no) `code` <script>bad</script>',
    version: 0,
  });
  const apple = new AppleFollowThrough({
    meetings: service,
    resources: "/fixed/resources",
    native: {},
    run: (binary, args, options, cb) => {
      calls.push({ binary, args, options });
      const request = JSON.parse(args[3]);
      cb(
        null,
        JSON.stringify(
          request.op === "folders"
            ? [{ id: "folder", title: "Personal" }]
            : { id: "saved-note", existing: false },
        ),
      );
    },
  });
  const preview = await apple.preview({
    meetingId: meeting.id,
    destination: "notes",
  });
  await apple.commit({
    token: preview.token,
    destinationId: "folder",
    confirm: true,
  });
  assert.equal(calls[1].binary, "/usr/bin/osascript");
  assert.equal(calls[1].args[2], "/fixed/resources/apple-notes.js");
  assert.match(JSON.parse(calls[1].args[3]).text, /\$\(touch no\)/);
  assert.equal(calls[1].options.shell, undefined);
});
test("disk-full writes stay visible in the bounded retry buffer and are retried", () => {
  let full = true;
  const records = new Map();
  const store = {
    get: (t, m, id) => records.get(`${t}:${m}:${id}`),
    all: () => [...records.values()],
    put(t, m, id, value) {
      if (full)
        throw Object.assign(new Error("database or disk is full"), {
          code: "SQLITE_FULL",
        });
      const r = { ...value, id, meetingId: m, revision: 1 };
      records.set(`${t}:${m}:${id}`, r);
      return r;
    },
    close() {},
  };
  const service = new MeetingService({ store });
  service.put("docs", "meeting", "notes:original", {
    text: "Must survive",
    version: 1,
  });
  assert.equal(
    service.get("docs", "meeting", "notes:original").text,
    "Must survive",
  );
  assert.match(service.warning, /disk is full/);
  full = false;
  service.retryWrites();
  assert.equal(service.pendingWrites.size, 0);
  assert.equal(
    service.get("docs", "meeting", "notes:original").text,
    "Must survive",
  );
  service.close();
});
