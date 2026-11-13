import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseHTML } from "linkedom";
import { concise, validateAdvice } from "../core/prompts.mjs";
import { cleanQuestion, classifyTurn, normalize } from "../core/triggers.mjs";
import { CoachEngine } from "../core/engine.mjs";
import { CallController } from "../core/controller.mjs";
import { MATERIAL_LIMIT } from "../core/call-sheets.mjs";
import { LiveTranscriber } from "../providers/transcription.mjs";
import { captureDrafts, restoreDrafts, setDraft } from "../ui/state.mjs";
import { revealLibrary } from "../desktop/library-location.mjs";
import {
  checkUiOwnership,
  uiOwnershipViolations,
} from "../scripts/check-ui-ownership.mjs";

test("A1: leads and cues stop at a complete sentence or a clean word boundary", () => {
  const cue =
    "I'd surface conflicts early and agree on tradeoffs before committing; then I'd keep a weekly check-in with each owner so nothing drifts.";
  assert.equal(
    concise(cue, 16),
    "I'd surface conflicts early and agree on tradeoffs before committing; then I'd keep a weekly check-in",
  );
  assert.equal(
    concise(
      "One sentence. Then a longer thought with a comma, and more words.",
      8,
    ),
    "One sentence.",
  );
  for (const mark of [";", ",", ":"])
    assert.equal(concise("An unfinished cue" + mark), "An unfinished cue");
  const [card] = validateAdvice({
    speak: true,
    kind: "say",
    lead: cue,
    points: [{ label: "Approach", text: cue }],
    sourceIds: [],
    covers: [],
  });
  for (const text of [card.lead, card.points[0].text])
    assert.doesNotMatch(text, /[;,:…]$/);
});

test("A2: question extraction removes acknowledgements and filler while retaining the raw evidence", () => {
  const raw =
    "All right, 12nd. Okay, um. Tell me about a client result that you're proud of.";
  const expected = "Tell me about a client result that you're proud of.";
  const engine = new CoachEngine({ config: { autoCoach: false } });
  try {
    const trigger = engine.triggerFor({
      id: "q",
      text: raw,
      channel: "system",
      speaker: "Them",
    });
    assert.equal(trigger.question, expected);
    assert.equal(trigger.text, raw);
    assert.equal(
      classifyTurn({ text: raw, channel: "system" }, "interview"),
      "question",
    );
    assert.equal(
      cleanQuestion(
        "That's great. Okay, so, um, what changed? What was the result?",
      ),
      "what changed? What was the result?",
    );
    assert.equal(cleanQuestion("Can you hear me? Thanks for joining."), "");
    assert.equal(
      cleanQuestion("Can you hear me? Tell us about that launch."),
      "Tell us about that launch.",
    );
  } finally {
    engine.end();
  }
});

for (const replacement of [
  "I won't send the proposal by Friday.",
  "I will not send the proposal by Friday.",
  "I'll send the proposal by Monday.",
  "I might be able to help with the proposal.",
  "I could send the proposal by Friday.",
  "I'm not sure I can send the proposal by Friday.",
])
  test("A3: a corrected promise is derived again: " + replacement, () => {
    const engine = new CoachEngine({ config: { autoCoach: false } });
    try {
      engine.start();
      engine.ingest({
        id: "promise",
        text: "I'll send the proposal by Friday.",
        channel: "mic",
      });
      assert.equal(engine.commitments.length, 1);
      engine.ingest({ id: "promise", text: replacement, channel: "mic" });
      assert.equal(
        engine.commitments.length,
        replacement.includes("Monday") ? 1 : 0,
      );
      if (engine.commitments.length) {
        assert.equal(engine.commitments[0].what, replacement);
        assert.equal(engine.commitments[0].due, "by Monday");
      }
    } finally {
      engine.end();
    }
  });

test("A3: correction invalidates coverage, cards, deduplication, queued work and in-flight work for that segment only", () => {
  const engine = new CoachEngine({ config: { autoCoach: false } });
  try {
    engine.prep = { myPoints: [{ id: "scope", text: "budget and reporting" }] };
    engine.start();
    const original = "Can you explain the budget and reporting?";
    engine.ingest({ id: "q", text: original, channel: "system" });
    engine.ingest({
      id: "other",
      text: "I'll share the brief by Friday.",
      channel: "mic",
    });
    assert.ok(engine.covered.has("scope"));
    const trigger = engine.triggerFor(engine.transcript.get("q"));
    engine.cards.push(
      { id: "old", trigger, covers: ["scope"] },
      { id: "keep" },
    );
    engine.handledTurns.add("q");
    engine.answered.set(normalize(original), 1);
    const controller = new AbortController();
    engine.inflight.fast = { controller, trigger, turnId: "q" };
    engine.autoQueue.push({ trigger, turnId: "q" });
    engine.summary = "Stale compressed summary";
    engine.ingest({
      id: "q",
      text: "Tell me about your management style.",
      channel: "system",
    });
    assert.equal(engine.covered.has("scope"), false);
    assert.deepEqual(
      engine.cards.map((c) => c.id),
      ["keep"],
    );
    assert.equal(engine.handledTurns.has("q"), false);
    assert.equal(engine.answered.has(normalize(original)), false);
    assert.equal(controller.signal.aborted, true);
    assert.equal(engine.autoQueue.length, 0);
    assert.equal(engine.summary, "");
    assert.equal(engine.commitments[0].segmentId, "other");
  } finally {
    engine.end();
  }
});

test("A3: correcting one source does not remove coverage supported by another segment", () => {
  const engine = new CoachEngine({ config: { autoCoach: false } });
  try {
    engine.prep = { myPoints: [{ id: "scope", text: "budget and reporting" }] };
    engine.start();
    for (const id of ["first", "second"])
      engine.ingest({
        id,
        text: "The budget and reporting are agreed.",
        channel: "mic",
      });
    engine.ingest({ id: "first", text: "Let's move on.", channel: "mic" });
    assert.ok(engine.covered.has("scope"));
  } finally {
    engine.end();
  }
});

test("A3: coverage attributed only to an invalidated advice card is removed", () => {
  const engine = new CoachEngine({ config: { autoCoach: false } });
  try {
    engine.prep = { myPoints: [{ id: "scope", text: "budget reporting" }] };
    engine.start();
    engine.ingest({
      id: "q",
      text: "Tell me about your work.",
      channel: "system",
    });
    engine.cards.push({
      id: "advice",
      covers: ["scope", "invalid"],
      trigger: engine.triggerFor(engine.transcript.get("q")),
    });
    engine.rebuildCoverage();
    assert.deepEqual([...engine.covered], ["scope"]);
    engine.ingest({
      id: "q",
      text: "Tell me about your strengths.",
      channel: "system",
    });
    assert.deepEqual([...engine.covered], []);
  } finally {
    engine.end();
  }
});

test("A4: drafts survive unmounting and rerenders, with explicit resets on successful submission or cancellation", () => {
  const { document } = parseHTML(
    '<main><input id="material-title" value="Client notes"><textarea id="material-text">Unsent body</textarea><input id="question" value="Unsent ask"></main>',
  );
  const root = document.querySelector("main");
  const ui = {
    drafts: { "material-title": "Notes", "material-text": "", question: "" },
  };
  captureDrafts(root, ui);
  root.innerHTML = "<p>Settings</p>";
  captureDrafts(root, ui);
  root.innerHTML =
    '<input id="material-title"><textarea id="material-text"></textarea><input id="question">';
  restoreDrafts(root, ui);
  assert.equal(root.querySelector("#material-title").value, "Client notes");
  assert.equal(root.querySelector("#material-text").value, "Unsent body");
  assert.equal(root.querySelector("#question").value, "Unsent ask");
  setDraft(root, ui, "question", "");
  captureDrafts(root, ui);
  assert.equal(ui.drafts.question, "");
});

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
async function audioController() {
  const { sockets, Socket } = fakeSockets();
  const c = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    preferences: { liveHelp: false },
    speechFactory: (options) =>
      new LiveTranscriber({ ...options, WebSocketClass: Socket }),
  });
  const starting = c.command("start", { source: "audio", consent: true });
  await new Promise(setImmediate);
  sockets.forEach((socket) => socket.ready());
  await starting;
  return { c, mic: c.transcribers.get("mic"), socket: sockets[0] };
}
function fiveSeconds(mic) {
  const audio = Buffer.alloc(4800);
  for (let i = 0; i < audio.length; i += 2) audio.writeInt16LE(3000, i);
  for (let i = 0; i < 50; i++) mic.push(audio, (i + 1) * 100);
}
function final(socket) {
  socket.message({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "tail",
    transcript: "I'll send the notes by Friday.",
  });
}
for (const committed of [false, true])
  test(
    committed
      ? "A6: End waits for an already committed final transcript"
      : "A6: five seconds of voice followed by End without silence keeps the last turn",
    async () => {
      const { c, mic, socket } = await audioController();
      try {
        fiveSeconds(mic);
        if (committed) {
          mic.commit();
          socket.message({
            type: "input_audio_buffer.committed",
            item_id: "tail",
          });
        }
        const ending = c.command("end");
        await new Promise(setImmediate);
        assert.equal(c.engine.status, "finishing");
        assert.ok(
          socket.sent.some((e) => e.type === "input_audio_buffer.commit"),
        );
        if (!committed)
          socket.message({
            type: "input_audio_buffer.committed",
            item_id: "tail",
          });
        final(socket);
        await ending;
        const rows = c.snapshot().transcript;
        assert.equal(
          rows.find((r) => !r.gap)?.text,
          "I'll send the notes by Friday.",
        );
        assert.equal(
          rows.some((r) => r.gap),
          false,
        );
        assert.equal(c.engine.commitments[0].due, "by Friday");
        assert.equal(c.engine.status, "ended");
      } finally {
        c.close();
      }
    },
  );

for (const partial of [false, true])
  test(
    "A6: drain timeout creates a visible gap" +
      (partial
        ? " and preserves the unfinished words"
        : " even without a partial"),
    async () => {
      const { c, mic, socket } = await audioController();
      try {
        fiveSeconds(mic);
        mic.commit();
        socket.message({
          type: "input_audio_buffer.committed",
          item_id: "tail",
        });
        if (partial)
          socket.message({
            type: "conversation.item.input_audio_transcription.delta",
            item_id: "tail",
            delta: "I'll send the notes",
          });
        await c.drainInputs({ timeoutMs: 30, ending: true });
        const rows = c.snapshot().transcript;
        assert.match(
          rows.find((r) => r.gap)?.text || "",
          /Final words may be missing/,
        );
        if (partial)
          assert.ok(
            rows.some((r) => r.unfinalized && r.text === "I'll send the notes"),
          );
        assert.equal(c.engine.status, "ended");
      } finally {
        c.close();
      }
    },
  );

test("A6: a speech provider failure also leaves a final-words gap", async () => {
  const c = new CallController({ preferences: { liveHelp: false } });
  try {
    c.engine.start({ source: "manual", consent: true });
    c.transcribers.set("mic", {
      finish() {
        throw new Error("speech failed");
      },
      close() {},
    });
    await c.command("end");
    assert.match(
      c.snapshot().transcript.find((r) => r.gap)?.text || "",
      /Final words may be missing/,
    );
  } finally {
    c.close();
  }
});

test("A7: recap retries update one carried recap and retain its identity", async () => {
  let version = 0;
  const c = new CallController({
    documentProvider: {
      async generate() {
        return {
          whatHappened: ["Recap version " + ++version],
          whoOwesWhat: [],
          stillOpen: [],
          email: "",
          interview: [],
        };
      },
    },
  });
  try {
    c.mode = "openai";
    c.engine.start({ source: "manual", consent: true });
    c.engine.ingest({
      id: "actual",
      text: "We discussed the launch.",
      channel: "mic",
    });
    await c.command("end");
    await new Promise(setImmediate);
    c.carryRecap(true);
    const identity = c.recapAt;
    await c.command("recap.retry");
    assert.equal(c.recapAt, identity);
    assert.equal(c.snapshot().recapCarried, true);
    const history = c.sheets.find((s) => s.id === c.sheetId).history;
    assert.equal(history.length, 1);
    assert.match(history[0].recap, /Recap version 2/);
    c.carryRecap(false);
    assert.equal(c.sheets.find((s) => s.id === c.sheetId).history.length, 0);
  } finally {
    c.close();
  }
});

test("A7: an oversized saved call including history fails before clearing the current draft", async () => {
  const c = new CallController({
    sheets: [
      {
        id: "large",
        type: "client",
        line: "Old call",
        materials: [{ id: "huge", text: "x".repeat(MATERIAL_LIMIT - 50) }],
        history: [{ at: "2026-11-12T01:00:00Z", recap: "y".repeat(100) }],
      },
    ],
  });
  try {
    c.engine.configure({ goal: "Keep this draft" });
    c.engine.context.add({ id: "draft", text: "Unsent material" });
    const sessionId = c.engine.sessionId,
      sheetId = c.sheetId;
    await assert.rejects(c.command("sheet.load", { id: "large" }), /2 MB/);
    assert.equal(c.engine.settings.goal, "Keep this draft");
    assert.equal(c.engine.context.get("draft").text, "Unsent material");
    assert.equal(c.engine.sessionId, sessionId);
    assert.equal(c.sheetId, sheetId);
  } finally {
    c.close();
  }
});

test("A7: a saved call at the material limit can still reopen and the sample remains unsaved", async () => {
  const c = new CallController({
    sheets: [
      {
        id: "fits",
        type: "client",
        line: "Existing call",
        materials: [{ id: "huge", text: "x".repeat(MATERIAL_LIMIT) }],
        history: [],
      },
    ],
  });
  try {
    await c.command("sheet.load", { id: "fits" });
    assert.equal(c.engine.context.get("huge").text.length, MATERIAL_LIMIT);
    assert.equal(c.sheetId, "fits");
    await c.command("practice");
    await c.command("end");
    assert.equal(c.sheets.length, 1);
  } finally {
    c.close();
  }
});

test("A9: library location and reveal use only the app-owned encrypted folder", async () => {
  const c = new CallController();
  try {
    c.libraryPath = "/example/Callwise/meetings";
    assert.equal(c.snapshot().libraryPath, c.libraryPath);
    assert.deepEqual(await c.command("library.path", { path: "/ignored" }), {
      path: c.libraryPath,
      encrypted: true,
    });
    let opened;
    const result = await revealLibrary(c.libraryPath, {
      openPath: async (folder) => {
        opened = folder;
        return "";
      },
    });
    assert.equal(opened, c.libraryPath);
    assert.equal(result.revealed, true);
    await assert.rejects(
      revealLibrary(c.libraryPath, { openPath: async () => "Folder missing" }),
      /Folder missing/,
    );
  } finally {
    c.close();
  }
});

test("A11: only claude/ branches may change protected UI or CSS paths", () => {
  const protectedPaths = [
    "ui/views/live.mjs",
    "ui/components/example.mjs",
    "ui/index.html",
    "ui/render.mjs",
    "styles/other.css",
  ];
  assert.deepEqual(
    uiOwnershipViolations("codex/round3", protectedPaths),
    protectedPaths,
  );
  assert.deepEqual(
    uiOwnershipViolations("claude/stage-ui", protectedPaths),
    [],
  );
  assert.deepEqual(
    uiOwnershipViolations("codex/round3", [
      "core/engine.mjs",
      "ui/app.mjs",
      "ui/state.mjs",
      "ui/meetings.mjs",
    ]),
    [],
  );
  assert.throws(() => uiOwnershipViolations("", []), /source branch/);
});

test("A11: the Git guard detects deletes and both sides of a protected rename", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "callwise-ownership-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.email", "tests@example.invalid");
    git("config", "user.name", "Test");
    mkdirSync(path.join(dir, "ui", "views"), { recursive: true });
    writeFileSync(
      path.join(dir, "ui", "views", "old.mjs"),
      "export const old = true;\n",
    );
    writeFileSync(path.join(dir, "ui", "index.html"), "<main></main>");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    renameSync(
      path.join(dir, "ui", "views", "old.mjs"),
      path.join(dir, "moved.mjs"),
    );
    rmSync(path.join(dir, "ui", "index.html"));
    git("add", "-A");
    git("commit", "-qm", "move and remove");
    assert.deepEqual(
      checkUiOwnership({ branch: "codex/check", base, cwd: dir }),
      ["ui/index.html", "ui/views/old.mjs"],
    );
    assert.deepEqual(
      checkUiOwnership({ branch: "claude/stage-ui", base, cwd: dir }),
      [],
    );
    const guard = new URL("../scripts/check-ui-ownership.mjs", import.meta.url);
    assert.throws(
      () =>
        execFileSync(process.execPath, [guard.pathname], {
          cwd: dir,
          env: {
            ...process.env,
            GITHUB_HEAD_REF: "codex/check",
            CALLWISE_OWNERSHIP_BASE: base,
          },
          stdio: "pipe",
        }),
      (error) =>
        error.status === 1 &&
        /ui\/index\.html/.test(error.stderr.toString()) &&
        /ui\/views\/old\.mjs/.test(error.stderr.toString()),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
