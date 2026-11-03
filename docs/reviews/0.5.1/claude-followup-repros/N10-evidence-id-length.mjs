// New in 0.5.1 (risk to verify on device): run-scoped IDs (`system:e1:12:run:<uuid>`) went verbatim to the on-device
// model as evidence IDs, and validateDocument() keeps only bullets/actions whose IDs are echoed exactly.
// This measures what one hour-long meeting's recap sends to the local model (a stub answers instantly).
// 0.5.2 sends short aliases (s1, s2, ...) instead and maps them back.
import { randomUUID } from "node:crypto";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { LocalDocuments } = await import(`${R}/core/meetings/recaps.mjs`);
const run = randomUUID();
const rows = Array.from({ length: 700 }, (_, i) => ({ id: `system:e1:${i}:run:${run}`, final: true, speaker: "Them", text: "Words from an hour-long meeting, about a dozen of them per final row here." }));
let calls = 0, bytes = 0, chunks = 0, firstId;
const docs = new LocalDocuments({ run: async (mode, { prompt }) => {
  const p = JSON.parse(prompt);
  calls++; bytes += Buffer.byteLength(prompt);
  if (p.evidence) { chunks++; firstId ??= p.evidence[0].id; }
  return { summary: [], decisions: [], openQuestions: [], actions: [] };
} });
await docs.generate(rows, { task: "recap" });
console.log(`700 rows: ${chunks} evidence chunks, ${calls} local-model calls, ${bytes} prompt bytes; first evidence ID the model sees: ${firstId}`);
