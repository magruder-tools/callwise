import test from "node:test";
import assert from "node:assert/strict";
import { AudioCapture } from "../ui/capture.mjs";
const record = (label) => ({
  stream: {
    getAudioTracks: () => [{ readyState: "ended", label }],
    getTracks: () => [],
  },
  ctx: { close: async () => {} },
  nodes: [],
});
test("a removed saved microphone falls back to default and leaves call audio running", async () => {
  const notices = [],
    errors = [],
    statuses = [],
    capture = new AudioCapture(
      { captureStatus: (...args) => statuses.push(args) },
      () => {},
      (...args) => errors.push(args),
      (s) => notices.push(s),
    );
  capture.active = true;
  capture.generation = 7;
  capture.channels.set("mic", record("Missing"));
  capture.channels.set("system", record("Call audio"));
  const calls = [];
  capture.acquire = async (channel, generation, fallback = false) => {
    calls.push({ channel, generation, fallback });
    if (!fallback) throw new Error("Device unavailable");
    capture.channels.set("mic", record("Default microphone"));
  };
  await capture.recover("mic");
  assert.deepEqual(
    calls.map((c) => c.fallback),
    [false, true],
  );
  assert.equal(capture.active, true);
  assert.equal(capture.channels.has("system"), true);
  assert.equal(errors.length, 0);
  assert.match(notices[0], /Default microphone/);
});
test("failed system reacquisition reports only that channel and retains the microphone", async () => {
  const errors = [],
    capture = new AudioCapture(
      { captureStatus() {} },
      () => {},
      (...args) => errors.push(args),
    );
  capture.active = true;
  capture.generation = 1;
  capture.channels.set("mic", record("Mic"));
  capture.channels.set("system", record("Call"));
  capture.acquire = async () => {
    throw new Error("Call audio permission needs attention");
  };
  await capture.recover("system");
  assert.equal(capture.active, true);
  assert.equal(capture.channels.has("mic"), true);
  assert.equal(capture.channels.has("system"), false);
  assert.equal(errors[0][1], "system");
});
