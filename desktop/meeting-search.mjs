import { Worker } from "node:worker_threads";
export class MeetingSearch {
  constructor(store) {
    this.store = store;
    this.revision = 0;
    this.sequence = 0;
    this.pending = new Map();
  }
  invalidate() {
    this.revision++;
  }
  async search(query, filters = {}) {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("./workers/search-worker.mjs", import.meta.url),
        {
          workerData: {
            directory: this.store.directory,
            key: this.store.key,
            keyId: this.store.keyId,
          },
        },
      );
      this.worker.on("message", (m) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        m.error ? p.reject(new Error(m.error)) : p.resolve(m.results);
      });
      this.worker.on("error", () => {
        this.close();
      });
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Meeting search took too long."));
      }, 20000);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, query, filters, revision: this.revision });
    });
  }
  close() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Meeting search stopped."));
    }
    this.pending.clear();
    void this.worker?.terminate();
    this.worker = null;
  }
}
