import { EventEmitter } from "node:events";
import { NativeHost } from "./native-host.mjs";
import { SampleClock } from "../providers/apple-speech.mjs";
const SCHEDULE = [3, 8, 15, 25, 40, 60, 90].map((n) => n * 60000);
export class MeetingDiarizer extends EventEmitter {
  constructor(paths) {
    super();
    this.paths = paths;
  }
  start({ meetingId }) {
    this.close();
    this.meetingId = meetingId;
    this.clock = new SampleClock();
    this.next = 0;
    this.enabled = true;
    this.finalOnly = false;
    this.host = new NativeHost({ ...this.paths, mode: "diarize" });
    this.host.on("exit", () => {
      if (this.enabled) {
        this.enabled = false;
        this.emit("warning");
      }
    });
    this.ready = this.host.request("start").catch(() => {
      this.enabled = false;
      this.emit("warning");
    });
  }
  push(buffer, at) {
    if (!this.enabled) return;
    const timing = this.clock.packet(buffer, at);
    if (timing.startMs >= 7200000) {
      if (!this.limitWarned) {
        this.limitWarned = true;
        this.emit("warning");
      }
      return;
    }
    void this.ready.then(() => {
      if (this.enabled)
        try {
          this.host.send({
            op: "push",
            audio: Buffer.from(buffer).toString("base64"),
            startMs: timing.startMs,
          });
        } catch {
          this.enabled = false;
          this.emit("warning");
        }
    });
    if (
      !this.finalOnly &&
      timing.startMs >= SCHEDULE[this.next] &&
      !this.running
    ) {
      this.next++;
      void this.refresh(false);
    }
  }
  async refresh(final) {
    if (!this.enabled || this.running) return this.running;
    const started = Date.now();
    this.running = (async () => {
      await this.ready;
      if (!this.enabled) return;
      try {
        const result = await this.host.request(
          final ? "finish" : "refresh",
          {},
          { timeout: 10 * 60000 },
        );
        this.emit("turns", {
          meetingId: this.meetingId,
          turns: result.turns || [],
          final,
        });
        if (Date.now() - started > 60000) this.finalOnly = true;
      } catch {
        this.finalOnly = true;
        this.emit("warning");
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
  async finish() {
    if (this.running) await this.running;
    await this.refresh(true);
    this.close();
  }
  close() {
    this.enabled = false;
    this.host?.close();
    this.host = null;
    this.running = null;
    this.limitWarned = false;
  }
}
