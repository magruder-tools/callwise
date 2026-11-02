import { randomUUID } from "node:crypto";
import { NativeHost } from "../desktop/native-host.mjs";
export class SampleClock {
  constructor({ rate = 24000 } = {}) {
    this.rate = rate;
    this.samples = 0;
    this.base = null;
  }
  packet(buffer, arrivalMs) {
    const samples = buffer.byteLength / 2,
      durationMs = (samples * 1000) / this.rate;
    const arrivalStart = Math.max(0, arrivalMs - durationMs);
    let expected =
      this.base === null
        ? arrivalStart
        : this.base + (this.samples * 1000) / this.rate;
    const delta = arrivalStart - expected;
    let gap = false;
    if (this.base === null || Math.abs(delta) > 750) {
      gap = this.base !== null && delta > 2000;
      this.base = arrivalStart;
      this.samples = 0;
      expected = arrivalStart;
    }
    this.samples += samples;
    return { startMs: expected, durationMs, gap };
  }
}
// One process, two independent Apple analyzers. PCM never leaves the Mac.
export class AppleSpeechSession {
  constructor({
    binary,
    resources,
    channels = ["mic", "system"],
    language = "en-US",
    hints = [],
    hostFactory = (opts) => new NativeHost(opts),
    epoch = 0,
  } = {}) {
    Object.assign(this, {
      binary,
      resources,
      channels,
      language,
      hints,
      hostFactory,
      epoch,
    });
    this.clients = new Map();
    this.clocks = new Map(channels.map((c) => [c, new SampleClock()]));
    this.buffers = new Map(channels.map((c) => [c, []]));
    this.stopped = false;
    this.restarts = [];
    this.recovering = false;
  }
  adapter(options) {
    const a = new AppleTranscriber(this, options);
    this.clients.set(options.channel, a);
    return a;
  }
  async connect() {
    if (this.connection) return this.connection;
    this.connection = this.startHost();
    return this.connection;
  }
  async startHost() {
    const runId = randomUUID();
    this.host = this.hostFactory({
      binary: this.binary,
      resources: this.resources,
      mode: "speech",
    });
    const host = this.host;
    host.on("message", (value) => {
      if (this.stopped || host !== this.host) return;
      if (
        value.type === "segment" &&
        value.row &&
        this.channels.includes(value.row.channel)
      ) {
        const client = this.clients.get(value.row.channel);
        if (value.row.final && Number.isFinite(value.row.endMs)) {
          this.finalEnds ||= new Map();
          this.finalEnds.set(
            value.row.channel,
            Math.max(
              this.finalEnds.get(value.row.channel) || 0,
              value.row.endMs,
            ),
          );
        }
        client?.onSegment({
          ...value.row,
          id: `${value.row.id}:run:${runId}`,
          runId,
        });
      }
      if (value.type === "discard" && value.channel)
        this.clients
          .get(value.channel)
          ?.onDiscard((value.ids || []).map((id) => `${id}:run:${runId}`));
      if (value.type === "error" && value.channel) {
        this.failedChannels ||= new Set();
        this.failedChannels.add(value.channel);
        this.clients
          .get(value.channel)
          ?.onStatus(
            "failed",
            new Error(
              "Local speech stopped on this audio channel. Pause and resume to retry.",
            ),
          );
      } else if (value.type === "error" && !value.id) void this.recover();
    });
    host.on("exit", () => {
      if (!this.stopped && host === this.host && !this.finishing)
        void this.recover();
    });
    await host.request("start", {
      channels: this.channels,
      epoch: this.epoch,
      language: this.language,
      hints: this.hints,
    });
    if (this.stopped) {
      host.close();
      return;
    }
    for (const c of this.clients.values())
      if (!this.failedChannels?.has(c.channel)) c.onStatus("connected");
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (!this.finishing)
        void host
          .request("ping", {}, { timeout: 20000 })
          .catch(() => this.recover());
    }, 5000);
    this.heartbeat.unref?.();
  }
  push(channel, buffer, at) {
    if (
      this.stopped ||
      this.finishing ||
      this.failedChannels?.has(channel) ||
      !this.channels.includes(channel)
    )
      return;
    buffer = Buffer.from(buffer);
    if (!buffer.length || buffer.length % 2 || buffer.length > 480000) return;
    const timing = this.clocks.get(channel).packet(buffer, at);
    const rows = this.buffers.get(channel);
    rows.push({ buffer, ...timing });
    while (
      rows.length &&
      timing.startMs + timing.durationMs - rows[0].startMs > 15000
    )
      rows.shift();
    if (timing.gap)
      this.clients.get(channel)?.onSegment({
        id: `${channel}:gap:${randomUUID()}`,
        channel,
        speaker: "Transcription gap",
        text: "Audio was interrupted. Some words may be missing.",
        startMs: timing.startMs,
        final: true,
        gap: true,
      });
    if (this.recovering) return;
    try {
      this.host.send({
        op: "push",
        channel,
        audio: buffer.toString("base64"),
        startMs: timing.startMs,
      });
    } catch {
      void this.recover();
    }
  }
  async recover() {
    if (this.stopped || this.finishing || this.recovering) return;
    this.recovering = true;
    this.host?.close();
    clearInterval(this.heartbeat);
    if (this.restarts.length >= 3) {
      this.recovering = false;
      for (const c of this.clients.values())
        c.onStatus(
          "failed",
          new Error(
            "Local speech stopped repeatedly. Pause and resume to try again.",
          ),
        );
      this.close();
      return;
    }
    this.restarts.push(Date.now());
    this.failedChannels = new Set();
    for (const c of this.clients.values()) {
      c.onStatus("reconnecting");
      c.onSegment({
        id: `${c.channel}:gap:${randomUUID()}`,
        channel: c.channel,
        speaker: "Transcription gap",
        text: "Local speech restarted; replayed words may overlap and some words may be missing.",
        startMs: this.buffers.get(c.channel)?.[0]?.startMs || 0,
        final: true,
        gap: true,
      });
    }
    try {
      await this.startHost();
      for (const [channel, rows] of this.buffers)
        for (const row of rows) {
          const end = this.finalEnds?.get(channel) || 0;
          if (row.startMs + row.durationMs <= end) continue;
          const skip = Math.max(0, Math.floor((end - row.startMs) * 24)) * 2;
          this.host.send({
            op: "push",
            channel,
            audio: row.buffer.subarray(skip).toString("base64"),
            startMs: row.startMs + skip / 48,
          });
        }
    } catch {
      this.recovering = false;
      if (!this.stopped) {
        const timer = setTimeout(() => void this.recover(), 500);
        timer.unref?.();
      }
      return;
    }
    this.recovering = false;
  }
  async finish(timeout = 8000) {
    if (this.finishJob) return this.finishJob;
    this.finishing = true;
    clearInterval(this.heartbeat);
    this.finishJob = this.host
      ?.request("finish", {}, { timeout })
      .catch(() => ({ finished: false }));
    return this.finishJob;
  }
  close() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.heartbeat);
    this.host?.close();
    for (const rows of this.buffers.values()) {
      for (const r of rows) r.buffer.fill(0);
      rows.length = 0;
    }
  }
}
export class AppleTranscriber {
  constructor(
    session,
    {
      channel,
      onSegment = () => {},
      onStatus = () => {},
      onDiscard = () => {},
    },
  ) {
    Object.assign(this, { session, channel, onSegment, onStatus, onDiscard });
    this.stopped = false;
  }
  connect() {
    return this.session.connect();
  }
  push(buffer, at) {
    if (!this.stopped) this.session.push(this.channel, buffer, at);
  }
  updateHints({ keywords }) {
    const hints = keywords || [];
    this.session.hints = hints;
    void this.session.host?.request("hints", { hints }).catch(() => {});
  }
  finish(options) {
    return this.session.finish(
      typeof options === "number" ? options : options?.timeoutMs,
    );
  }
  close() {
    this.stopped = true;
    if ([...this.session.clients.values()].every((c) => c.stopped))
      this.session.close();
  }
}
