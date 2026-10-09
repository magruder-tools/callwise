import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { LiveTranscriber } from "../providers/transcription.mjs";
import { CallController } from "../core/controller.mjs";
import { makePrompt } from "../core/prompts.mjs";

function fakeSockets() {
  const sockets = [];
  class Socket extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(raw) {
      this.sent.push(JSON.parse(raw));
    }
    ready() {
      this.readyState = 1;
      this.emit("open");
      this.message({ type: "session.updated" });
    }
    message(event) {
      this.emit("message", JSON.stringify(event));
    }
    drop() {
      this.readyState = 3;
      this.emit("close", 1006);
    }
    ping() {
      this.emit("pong");
    }
    close() {
      this.readyState = 3;
    }
    terminate() {
      this.close();
    }
  }
  return { sockets, Socket };
}
function voice(ms = 100) {
  const data = Buffer.alloc(ms * 48);
  for (let i = 0; i < data.length; i += 2) data.writeInt16LE(3000, i);
  return data;
}
const manualOptions = {
  goal: "Test",
  mode: "general",
  profile: "",
  sources: [],
  question: "",
  previousCards: [],
  lane: "fast",
};

test("a close mid-utterance reconnects each channel independently, replays audio, and keeps the controller running", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const { sockets, Socket } = fakeSockets();
  const controller = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    transcriberFactory: (options) =>
      new LiveTranscriber({ ...options, WebSocketClass: Socket }),
  });
  try {
    const start = controller.command("start", {
      source: "audio",
      consent: true,
    });
    await new Promise(setImmediate);
    assert.equal(sockets.length, 2, "both channels connect in parallel");
    sockets.forEach((socket) => socket.ready());
    const state = await start;
    assert.equal(state.connecting, false);
    const mic = controller.transcribers.get("mic");
    const system = controller.transcribers.get("system");
    mic.push(voice(), 100);
    sockets[0].message({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "before",
      delta: "Partial",
    });
    sockets[0].drop();
    assert.equal(controller.engine.status, "running");
    assert.equal(controller.snapshot().capture.mic, "reconnecting");
    assert.equal(
      controller.engine.transcript.size,
      0,
      "abandoned partials are removed before replay",
    );
    assert.equal(system.ready, true);
    mic.push(voice(), 200);
    t.mock.timers.tick(500);
    sockets[2].ready();
    const replayed = sockets[2].sent.filter(
      (event) => event.type === "input_audio_buffer.append",
    );
    assert.equal(
      replayed.reduce(
        (bytes, event) => bytes + Buffer.from(event.audio, "base64").length,
        0,
      ),
      9600,
    );
    assert.ok(
      sockets[2].sent.some(
        (event) => event.type === "input_audio_buffer.commit",
      ),
    );
    sockets[2].message({
      type: "input_audio_buffer.committed",
      item_id: "after",
    });
    sockets[2].message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "after",
      transcript: "A complete recovered sentence.",
    });
    assert.equal(
      controller.snapshot().transcript[0].text,
      "A complete recovered sentence.",
    );
    assert.equal(controller.snapshot().transcript[0].startMs, 0);
    assert.equal(mic.retainedBytes, 0, "finalized PCM is released");
    assert.equal(controller.snapshot().capture.mic, "connected");
    assert.equal(controller.engine.status, "running");
  } finally {
    controller.close();
  }
});

test("a gap beyond the 15-second memory cap is visibly marked and supplied to the model", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const { sockets, Socket } = fakeSockets(),
    rows = [];
  const transcriber = new LiveTranscriber({
    apiKey: "TEST_ONLY",
    channel: "system",
    WebSocketClass: Socket,
    onSegment: (row) => rows.push(row),
  });
  try {
    const start = transcriber.connect();
    sockets[0].ready();
    await start;
    sockets[0].drop();
    for (let i = 0; i < 350; i++) transcriber.push(voice(), (i + 1) * 100);
    assert.equal(transcriber.retainedBytes, 15000 * 48);
    t.mock.timers.tick(500);
    sockets[1].ready();
    const gap = rows.find((row) => row.gap);
    assert.match(gap.text, /about 20 seconds missed/);
    const prompt = makePrompt({
      ...manualOptions,
      transcript: [
        gap,
        { text: "The call continued.", speaker: "Other", startMs: 35000 },
      ],
    });
    assert.equal(JSON.parse(prompt.input).transcriptGaps.length, 1);
    assert.match(prompt.instructions, /Do not assume continuity/);
    assert.equal(
      sockets[1].sent
        .filter((event) => event.type === "input_audio_buffer.append")
        .reduce((n, event) => n + Buffer.from(event.audio, "base64").length, 0),
      15000 * 48,
    );
  } finally {
    transcriber.close();
  }
});

test("nonfatal Realtime errors are logged without stopping capture; auth and quota failures stop only that channel", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const { sockets, Socket } = fakeSockets(),
    status = [],
    events = [];
  const transcriber = new LiveTranscriber({
    apiKey: "TEST_ONLY",
    channel: "mic",
    WebSocketClass: Socket,
    onStatus: (state, error) => status.push({ state, error }),
    diagnostics: (event, fields) => events.push({ event, fields }),
  });
  const start = transcriber.connect();
  sockets[0].ready();
  await start;
  sockets[0].message({
    type: "error",
    error: {
      code: "input_audio_buffer_commit_empty",
      message: "PRIVATE TRANSCRIPT",
    },
  });
  assert.equal(transcriber.ready, true);
  assert.equal(status.at(-1).state, "connected");
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE/);
  sockets[0].message({
    type: "error",
    error: {
      code: "insufficient_quota",
      type: "insufficient_quota",
      status: 429,
    },
  });
  assert.equal(status.at(-1).state, "failed");
  assert.match(status.at(-1).error.message, /out of credit/);
  assert.equal(transcriber.stopped, true);
  t.mock.timers.tick(60000);
  assert.equal(sockets.length, 1, "fatal errors are not retried");
});

test("retries back off from 0.5 seconds to 8 seconds and end once within the 60-second window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const { sockets, Socket } = fakeSockets(),
    status = [],
    attempts = [];
  const transcriber = new LiveTranscriber({
    apiKey: "TEST_ONLY",
    channel: "system",
    WebSocketClass: Socket,
    onStatus: (state, error) => status.push({ state, error }),
    diagnostics: (event, fields) => {
      if (event.endsWith("reconnect")) attempts.push(fields.delayMs);
    },
  });
  const start = transcriber.connect();
  sockets[0].ready();
  await start;
  sockets[0].drop();
  for (const delay of [500, 1000, 2000, 4000, 8000, 8000]) {
    t.mock.timers.tick(delay);
    sockets.at(-1).drop();
  }
  assert.deepEqual(attempts.slice(0, 6), [500, 1000, 2000, 4000, 8000, 8000]);
  t.mock.timers.tick(60000);
  assert.equal(status.filter((entry) => entry.state === "failed").length, 1);
  assert.match(status.at(-1).error.message, /within a minute/);
  assert.equal(transcriber.stopped, true);
  const count = sockets.length;
  t.mock.timers.tick(60000);
  assert.equal(sockets.length, count);
});

test("pause cancels pending recovery, clears PCM, and rejects late socket events", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const { sockets, Socket } = fakeSockets(),
    rows = [];
  const transcriber = new LiveTranscriber({
    apiKey: "TEST_ONLY",
    channel: "mic",
    WebSocketClass: Socket,
    onSegment: (row) => rows.push(row),
  });
  const start = transcriber.connect();
  sockets[0].ready();
  await start;
  transcriber.push(voice(), 100);
  sockets[0].drop();
  transcriber.push(voice(), 200);
  transcriber.close();
  t.mock.timers.tick(60000);
  sockets[0].message({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "late",
    transcript: "Late",
  });
  assert.equal(sockets.length, 1);
  assert.equal(transcriber.retainedBytes, 0);
  assert.equal(rows.length, 0);
});

test("a stalled transcript segment initiates recovery even when the socket still answers pings", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const { sockets, Socket } = fakeSockets(),
    status = [];
  const transcriber = new LiveTranscriber({
    apiKey: "TEST_ONLY",
    channel: "mic",
    WebSocketClass: Socket,
    heartbeatMs: 1000,
    finalTimeoutMs: 2000,
    onStatus: (state) => status.push(state),
  });
  try {
    const start = transcriber.connect();
    sockets[0].ready();
    await start;
    sockets[0].message({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "stalled",
      delta: "Hello",
    });
    t.mock.timers.tick(1000);
    t.mock.timers.tick(1000);
    t.mock.timers.tick(1000);
    assert.equal(status.at(-1), "reconnecting");
    t.mock.timers.tick(500);
    assert.equal(sockets.length, 2);
  } finally {
    transcriber.close();
  }
});
