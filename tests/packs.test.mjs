import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { validatePack, PackBank, PACK_NAMESPACE } from "../core/packs.mjs";
import { MeetingStore } from "../core/meetings/store.mjs";
import { guardCard, validSay } from "../core/cards.mjs";
import { materialChunks, buildPack, prepEstimate } from "../core/pack-preparation.mjs";
const example = () => JSON.parse(readFileSync(new URL("../fixtures/pack/appendix-b.json", import.meta.url)));

test("Appendix B validates against the shipped schema; imports cannot self-approve", async () => {
  const p = example(); p.cards[0].status = "approved";
  const schema = JSON.parse(readFileSync(new URL("../core/pack.schema.json", import.meta.url)));
  const validate = new Ajv({ strict: false }).compile(schema);
  assert.equal(validate(p), true, JSON.stringify(validate.errors));
  const b = new PackBank(); b.import(p); await b.command("bank.open", { packId: p.id });
  assert.equal(b.snapshot().cards[0].status, "needs_review");
  assert.equal(b.list()[0].approved, 0);
});
test("packs use authenticated encrypted library rows and survive backup/restore", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cw-pack-test-"));
  const store = new MeetingStore(path.join(dir, "a"), { key: Buffer.alloc(32, 7), keyId: "test-key" });
  let restored;
  try {
    const b = new PackBank({ store }); b.import(example()); store.checkpoint();
    assert.equal(readFileSync(store.file).includes(Buffer.from("Ojo client acquisition")), false);
    const backup = store.backup("synthetic-backup-passphrase");
    restored = new MeetingStore(path.join(dir, "b"), { key: Buffer.alloc(32, 8), keyId: "other-key" });
    restored.restore(backup, "synthetic-backup-passphrase");
    assert.equal(new PackBank({ store: restored }).list()[0].cards, 1);
    assert.equal(store.get("docs", PACK_NAMESPACE, example().id).pack.meeting.title, example().meeting.title);
  } finally { store.close(); restored?.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("a same-ID update preserves approved answers until the revision is approved", async () => {
  const b = new PackBank(), p = example(); b.import(p);
  await b.command("bank.approveAll", { packId: p.id });
  const old = b.usable()[0].pack.cards[0].say;
  p.cards[0].say = "I led a careful review of our client acquisition results."; b.import(p);
  assert.equal(b.usable()[0].pack.cards[0].say, old);
  assert.equal(b.list()[0].status, "needs_review"); assert.equal(b.list()[0].updatePending, true);
  await b.command("bank.approveAll", { packId: p.id });
  assert.equal(b.usable()[0].pack.cards[0].say, p.cards[0].say);
  b.import(p); assert.equal(b.list()[0].status, "approved", "identical assistant save is idempotent");
});
test("gap answers keep user provenance and rebuild only affected cards for review", async () => {
  const b = new PackBank(), p = example(); b.import(p); await b.command("bank.approveAll", { packId: p.id });
  let calls = 0;
  await b.command("bank.gap.answer", { packId: p.id, gapId: "g1", answer: "I chose the acquisition channels." }, { rebuild: async ({ story, answer }) => {
    calls++; assert.equal(story.sources.at(-1).quote, answer); assert.equal(b.rebuilding.size, 1);
    return { say: "I chose the acquisition channels that supported Ojo's growth.", cues: [{ icon: "decision", text: "Acquisition channels" }] };
  } });
  assert.equal(calls, 1); const r = b.record(p.id);
  assert.equal(r.answers.g1.provenance, "user"); assert.equal(r.pack.cards[0].status, "needs_review");
  assert.equal(b.usable()[0].pack.cards[0].status, "approved", "old approved copy remains available");
  assert.equal(b.rebuilding.size, 0);
});
test("pack validation rejects versions, oversized inputs, broken references and unsafe image paths", () => {
  for (const mutate of [p => p.callwisePack = 2, p => p.cards[0].storyId = "missing", p => p.tiles[0].file = "https://example.com/x.svg", p => p.tiles[0].file = "tiles/../../x.svg", p => p.extra = true, p => p.cards = Array(201).fill(p.cards[0])]) {
    const p = example(); mutate(p); assert.throws(() => validatePack(p), /Invalid prep pack/);
  }
  assert.throws(() => validatePack(" ".repeat(2 * 1024 * 1024 + 1)), /2 MB/);
});
test("Appendix C guard removes self notes, unfinished cues and hedged sentences", () => {
  const cards = [
    { lead: "I'm proud of the Sessions Retreat rebrand I led; revenue grew 2.3 times in one year.", points: [{ text: "My role — I led the rebrand; I don't want to overstate what drove the result." }, { text: "Recall — Add one specific decision you made and how the team measured revenue growth." }] },
    { lead: "One result I'm proud of is Ojo's client acquisition growing 4.8 times over two years, though I'd want to be precise about my role.", points: [{ text: "My part — I don't want to overstate it; I need to recall the specific decisions I owned." }, { text: "Context — I'd explain the baseline, how acquisition was measured, and who else contributed." }] },
    { lead: "I manage several clients by getting clear on priorities, owners and what each client needs next.", points: [{ text: "Scope — At CNV, I handled 10-plus concurrent accounts and coordinated a bench of about 20 specialists." }, { text: "Approach — I'd surface conflicts early and agree on tradeoffs before committing;" }] },
  ];
  const gaps = []; const output = cards.map(c => guardCard(c, { question: "Tell me about a result.", onGap: x => gaps.push(x) }));
  assert.equal(output[0].say, cards[0].lead); assert.equal(output[1].say, ""); assert.deepEqual(output[1].frame, ["Situation", "Your move", "Result"]);
  assert.equal(output[2].say, cards[2].lead); assert.equal(gaps.length, 6); assert.ok(output.every(c => c.cues.length === 0));
  assert.equal(validSay("I should check my notes;"), false);
});
test("full-material prep reads every character once and validates exact source spans", async () => {
  const material = { id: "long", title: "All pages", text: "A".repeat(16500) + "Final page: I increased signups." };
  const chunks = materialChunks([material]); assert.equal(chunks.map(c => c.text).join(""), material.text);
  let seen = 0, usage = 0;
  const pack = await buildPack({ materials: [material], meeting: example().meeting, onUsage: () => usage++,
    provider: { generate: async ({ lane, prompt }) => {
      const input = JSON.parse(prompt.input);
      if (lane === "fast") { seen += input.text.length; return { stories: [{ id: "story", title: "Signups", result: "I increased signups.", numbers: [], sources: [{ materialId: input.materialId, start: -1, end: -1, quote: input.text }] }], facts: [], gaps: [], glossary: [] }; }
      assert.equal(input.stories.length, chunks.length);
      return { points: [], questionsForThem: [], gaps: [], cards: [{ id: "c", kind: "story", storyId: "s2-2", backupStoryId: null,
        questions: ["Tell me about signups.", "What grew?", "Which result?", "What did you change?", "How did signups grow?", "Share a growth example."], say: "I increased signups through a focused acquisition plan.", cues: [] }] };
    } } });
  assert.equal(seen, material.text.length); assert.equal(usage, chunks.length + 1);
  assert.ok(pack.stories.at(-1).sources[0].quote.includes("Final page")); assert.equal(pack.cards[0].status, "needs_review");
  assert.ok(prepEstimate([material]).cost > 0);
});
