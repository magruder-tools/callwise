import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { MeetingStore } from "../core/meetings/store.mjs";
import { MeetingService } from "../core/meetings/service.mjs";
import { CallController } from "../core/controller.mjs";
import { startMeeting } from "../desktop/meeting-start.mjs";
import { noticeHash } from "../core/meetings/notice.mjs";
import { createMeetingUi } from "../ui/meetings.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const oldText = "Previously saved synthetic note.";
const latestText = `${oldText} Latest typed words must survive.`;

async function fixture(t, { withoutSaving = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "callwise-note-handoff-"));
  const store = new MeetingStore(directory, { key: randomBytes(32) });
  const preferences = { liveHelp: false };
  const controller = new CallController({
    preferences,
    speechFactory: () => ({
      connect: async () => {},
      push() {},
      finish: async () => {},
      close() {},
    }),
  });
  const meetings = new MeetingService({ store });
  controller.meetingService = meetings;
  meetings.attach(controller);
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  const listeners = new Map(),
    calls = [],
    ui = {};
  let beforeCommand = async () => {};
  const view = createMeetingUi({
    root: {
      addEventListener: (name, listener) => listeners.set(name, listener),
    },
    ui,
    state: {
      get: () => ({ ...controller.snapshot(), meetings: meetings.snapshot() }),
    },
    command: async (name, payload = {}) => {
      calls.push(name);
      await beforeCommand(name, payload);
      if (name.startsWith("meeting.")) return meetings.command(name, payload);
      if (name === "start")
        return startMeeting({ meetings, controller, payload });
      return controller.command(name, payload);
    },
    render() {},
    flushEdits: async () => {},
    clipboard: {},
  });
  t.after(async () => {
    beforeCommand = async () => {};
    await view.flushNotes().catch(() => {});
    controller.close();
    meetings.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  await startMeeting({
    meetings,
    controller,
    payload: {
      source: "audio",
      withoutSaving,
      title: "Synthetic objection test",
      notice: {
        confirmed: true,
        method: "spoken",
        configHash: noticeHash(preferences),
        presentedAt: Date.now(),
      },
    },
  });
  const oldId = meetings.activeId;
  await meetings.command("meeting.notes", {
    meetingId: oldId,
    text: oldText,
    version: 0,
  });
  return {
    store,
    meetings,
    controller,
    oldId,
    ui,
    calls,
    view,
    intercept: (callback) => {
      beforeCommand = callback;
    },
    type: (text) =>
      listeners.get("input")({
        target: {
          id: "notes",
          dataset: { meetingNotes: oldId },
          value: text,
          selectionStart: text.length,
        },
      }),
    act: (name) => view.act(name, { dataset: {} }),
  };
}

for (const choice of ["keep", "delete"])
  for (const withoutSaving of [false, true])
    test(`objection ${choice} preserves queued note edits (${withoutSaving ? "without saving" : "saved"})`, async (t) => {
      const f = await fixture(t, { withoutSaving });
      f.type(latestText);
      await f.act("m-objection");
      assert.equal(f.controller.engine.status, "paused");
      await f.act(`m-objection-${choice}`);
      const nextId = f.meetings.activeId;
      assert.notEqual(nextId, f.oldId);
      assert.equal(f.meetings.current().captureMode, "notes-only");
      const notesId = choice === "delete" ? nextId : f.oldId;
      assert.equal(
        f.meetings.get("docs", notesId, "notes:original").text,
        latestText,
      );
      assert.equal(f.ui.notesSaving, false);
      if (choice === "delete")
        assert.equal(f.meetings.get("meetings", f.oldId), null);
      if (withoutSaving) {
        assert.equal(f.store.all("meetings").length, 0);
        assert.equal(f.store.all("docs").length, 0);
      }
    });

test("objection deletion waits for an in-flight note save before copying the notes", async (t) => {
  const f = await fixture(t);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  f.intercept(async (name) => {
    if (name === "meeting.notes") {
      entered();
      await gate;
    }
  });
  f.type(latestText);
  await started;
  await f.act("m-objection");
  const resolving = f.act("m-objection-delete");
  try {
    await wait(20);
    assert.equal(f.calls.includes("meeting.objection.resolve"), false);
    assert.equal(f.controller.engine.status, "paused");
  } finally {
    release();
  }
  await resolving;
  assert.equal(f.meetings.current().notes.text, latestText);
  assert.equal(f.ui.notesSaving, false);
});

test("a failed note save blocks objection deletion and keeps the original meeting recoverable", async (t) => {
  const f = await fixture(t);
  f.intercept(async (name) => {
    if (name === "meeting.notes") throw new Error("Synthetic write failure");
  });
  f.type(latestText);
  await f.act("m-objection");
  await assert.rejects(
    f.act("m-objection-delete"),
    /latest notes could not be saved/,
  );
  assert.equal(f.meetings.activeId, f.oldId);
  assert.equal(f.controller.engine.status, "paused");
  assert.equal(f.meetings.current().objection, true);
  assert.equal(f.ui.objectionSheet, true);
  assert.equal(f.calls.includes("meeting.objection.resolve"), false);
  f.intercept(async () => {});
  await f.view.flushNotes();
  assert.equal(f.meetings.current().notes.text, latestText);
});
