// H4: with live help on and an OpenAI key saved, the whole conversation is sent to OpenAI:
// (a) during the call, maybeSummarize() posts every final turn in 3-minute batches;
// (b) after Pause -> End (or a typed/Fireflies meeting, or a sleep/lock auto-pause then End), the legacy
//     controller recap posts the full transcript again. The notice says only "relevant conversation excerpts".
const R = process.env.CALLWISE_ROOT || process.cwd();
const requests = [];
// Stub network. Returns HTTP 500, so the provider retries once; a real 200 response sends one request per call.
globalThis.fetch = async (url, init) => { requests.push({ url: String(url), body: String(init?.body || "") }); return new Response(JSON.stringify({ error: { message: "stub" } }), { status: 500 }); };
const { CallController } = await import(`${R}/core/controller.mjs`);
const { noticeText } = await import(`${R}/core/meetings/notice.mjs`);
const c = new CallController({
  config: { openaiKey: "sk-test-key", fastModel: "m", strategyModel: "m" },
  preferences: { liveHelp: true },
  speechFactory: () => ({ connect: async () => {}, push() {}, finish: async () => {}, close() {} }),
});
await c.command("start", { source: "audio", consent: true });
const lines = ["Our budget for next year is 2.4 million.", "Please keep the merger confidential until March.", "We will cut the agency retainer if results slip.", "Let us revisit this in two weeks."];
const say = (i) => c.engine.ingest({ id: `system:e1:${i}`, channel: "system", speaker: "Them", text: lines[i], final: true, startMs: i * 5000, endMs: i * 5000 + 4000, captureEpoch: 1 });
const kinds = (list) => list.map((r) => { try { const b = JSON.parse(r.body); return String(b.instructions || "").slice(0, 60); } catch { return "?"; } });
const has = (list) => lines.filter((l) => list.some((r) => r.body.includes(l))).length;
for (let i = 0; i < 3; i++) say(i);
c.engine.activeStartedAt -= 181000;                  // 3 minutes of active call time pass
say(3);                                              // next final turn -> running state -> maybeSummarize()
await new Promise((r) => setTimeout(r, 200));
const during = requests.splice(0);
console.log("notice participants hear:", JSON.stringify(noticeText({ liveHelp: true })));
console.log(`(a) during the call: ${during.length} request(s) ${JSON.stringify(kinds(during))}; transcript lines included: ${has(during)}/${lines.length}`);
await c.command("pause");                            // a common way to finish: Pause, then End
await c.command("end");
await new Promise((r) => setTimeout(r, 300));
console.log(`(b) at End: ${requests.length} request(s) ${JSON.stringify(kinds(requests))}; transcript lines included: ${has(requests)}/${lines.length}`);
c.close();
