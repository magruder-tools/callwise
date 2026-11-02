import { parentPort, workerData } from "node:worker_threads";
import MiniSearch from "minisearch";
import { MeetingStore } from "../../core/meetings/store.mjs";
const store = new MeetingStore(workerData.directory, {
  key: workerData.key,
  keyId: workerData.keyId,
  readOnly: true,
});
let index,
  revision = -1,
  metadata = new Map(),
  records = new Map();
function build(next) {
  index = new MiniSearch({
    fields: ["title", "people", "recap", "notes", "transcript"],
    storeFields: ["meetingId", "segmentId", "excerpt"],
    searchOptions: {
      boost: { title: 3, people: 3, recap: 1.5, notes: 1.2 },
      prefix: true,
      fuzzy: 0.15,
    },
  });
  metadata.clear();
  records.clear();
  const docs = [];
  for (const m of store.all("meetings")) {
    const actions = store.all("actions", m.id),
      d = store.all("docs", m.id),
      recap = d.find((d) => d.id === "recap");
    metadata.set(m.id, {
      id: m.id,
      title: m.title,
      people: m.people,
      createdAt: m.createdAt,
      durationMs: m.durationMs,
      status: m.status,
      openActions: actions.filter(
        (a) => a.state !== "dismissed" && !a.completed,
      ).length,
    });
    docs.push({
      id: m.id,
      meetingId: m.id,
      title: m.title,
      people: m.people.join(" "),
      recap: [
        ...(recap?.summary || []),
        ...(recap?.decisions || []),
        ...(recap?.openQuestions || []),
      ]
        .map((b) => b.text)
        .join("\n"),
      notes: d
        .filter((v) => v.id.startsWith("notes:"))
        .map((v) => v.text || "")
        .join("\n"),
      excerpt: recap?.summary?.[0]?.text?.slice(0, 300) || "",
    });
    for (const r of store.all("segments", m.id))
      if (r.final)
        docs.push({
          id: `${m.id}:${r.id}`,
          meetingId: m.id,
          segmentId: r.id,
          transcript: r.text,
          excerpt: r.text.slice(0, 500),
        });
  }
  for (const d of docs) records.set(d.id, d);
  index.addAll(docs);
  revision = next;
}
parentPort.on("message", (message) => {
  try {
    if (!index || message.revision !== revision) build(message.revision);
    const { query = "", filters = {} } = message;
    const allowed = (m) =>
      (!filters.from || m.createdAt >= filters.from) &&
      (!filters.to || m.createdAt <= filters.to) &&
      (!filters.openActions || m.openActions > 0) &&
      (!filters.person ||
        m.people.some((p) =>
          p.toLowerCase().includes(String(filters.person).toLowerCase()),
        ));
    const found = query.trim()
      ? index.search(query.slice(0, 1000))
      : [...metadata.values()]
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((m) => ({ id: m.id, meetingId: m.id, score: 0 }));
    const grouped = new Map();
    for (const hit of found) {
      const m = metadata.get(hit.meetingId);
      if (!m || !allowed(m)) continue;
      if (!grouped.has(m.id))
        grouped.set(m.id, { ...m, score: hit.score, excerpts: [] });
      const r = records.get(hit.id);
      if (r?.excerpt && grouped.get(m.id).excerpts.length < 3)
        grouped
          .get(m.id)
          .excerpts.push({ text: r.excerpt, segmentId: r.segmentId || null });
    }
    parentPort.postMessage({
      id: message.id,
      results: [...grouped.values()].slice(0, 100),
    });
  } catch {
    parentPort.postMessage({
      id: message.id,
      error: "Meeting search could not be loaded.",
    });
  }
});
parentPort.on("close", () => store.close());
