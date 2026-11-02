import { createHash, randomUUID } from "node:crypto";
export function evidenceRows(rows) {
  return rows.filter((r) => r.final && !r.gap && r.text?.trim());
}
export function chunksForModel(rows, budget = 6500) {
  const chunks = [];
  let current = [],
    size = 0;
  for (const row of evidenceRows(rows)) {
    // Large manual rows are split into bounded pieces while retaining the source ID.
    for (let at = 0; at < row.text.length; at += 3500) {
      const item = {
        id: row.id,
        speaker: row.speaker,
        text: row.text.slice(at, at + 3500),
      };
      const length = Buffer.byteLength(JSON.stringify(item));
      if (current.length && size + length > budget) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(item);
      size += length;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}
export function validateDocument(value = {}, rows) {
  const evidence = new Map(evidenceRows(rows).map((r) => [r.id, r]));
  const refs = (v) =>
    [
      ...new Set(
        (Array.isArray(v?.segmentIds || v?.refs)
          ? v.segmentIds || v.refs
          : []
        ).filter((id) => evidence.has(id)),
      ),
    ].slice(0, 12);
  const bullets = (items) =>
    (Array.isArray(items) ? items : [])
      .flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const ids = refs(item);
        return typeof item?.text === "string" && item.text.trim() && ids.length
          ? [
              {
                id: item.id || randomUUID(),
                text: item.text.trim().slice(0, 2000),
                refs: ids,
              },
            ]
          : [];
      })
      .slice(0, 40);
  const actions = (Array.isArray(value.actions) ? value.actions : [])
    .flatMap((a) => {
      if (!a || typeof a !== "object") return [];
      const ids = refs(a);
      if (!ids.length || typeof a.text !== "string" || !a.text.trim())
        return [];
      const quote = (key) =>
        typeof a[key] === "string" &&
        a[key].trim() &&
        ids.some((id) => evidence.get(id).text.includes(a[key].trim()))
          ? a[key].trim().slice(0, 300)
          : null;
      return [
        {
          id: randomUUID(),
          text: a.text.trim().slice(0, 2000),
          owner: {
            name:
              quote("ownerQuote") &&
              /\bI(?:'ll| will| am going to)\b/i.test(quote("ownerQuote"))
                ? evidence.get(
                    ids.find((id) =>
                      evidence.get(id).text.includes(quote("ownerQuote")),
                    ),
                  )?.speaker || null
                : quote("ownerQuote") &&
                    /^[\p{Lu}][\p{L}'-]+(?: [\p{Lu}][\p{L}'-]+){0,3}$/u.test(
                      quote("ownerQuote"),
                    ) &&
                    !/^(I|We|You|Them)$/i.test(quote("ownerQuote"))
                  ? quote("ownerQuote")
                  : null,
            evidence: quote("ownerQuote"),
            confirmed: false,
          },
          due: {
            text: quote("dueQuote"),
            date: null,
            confirmed: false,
            inferred: false,
          },
          refs: ids,
          origin: "ai",
          state: "proposed",
          edited: false,
        },
      ];
    })
    .slice(0, 60);
  const answerRefs = refs({ segmentIds: value.answerSegmentIds });
  return {
    title: typeof value.title === "string" ? value.title.slice(0, 200) : "",
    summary: bullets(value.summary),
    decisions: bullets(value.decisions),
    openQuestions: bullets(value.openQuestions),
    actions,
    enhancedNotes:
      typeof value.enhancedNotes === "string"
        ? value.enhancedNotes.slice(0, 200000)
        : "",
    answer:
      answerRefs.length && typeof value.answer === "string"
        ? value.answer.slice(0, 6000)
        : "",
    answerRefs,
  };
}
export function extractiveDocument(rows) {
  const selected = evidenceRows(rows);
  const summary = selected.slice(0, 8).map((r) => ({
    id: randomUUID(),
    text: r.text.slice(0, 600),
    refs: [r.id],
    quotation: true,
  }));
  return {
    engine: "extractive",
    label: "Transcript excerpts — local AI unavailable",
    summary,
    decisions: [],
    openQuestions: [],
    actions: [],
    title: "",
    enhancedNotes: "",
    answer: "",
    answerRefs: [],
  };
}
export function mergeActions(existing, suggested) {
  const signature = (a) =>
    createHash("sha256")
      .update(
        a.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "") +
          [...(a.refs || [])].sort().join("|"),
      )
      .digest("hex");
  const old = new Map(existing.map((a) => [signature(a), a]));
  const tokens = (s) =>
    new Set(s.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  for (const a of suggested) {
    const nextTokens = tokens(a.text);
    const equivalent = [...old.values()].some((prior) => {
      const commonRefs = (a.refs || []).some((ref) =>
        (prior.refs || []).includes(ref),
      );
      if (!commonRefs) return false;
      // Preserve the user's correction even when the next model rephrases it.
      if (prior.edited || prior.state === "dismissed") return true;
      const original = tokens(prior.text),
        common = [...original].filter((t) => nextTokens.has(t)).length;
      return (
        common / Math.max(1, Math.min(original.size, nextTokens.size)) >= 0.65
      );
    });
    if (!old.has(signature(a)) && !equivalent) old.set(signature(a), a);
  }
  return [...old.values()];
}
export class LocalDocuments {
  constructor(native) {
    this.native = native;
  }
  async generate(
    rows,
    { task = "recap", notes = "", question = "", signal } = {},
  ) {
    if (task === "enhance" && notes.trim()) {
      try {
        const blocks = [],
          characters = Array.from(notes);
        for (let offset = 0; offset < characters.length; offset += 4500) {
          if (signal?.aborted) throw new Error("Cancelled.");
          const original = characters.slice(offset, offset + 4500).join("");
          const result = await this.native.run(
            "llm",
            {
              prompt: JSON.stringify({
                task: "enhance_block",
                originalNotes: original,
                evidence: [],
                instruction:
                  "Improve clarity and formatting of only these original notes. Preserve every factual claim and uncertainty; add no facts, owners, dates or decisions. Return the result in enhancedNotes; leave other fields empty.",
              }),
            },
            { timeout: 60000, signal },
          );
          if (
            typeof result.enhancedNotes !== "string" ||
            !result.enhancedNotes.trim()
          )
            throw new Error("Empty enhancement.");
          blocks.push(result.enhancedNotes);
        }
        return {
          ...extractiveDocument([]),
          enhancedNotes: blocks.join("\n\n"),
          engine: "apple",
          label: "Generated on this Mac",
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        return extractiveDocument(rows);
      }
    }
    const chunks = chunksForModel(rows);
    if (!chunks.length) return extractiveDocument(rows);
    const partials = [];
    try {
      for (const chunk of chunks) {
        if (signal?.aborted) throw new Error("Cancelled.");
        const prompt = JSON.stringify({
          task: chunks.length > 1 ? "section_notes" : task,
          question: question.slice(0, 1000),
          originalNotes: notes.slice(0, 1200),
          evidence: chunk,
          instruction:
            "Use exact evidence IDs. Quote owner/deadline evidence or leave it empty. Do not add unsupported facts.",
        });
        const result = await this.native.run(
          "llm",
          { prompt },
          { timeout: 60000, signal },
        );
        partials.push(validateDocument(result, rows));
      }
      // Bounded hierarchical merges retain references to original transcript IDs.
      let level = partials;
      while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2) {
          const pair = level.slice(i, i + 2);
          if (pair.length === 1) {
            next.push(pair[0]);
            continue;
          }
          const prompt = JSON.stringify({
            task,
            question: question.slice(0, 1000),
            originalNotes: notes.slice(0, 1000),
            sections: pair.map((section) => ({
              summary: section.summary.slice(0, 8).map((b) => ({
                text: b.text.slice(0, 240),
                segmentIds: b.refs.slice(0, 6),
              })),
              decisions: section.decisions.slice(0, 5).map((b) => ({
                text: b.text.slice(0, 240),
                segmentIds: b.refs.slice(0, 6),
              })),
              openQuestions: section.openQuestions.slice(0, 5).map((b) => ({
                text: b.text.slice(0, 240),
                segmentIds: b.refs.slice(0, 6),
              })),
              actions: section.actions.slice(0, 10).map((a) => ({
                text: a.text.slice(0, 200),
                segmentIds: a.refs.slice(0, 6),
                ownerQuote: a.owner?.name || "",
                dueQuote: a.due?.text || "",
              })),
            })),
          });
          const combined = await this.native.run(
            "llm",
            { prompt },
            { timeout: 60000, signal },
          );
          next.push(validateDocument(combined, rows));
        }
        level = next;
      }
      return { ...level[0], engine: "apple", label: "Generated on this Mac" };
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        ...extractiveDocument(rows),
        reason:
          "Local generation could not finish. Your transcript and original notes are unchanged.",
      };
    }
  }
}
