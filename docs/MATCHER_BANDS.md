# Round 3 matcher selection

High 0.80, high margin 0.15, middle 0.60, stable 600 ms. MiniSearch lexical overlap contributes 25%; local sentence cosine contributes 75%. Exact request wrappers are stripped before indexing/embedding, without removing topic words.

Selected: pinned Xenova/bge-small-en-v1.5 int8 with CLS pooling, CPU worker, 384 dimensions. Apple NLEmbedding was tried first but failed the expanded aggregate accuracy bar. BGE passes 201/210 on-bank, 39/40 off-bank rejection and 19/20 near-miss rejection. The separate novel-paraphrase subset is 21/30 and needs real-material follow-up; this is not a real-call accuracy claim.

Reproduce frozen-vector correctness with npm run test:match. Reproduce actual local inference and record its model identity with node scripts/eval-matcher.mjs --record after npm run models:matcher. The manifest pins model revision, pooling, file sizes and hashes. Real model timings and evidence are in ROUND_3_FINISH_REPORT.md.
