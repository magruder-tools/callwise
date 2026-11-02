import test from "node:test";
import assert from "node:assert/strict";
import { CallController } from "../core/controller.mjs";

const sheet = (changes = {}) => ({
  id: "noble-draft",
  line: "Noble Account Manager interview",
  type: "interview",
  project: "Noble",
  materials: [
    {
      id: "brief",
      title: "Interview brief",
      text: "Use the real client acquisition and revenue examples.",
    },
  ],
  history: [],
  updatedAt: 1,
  ...changes,
});
const preferences = {
  mode: "interview",
  goal: "Noble Account Manager interview",
  project: "Noble",
};

test("cold reopening restores the selected draft and materials without starting capture or creating a duplicate", () => {
  const c = new CallController({
    preferences: { ...preferences, activeSheetId: "noble-draft" },
    sheets: [sheet()],
  });
  try {
    assert.equal(c.sheetId, "noble-draft");
    assert.equal(c.sheets.length, 1);
    assert.equal(c.engine.context.get("brief").text, sheet().materials[0].text);
    assert.equal(c.engine.context.list()[0].project, "Noble");
    assert.equal(c.engine.status, "idle");
    assert.deepEqual(c.capture, { mic: "off", system: "off" });
    assert.equal(c.transcribers.size, 0);
  } finally {
    c.close();
  }
});

test("saved notes and draft selection survive a controller round trip", async () => {
  let savedPreferences = {},
    sheets = [];
  const first = new CallController({
    onPreferences: (p) => {
      savedPreferences = structuredClone(p);
    },
    onSheets: (s) => {
      sheets = structuredClone(s);
    },
  });
  let restored;
  try {
    await first.command("configure", preferences);
    await first.command("context.add", {
      title: "Noble brief",
      text: "Keep client leadership and the actual business results first.",
    });
    const id = first.sheetId;
    first.close();
    restored = new CallController({ preferences: savedPreferences, sheets });
    assert.equal(restored.sheetId, id);
    assert.equal(restored.sheets.length, 1);
    assert.equal(restored.engine.context.list()[0].title, "Noble brief");
    assert.equal(savedPreferences.activeSheetId, id);
  } finally {
    first.close();
    restored?.close();
  }
});

test("legacy drafts restore only the latest matching goal, call type and project", () => {
  const c = new CallController({
    preferences,
    sheets: [
      sheet(),
      sheet({
        id: "newer",
        updatedAt: 2,
        materials: [{ id: "updated", text: "The revised brief." }],
      }),
      sheet({ id: "other", updatedAt: 3, project: "Another client" }),
    ],
  });
  try {
    assert.equal(c.sheetId, "newer");
    assert.equal(c.engine.context.get("updated").text, "The revised brief.");
  } finally {
    c.close();
  }
});

for (const [name, patch] of [
  ["unknown draft", { activeSheetId: "missing" }],
  ["different project", { project: "Other", activeSheetId: "noble-draft" }],
  [
    "different goal",
    { goal: "Different interview", activeSheetId: "noble-draft" },
  ],
  ["different type", { mode: "sales", activeSheetId: "noble-draft" }],
])
  test(`startup does not reuse materials from ${name}`, () => {
    const c = new CallController({
      preferences: { ...preferences, ...patch },
      sheets: [sheet()],
    });
    try {
      assert.equal(c.engine.context.list().length, 0);
    } finally {
      c.close();
    }
  });

test("reopening does not restore old connected-app evidence or real materials into Practice", () => {
  const saved = sheet({
    materials: [
      ...sheet().materials,
      {
        id: "old-source",
        text: "Old connected source.",
        provenance: { provider: "codex", appId: "drive", action: "search" },
      },
    ],
  });
  const c = new CallController({ preferences, sheets: [saved] });
  const demo = new CallController({
    preferences,
    sheets: [saved],
    demoOnly: true,
  });
  try {
    assert.equal(c.engine.context.list().length, 1);
    assert.equal(demo.engine.context.list().length, 0);
  } finally {
    c.close();
    demo.close();
  }
});

test("an explicit new call preserves an empty draft on reopening rather than restoring old materials", async () => {
  let savedPreferences;
  const c = new CallController({
    preferences,
    sheets: [sheet()],
    onPreferences: (p) => {
      savedPreferences = structuredClone(p);
    },
  });
  let restored;
  try {
    await c.command("new", { clearContext: true });
    restored = new CallController({
      preferences: savedPreferences,
      sheets: c.sheets,
    });
    assert.equal(restored.engine.context.list().length, 0);
  } finally {
    c.close();
    restored?.close();
  }
});
