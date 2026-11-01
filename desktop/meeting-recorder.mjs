import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import { SampleClock } from "../providers/apple-speech.mjs";
export class MeetingRecorder extends EventEmitter {
  start({ meetingId, enabled, store }) {
    this.close();
    this.finishJob = null;
    this.enabled = enabled && !!store;
    if (!this.enabled) return;
    this.store = store;
    this.meetingId = meetingId;
    this.pending = 0;
    this.clocks = new Map(
      ["mic", "system"].map((ch) => [ch, new SampleClock()]),
    );
    this.worker = new Worker(
      new URL("./workers/audio-encoder-worker.mjs", import.meta.url),
      {
        workerData: {
          directory: store.directory,
          key: store.key,
          keyId: store.keyId,
          meetingId,
        },
      },
    );
    this.worker.on("message", (m) => {
      if (m.type === "ack") this.pending = Math.max(0, this.pending - 1);
      if (m.type === "chunk") {
        try {
          store.put("audio_chunks", meetingId, m.id, m.record);
          this.emit("chunk", m.record);
        } catch {
          this.enabled = false;
          this.emit("error", new Error("Audio save failed."));
        }
      }
      if (m.type === "flushed") this.flushResolve?.();
      if (m.type === "error") {
        this.enabled = false;
        this.emit("error", new Error("Audio save failed."));
      }
    });
    this.worker.on("error", () => {
      this.enabled = false;
      this.emit("error", new Error("Audio encoding failed."));
    });
  }
  push(channel, bytes, at) {
    if (!this.enabled || !this.worker) return;
    if (this.pending > 300) {
      this.enabled = false;
      this.emit("error", new Error("Audio encoding fell behind."));
      return;
    }
    const timing = this.clocks.get(channel)?.packet(bytes, at);
    if (!timing) return;
    this.pending++;
    this.worker.postMessage({
      op: "push",
      channel,
      bytes,
      startMs: timing.startMs,
    });
  }
  async finish() {
    if (this.finishJob) return this.finishJob;
    this.enabled = false;
    if (!this.worker) return;
    this.finishJob = new Promise((resolve) => {
      const timer = setTimeout(resolve, 15000);
      this.flushResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.worker.postMessage({ op: "flush", request: 1 });
    }).then(() => this.close());
    await this.finishJob;
  }
  close() {
    this.enabled = false;
    void this.worker?.terminate();
    this.worker = null;
    this.flushResolve?.();
    this.flushResolve = null;
  }
}
