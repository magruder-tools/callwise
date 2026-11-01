import test from "node:test";
import assert from "node:assert/strict";
import { soundCheckPassed, SoundCheckTranscript } from "../core/sound-check.mjs";
import { CallController } from "../core/controller.mjs";
import { settings } from "../ui/views/settings.mjs";
import { welcome } from "../ui/views/welcome.mjs";

test("sound check accepts the actual transcriber's phonetic brand spelling", () => {
  for (const brand of ["Callwise", "Call wise", "Calwise"])
    assert.equal(soundCheckPassed(0.02, `${brand} is ready for my call.`), true);
});

test("sound check still requires signal, brand, and the expected phrase", () => {
  for (const level of [0, 0.004, NaN, Infinity])
    assert.equal(soundCheckPassed(level, "Calwise is ready for my call."), false);
  for (const text of ["", "I am ready for my call.", "Calwise hears some music."])
    assert.equal(soundCheckPassed(0.02, text), false);
});

test("sound checks retain a phrase across segments and replace partial revisions", () => {
  const transcript = new SoundCheckTranscript();
  transcript.update({ id: "first", text: "Cal" });
  transcript.update({ id: "first", text: "Calwise is" });
  transcript.update({ id: "second", text: "ready for my call." });
  assert.equal(transcript.text(), "Calwise is ready for my call.");
  assert.equal(soundCheckPassed(0.02, transcript.text()), true);
  transcript.update({ id: "second", text: "ready for my call!" });
  assert.equal(transcript.text(), "Calwise is ready for my call!");
});

test("sound-check transcripts remain bounded and ignore malformed rows", () => {
  const transcript = new SoundCheckTranscript();
  for (let i = 0; i < 40; i++)
    transcript.update({ id: String(i), text: "x".repeat(5000) });
  assert.equal(transcript.segments.size, 16);
  assert.equal(transcript.text().length, 4000);
  const previous = transcript.text();
  assert.equal(transcript.update({ id: "invalid" }), previous);
});

test("active sound checks expose a finish control in settings and setup", () => {
  const controller = new CallController({ demoOnly: true });
  try {
    const state = controller.snapshot();
    for (const view of [settings, welcome]) {
      const ui = { tab: "Audio", welcomeStep: 1, devices: [], testResults: [] };
      assert.doesNotMatch(view(state, ui), /data-action="sound-stop"/);
      assert.match(view(state, { ...ui, testChannel: "mic" }), /data-action="sound-stop"/);
    }
  } finally {
    controller.close();
  }
});
