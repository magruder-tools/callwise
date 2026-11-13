import { Worker } from "node:worker_threads";
export class LocalEmbedding {
  constructor({ native = null, resources, WorkerImpl = Worker, preferNative = false } = {}) { Object.assign(this, { native, resources, WorkerImpl, preferNative }); this.pending = new Map(); this.sequence = 0; }
  async initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      try {
        if (!this.native || !this.preferNative) throw new Error();
        const vectors = await this.native.embed(["A local sentence."]);
        if (!vectors[0]?.length) throw new Error();
        this.model = "Apple NLEmbedding English sentence"; this.useNative = true;
      } catch {
        this.worker = new this.WorkerImpl(new URL("../core/embedding-worker.mjs", import.meta.url), { workerData: { resources: this.resources } });
        await new Promise((resolve, reject) => {
          this.worker.once("error", reject);
          this.worker.on("message", (m) => {
            if (m.ready) { this.model = m.model; resolve(); return; }
            const request = this.pending.get(m.id); if (!request) return;
            this.pending.delete(m.id); clearTimeout(request.timer);
            if (m.error) request.reject(new Error(m.error)); else request.resolve(m.vectors);
          });
          this.worker.on("exit", () => { for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Offline matcher closed.")); } this.pending.clear(); });
        });
      }
    })();
    return this.initializing;
  }
  async embed(texts) {
    if (!Array.isArray(texts) || texts.length > 48 || texts.some((s) => typeof s !== "string" || s.length > 4000)) throw new Error("Invalid sentence matcher input.");
    if (!texts.length) return [];
    await this.initialize();
    if (this.useNative) return this.native.embed(texts);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Offline matcher took too long.")); }, 15000); timer.unref?.();
      this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, texts });
    });
  }
  close() { this.worker?.terminate(); this.worker = null; }
}
