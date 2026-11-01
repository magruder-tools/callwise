import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MeetingStore } from '../core/meetings/store.mjs';
import { MeetingSearch } from '../desktop/meeting-search.mjs';
const directory = mkdtempSync(path.join(os.tmpdir(), 'callwise-history-bench-')), root = path.resolve(import.meta.dirname, '..');
const store = new MeetingStore(directory, { key: randomBytes(32) }), search = new MeetingSearch(store);
try {
  store.transaction(() => { for (let i = 0; i < 300; i++) {
    const id = `synthetic-${i}`;
    store.put('meetings', id, id, { title: `Project planning ${i}`, people: [`Person ${i % 20}`], createdAt: Date.now() - i * 86400000, durationMs: 1800000, status: 'ended' });
    store.put('docs', id, 'notes:original', { text: 'Review the launch schedule and keep the revised budget for comparison.', version: 1 });
    for (let j = 0; j < 60; j++) store.put('segments', id, `turn-${j}`, { text: `We discussed the launch proposal, budget, design and schedule for project ${i}, segment ${j}.`, startMs: j * 30000, final: true, speaker: j % 2 ? 'You' : 'Them' });
  } });
  const started = performance.now(); const first = await search.search('launch proposal'); const firstIndexAndQueryMs = performance.now() - started;
  const times = []; for (let n = 0; n < 10; n++) { const start = performance.now(); await search.search(n % 2 ? 'revised budget' : 'design schedule'); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  const report = { syntheticOnly: true, meetings: 300, transcriptSegmentsPerMeeting: 60, totalTranscriptSegments: 18000, firstIndexAndQueryMs, warmQueryP50Ms: times[5], warmQueryP90Ms: times[9], matchedMeetings: first.length, note: 'Synthetic bounded corpus, not a measured library of 300 hour-long real calls.' };
  mkdirSync(path.join(root, 'artifacts'), { recursive: true }); writeFileSync(path.join(root, 'artifacts/local-history-benchmark.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { search.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
