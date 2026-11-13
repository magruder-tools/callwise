import test from "node:test";
import assert from "node:assert/strict";
import { CallController } from "../core/controller.mjs";
import { SampleClock } from "../providers/apple-speech.mjs";
import {
  noticeHash,
  noticeText,
  confirmNotice,
} from "../core/meetings/notice.mjs";
import {
  chunksForModel,
  validateDocument,
  mergeActions,
  LocalDocuments,
} from "../core/meetings/recaps.mjs";
import {
  stableSpeakerTurns,
  assignSpeakers,
} from "../core/meetings/speakers.mjs";
import { MeetingService } from "../core/meetings/service.mjs";
const row = {
  id: "r1",
  channel: "system",
  speaker: "Them",
  text: "Taylor will send the proposal on Friday.",
  final: true,
  startMs: 0,
  endMs: 2000,
};
test("sample clock follows samples, subtracts packet duration and marks real discontinuities", () => {
  const c = new SampleClock(),
    pcm = Buffer.alloc(4800);
  assert.deepEqual(c.packet(pcm, 100), {
    startMs: 0,
    durationMs: 100,
    gap: false,
  });
  assert.equal(c.packet(pcm, 201).startMs, 100);
  assert.deepEqual(c.packet(pcm, 5000), {
    startMs: 4900,
    durationMs: 100,
    gap: true,
  });
});
test("notice binds current recording/cloud choices and cannot be replaced by copy or stale confirmation", () => {
  const p = { retainAudio: false, speechEngine: "apple" },
    now = 5000,
    receipt = {
      confirmed: true,
      method: "spoken",
      configHash: noticeHash(p),
      presentedAt: 1000,
    };
  assert.match(noticeText(p), /without an audio recording/);
  assert.equal(confirmNotice(p, receipt, now).confirmedAt, now);
  assert.throws(() => confirmNotice({ ...p, retainAudio: true }, receipt, now));
  assert.throws(() => confirmNotice(p, { ...receipt, confirmed: false }, now));
  assert.throws(() => confirmNotice(p, receipt, 2000000));
});
test("local speech drains final words on End and rejects old epoch output", async () => {
  const callbacks = [],
    c = new CallController({
      preferences: { liveHelp: false },
      speechFactory: (opts) => {
        callbacks.push(opts);
        return {
          connect: async () => {},
          push() {},
          finish: async () =>
            opts.onSegment({
              ...row,
              id: opts.channel + ":tail",
              channel: opts.channel,
              text:
                opts.channel === "mic" ? "I will write the outline." : row.text,
            }),
          close() {},
        };
      },
    });
  await c.command("start", { source: "audio", consent: true });
  const old = callbacks[0];
  await c.command("end");
  assert.equal(c.engine.status, "ended");
  assert.equal(c.engine.transcript.size, 2);
  assert.equal(c.engine.cards.length, 0);
  await c.command("new");
  old.onSegment({ ...row, id: "late" });
  assert.equal(c.engine.transcript.size, 0);
  c.close();
});
test("timed out volatile words become a single unfinalized final with their original ID", async () => {
  const c = new CallController({
    speechFactory: (opts) => ({
      connect: async () => {},
      close() {},
      finish: async () => {},
      push() {},
    }),
  });
  await c.command("start", { source: "audio", consent: true });
  c.engine.ingest({ ...row, id: "partial", final: false });
  await c.command("pause");
  assert.equal(c.engine.transcript.get("partial").final, true);
  assert.equal(c.engine.transcript.get("partial").unfinalized, true);
  assert.equal(c.engine.transcript.size, 2);
  assert.match(
    [...c.engine.transcript.values()].find((r) => r.gap)?.text || "",
    /Final words may be missing/,
  );
  c.close();
});
test("local-only meetings neither call cloud help nor emit repeated missing-provider errors", async () => {
  let calls = 0;
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    preferences: { liveHelp: false },
    documentProvider: {
      generate: async () => {
        calls++;
        return {};
      },
    },
  });
  await c.command("start", { source: "manual", consent: true });
  c.engine.ingest({ ...row, text: "What do you recommend we do next?" });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.engine.cards.length, 0);
  assert.equal(c.engine.errors.length, 0);
  assert.equal(calls, 0);
  c.close();
});
test("recap validation rejects invented citations and ungrounded owners/deadlines", () => {
  const d = validateDocument(
    {
      summary: [
        { text: "Supported", segmentIds: ["r1"] },
        { text: "Invented", segmentIds: ["fake"] },
      ],
      actions: [
        {
          text: "Send proposal",
          segmentIds: ["r1"],
          ownerQuote: "Alex",
          dueQuote: "next Tuesday",
        },
      ],
    },
    [row],
  );
  assert.equal(d.summary.length, 1);
  assert.equal(d.actions[0].owner.name, null);
  assert.equal(d.actions[0].due.text, null);
  assert.equal(d.actions[0].state, "proposed");
});
test("chunking bounds long meetings and action regeneration preserves dismissed and edited items", () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({
    ...row,
    id: String(i),
    text: "evidence ".repeat(300),
  }));
  assert.ok(chunksForModel(rows).every((c) => JSON.stringify(c).length < 6700));
  const original = {
    id: "stable",
    text: "Send proposal",
    refs: ["r1"],
    state: "dismissed",
    edited: true,
  };
  assert.deepEqual(
    mergeActions(
      [original],
      [{ ...original, id: "new", state: "proposed", edited: false }],
    ),
    [original],
  );
});
test("local document fallback is labelled as excerpts and invents no actions", async () => {
  const d = await new LocalDocuments({
    run: async () => {
      throw new Error("off");
    },
  }).generate([row]);
  assert.equal(d.engine, "extractive");
  assert.equal(d.actions.length, 0);
  assert.equal(d.summary[0].quotation, true);
});
test("speaker clustering reuses temporal identities and keeps user overrides", () => {
  const previous = [
    { startMs: 0, endMs: 1000, speakerKey: "s1" },
    { startMs: 1000, endMs: 2000, speakerKey: "s2" },
  ];
  const turns = stableSpeakerTurns(previous, [
    { startMs: 0, endMs: 1000, cluster: "new-b" },
    { startMs: 1000, endMs: 2000, cluster: "new-a" },
  ]);
  assert.deepEqual(
    turns.map((t) => t.speakerKey),
    ["s1", "s2"],
  );
  const assigned = assignSpeakers(
    [{ ...row, speakerOverride: true, speakerKey: "you" }],
    turns,
    [{ id: "s1", name: "Taylor", confirmed: true }],
  );
  assert.equal(assigned[0].speakerKey, "you");
});
test("notes version guards and late enhancement keep original notes and edited drafts", async () => {
  const c = new CallController({ preferences: { liveHelp: false } }),
    service = new MeetingService({
      native: {
        run: async () => ({
          enhancedNotes: "Enhanced",
          summary: [],
          actions: [],
        }),
      },
    });
  service.attach(c);
  c.meetingService = service;
  const m = service.begin({ captureMode: "notes-only", withoutSaving: true });
  service.saveNotes(m.id, { text: "My original", version: 0 });
  assert.throws(
    () => service.saveNotes(m.id, { text: "Lost", version: 0 }),
    /changed/,
  );
  assert.equal(service.current(m.id).notes.text, "My original");
  c.close();
  service.close();
});
