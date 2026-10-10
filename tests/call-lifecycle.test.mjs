import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CallController } from "../core/controller.mjs";
import {
  saveSheets,
  readSheets,
  sanitizeSheets,
} from "../core/call-sheets.mjs";
import {
  validatePrep,
  localPrep,
  validateRecap,
} from "../core/preparation.mjs";
import { estimateCost } from "../core/cost.mjs";
import {
  newerVersion,
  releaseLink,
  checkForUpdate,
} from "../desktop/updates.mjs";
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s).map((x) => x ^ 71),
  decryptString: (b) =>
    Buffer.from(b)
      .map((x) => x ^ 71)
      .toString(),
};
const sheet = {
  id: "call",
  name: "Interview",
  type: "interview",
  line: "Use real experience",
  materials: [{ id: "resume", title: "Résumé", text: "A real example." }],
  history: [],
  transcript: "PRIVATE_TRANSCRIPT",
  cards: ["PRIVATE_CARD"],
};
test("saved calls are encrypted, atomic, bounded, and omit transcripts and suggestions", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "callwise-sheets-"));
  try {
    const file = path.join(dir, "calls.bin");
    saveSheets(file, storage, [sheet]);
    assert.doesNotMatch(readFileSync(file).toString(), /PRIVATE|real example/);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const loaded = readSheets(file, storage);
    assert.equal(loaded[0].materials[0].text, "A real example.");
    assert.equal(loaded[0].transcript, undefined);
    assert.equal(loaded[0].cards, undefined);
    assert.throws(
      () =>
        sanitizeSheets([
          {
            ...sheet,
            materials: [{ id: "large", text: "x".repeat(2 * 1024 * 1024 + 1) }],
          },
        ]),
      /2 MB/,
    );
    writeFileSync(file, "damaged");
    assert.throws(() => saveSheets(file, storage, [sheet]), /preserved/);
    assert.equal(readFileSync(file).toString(), "damaged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("sample calls never reach saved recent calls; ending a real call creates a recap without a click", async () => {
  const saved = [];
  const provider = {
    async generate({ schema }) {
      if (schema.properties.whatHappened)
        return {
          whatHappened: ["Discussed a real project."],
          whoOwesWhat: [
            {
              owner: "You",
              what: "Send the notes",
              due: "by Friday",
              segmentIds: ["promise"],
            },
          ],
          stillOpen: ["Budget still open."],
          email: "Thanks for talking. I will send the notes.",
          interview: [],
        };
      return {
        people: [],
        facts: [],
        likelyQuestions: [],
        myPoints: [],
        watchFor: [],
        glossary: [],
      };
    },
  };
  const c = new CallController({
    config: {
      openaiKey: "TEST_ONLY",
      fastModel: "test",
      strategyModel: "test",
    },
    documentProvider: provider,
    onSheets: (s) => saved.push(s),
  });
  try {
    await c.command("start", { source: "demo" });
    await c.command("end");
    assert.equal(saved.length, 0);
    await c.command("new", { clearContext: true });
    await c.command("configure", { goal: "A useful call", mode: "client" });
    await c.command("context.add", {
      title: "Notes",
      text: "Approved budget is $10000.",
    });
    await c.command("start", { source: "manual", consent: true });
    c.engine.settings.quiet = true;
    await c.command("transcript", {
      id: "promise",
      speaker: "You",
      text: "I'll send the notes by Friday.",
    });
    await c.command("end");
    await new Promise((r) => setImmediate(r));
    assert.equal(c.recapping, false);
    assert.equal(c.recap.whoOwesWhat[0].owner, "You");
    assert.equal(c.recap.whoOwesWhat[0].due, "by Friday");
    assert.equal(c.sheets[0].history.length, 0);
    await c.command("recap.carry", { enabled: true });
    assert.equal(c.sheets[0].history.length, 1);
    const id = c.sheets[0].id;
    await c.command("sheet.load", { id });
    assert.equal(c.engine.transcript.size, 0);
    assert.ok(c.engine.context.list().some((d) => d.kind === "recap"));
    await c.command("prep.refresh");
    assert.ok(c.engine.prep);
    assert.equal(c.sheets[0].materials.length, 1);
  } finally {
    c.close();
  }
});
test("every prep fallback fact in all three fixtures has an exact source; invented source IDs are removed", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const name of ["interview", "discovery", "client"]) {
    const f = JSON.parse(
      await readFile(
        new URL(`../fixtures/replay/${name}.json`, import.meta.url),
      ),
    );
    const prep = localPrep(f.materials, f.line);
    assert.ok(
      prep.facts.every((fact) =>
        fact.sourceIds.every((id) =>
          f.materials.some((m) => m.id === id && m.text.includes(fact.text)),
        ),
      ),
    );
    const checked = validatePrep(
      {
        ...prep,
        facts: [...prep.facts, { text: "Made up", sourceIds: ["invented"] }],
      },
      f.materials,
    );
    assert.equal(checked.facts.length, prep.facts.length);
  }
});
test("recap uses model summaries only with final transcript evidence, and retains the source words", () => {
  const rows = [
      {
        id: "p",
        speaker: "You",
        text: "I'll send the notes by Friday.",
        final: true,
      },
    ],
    commitments = [
      { owner: "You", what: rows[0].text, due: "by Friday", segmentId: "p" },
    ];
  const result = validateRecap(
    {
      whatHappened: ["Notes"],
      whoOwesWhat: [
        {
          owner: "You",
          what: "Send the notes",
          due: "by Friday",
          segmentIds: ["p"],
        },
      ],
      stillOpen: [],
      email: "",
      interview: [],
    },
    rows,
    commitments,
  );
  assert.equal(result.whoOwesWhat[0].owner, "You");
  assert.equal(result.whoOwesWhat[0].what, "Send the notes");
  assert.equal(result.whoOwesWhat[0].evidence[0].text, rows[0].text);
  assert.equal(result.whoOwesWhat[0].due, "by Friday");
});
test("preparation and rolling memory discard late completions after call state changes", async () => {
  let finish;
  const c = new CallController({
    documentProvider: { generate: () => new Promise((r) => (finish = r)) },
  });
  try {
    await c.command("context.add", { title: "Notes", text: "Real material" });
    const task = c.command("prep.refresh");
    await c.command("new", { clearContext: true });
    finish({
      people: [],
      facts: [],
      likelyQuestions: [],
      myPoints: [],
      watchFor: [],
      glossary: [],
    });
    await task;
    assert.equal(c.engine.prep, null);
  } finally {
    c.close();
  }
});
test("editable cost estimate counts both channel audio and lane token usage", () => {
  assert.equal(
    estimateCost(
      {
        fastInput: 1e6,
        fastOutput: 1e6,
        deepInput: 1e6,
        deepOutput: 1e6,
        audioMs: 60000,
      },
      {
        fastInput: 1,
        fastOutput: 2,
        deepInput: 3,
        deepOutput: 4,
        audioMinute: 0.1,
      },
    ),
    10.1,
  );
  assert.throws(() => estimateCost({}, { audioMinute: -1 }), /valid/);
});
test("update checks accept only newer stable versions and the repository's HTTPS releases", async () => {
  assert.equal(newerVersion("0.3.1", "v0.4.0"), true);
  assert.equal(newerVersion("0.4.0", "v0.4.0"), false);
  assert.equal(newerVersion("0.4.0", "v0.5.0-beta"), false);
  assert.equal(
    releaseLink(
      "https://github.com.evil.example/magruder-tools/callwise/releases/v2",
    ),
    "",
  );
  assert.equal(releaseLink("https://github.com/other/repo/releases/v2"), "");
  const update = await checkForUpdate("0.3.1", {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          tag_name: "v0.4.0",
          html_url:
            "https://github.com/magruder-tools/callwise/releases/tag/v0.4.0",
        }),
      ),
  });
  assert.equal(update.version, "v0.4.0");
});

test("rolling memory updates from new transcript and ignores completion after pause", async () => {
  let resolve,
    calls = 0;
  const c = new CallController({
    documentProvider: {
      generate: () => {
        calls++;
        return new Promise((r) => (resolve = r));
      },
    },
  });
  try {
    c.mode = "manual";
    c.engine.settings.quiet = true;
    c.engine.start({ source: "manual", consent: true });
    c.engine.activeMs = 180001;
    c.engine.ingest({
      id: "first",
      speaker: "Other",
      text: "We agreed a real next step.",
      final: true,
    });
    assert.equal(calls, 1);
    resolve({ summary: "A real next step was agreed." });
    await new Promise((r) => setImmediate(r));
    assert.equal(c.engine.summary, "A real next step was agreed.");
    c.engine.activeMs = 360002;
    c.engine.ingest({
      id: "second",
      speaker: "Other",
      text: "The budget is still open.",
      final: true,
    });
    assert.equal(calls, 2);
    await c.command("pause");
    resolve({ summary: "LATE_MEMORY" });
    await new Promise((r) => setImmediate(r));
    assert.doesNotMatch(c.engine.summary, /LATE_MEMORY/);
  } finally {
    c.close();
  }
});

test("closing the controller twice is idempotent and emits no state against destroyed windows", () => {
  const c = new CallController();
  let states = 0;
  c.on("state", () => states++);
  c.close();
  const first = states;
  c.close();
  assert.equal(states, first);
});
