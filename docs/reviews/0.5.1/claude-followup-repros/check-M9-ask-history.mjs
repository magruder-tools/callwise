// 0.5.1 re-check of M9 through the production path (meeting.ask -> search worker -> LocalDocuments), replacing r6 §5,
// which called LocalDocuments directly with every row.
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const { MeetingSearch } = await import(`${R}/desktop/meeting-search.mjs`);
const dir = mkdtempSync(path.join(os.tmpdir(), "cw-ask-"));
const store = new MeetingStore(dir, { key: randomBytes(32) });
store.transaction(() => {
  for (let m = 0; m < 5; m++) {
    const id = randomUUID();
    store.put("meetings", id, id, { title: `Weekly sync ${m}`, people: ["Dana"], status: "ended", createdAt: m, durationMs: 3600000 });
    for (let i = 0; i < 700; i++)
      store.put("segments", id, `system:e1:${i}:run:r`, { text: i === 350 ? "We agreed the pricing change ships in March." : `Ordinary discussion line ${i} about the roadmap.`, speaker: "Them", channel: "system", final: true, startMs: i * 5000, endMs: i * 5000 + 4000 });
  }
});
let calls = 0, rowsSent = 0, signalSeen = false;
const native = { run: async (mode, args, options) => {
  calls++; signalSeen ||= !!options?.signal;
  const evidence = JSON.parse(args.prompt).evidence || [];
  rowsSent += evidence.length;
  const cited = evidence.find((e) => /pricing/.test(e.text))?.id; // a well-behaved model cites the matching row
  return { summary: [], decisions: [], openQuestions: [], actions: [], answer: "In March.", answerSegmentIds: cited ? [cited] : [] };
} };
const svc = new MeetingService({ store, native, search: new MeetingSearch(store) });
const t = Date.now();
const answer = await svc.command("meeting.ask", { question: "When does the pricing change ship?" });
console.log(`5 meetings x 700 rows: ${calls} local-model call(s), ${rowsSent} evidence rows sent, cancel signal passed: ${signalSeen}, ${Date.now() - t} ms, answer: ${JSON.stringify(answer.answer)}`);
svc.search.close(); svc.close(); store.close(); rmSync(dir, { recursive: true, force: true });
