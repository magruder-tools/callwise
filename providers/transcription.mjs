import WebSocket from "ws";
import { AdaptiveVoice } from "../ui/audio-level.mjs";
import { providerError, fatalTranscriptionError } from "./errors.mjs";

export function pcmRms(buffer) {
  let sum = 0;
  const n = Math.floor(buffer.length / 2);
  for (let i = 0; i < n; i++) {
    const x = buffer.readInt16LE(i * 2) / 32768;
    sum += x * x;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

// PCM is kept only in bounded memory, until its final transcript is acknowledged.
export class LiveTranscriber {
  constructor({
    apiKey,
    model = "gpt-live-transcribe",
    channel,
    onSegment,
    onStatus,
    onDiscard = () => {},
    onAudioSent = () => {},
    diagnostics = () => {},
    WebSocketClass = WebSocket,
    connectTimeoutMs = 12000,
    heartbeatMs = 15000,
    finalTimeoutMs = 45000,
    retryBaseMs = 500,
    retryMaxMs = 8000,
    retryWindowMs = 60000,
    bufferMs = 15000,
    clock = Date.now,
    keywords = [],
    languages = ["en"],
    prompt = "",
    delay = "low",
    rotateMs = 50 * 60 * 1000,
    namespace = "",
  }) {
    Object.assign(this, {
      apiKey,
      model,
      channel,
      onSegment,
      onStatus,
      onDiscard,
      onAudioSent,
      diagnostics,
      WS: WebSocketClass,
      connectTimeoutMs,
      heartbeatMs,
      finalTimeoutMs,
      retryBaseMs,
      retryMaxMs,
      retryWindowMs,
      bufferMs,
      clock,
      keywords,
      languages,
      prompt,
      delay,
      rotateMs,
      namespace,
    });
    this.voiceDetector = new AdaptiveVoice();
    this.idleMs = 0;
    this.rotationOptions = {
      apiKey,
      model,
      channel,
      onSegment,
      onStatus,
      onDiscard,
      onAudioSent,
      diagnostics,
      WebSocketClass,
      connectTimeoutMs,
      heartbeatMs,
      finalTimeoutMs,
      retryBaseMs,
      retryMaxMs,
      retryWindowMs,
      bufferMs,
      clock,
      keywords,
      languages,
      prompt,
      delay,
      rotateMs,
    };
    this.socket = null;
    this.ready = false;
    this.stopped = false;
    this.connection = 0;
    this.sequence = 0;
    this.retained = [];
    this.retainedBytes = 0;
    this.lost = [];
    this.recoveryStartedAt = null;
    this.attempt = 0;
    this.partial = new Map();
    this.starts = new Map();
    this.awaitingFinal = new Map();
    this.completed = new Set();
    this.prefix = [];
    this.voiceMs = this.silenceMs = this.sentMs = 0;
    this.pendingCommits = [];
  }
  async connect() {
    if (!this.apiKey)
      throw new Error(
        "OpenAI transcription needs an API key. Choose Demo to try the app first.",
      );
    this.close();
    this.stopped = false;
    return new Promise((resolve, reject) => {
      this.settle = (error) => {
        this.settle = null;
        if (error) reject(error);
        else resolve();
      };
      this.openSocket();
    });
  }
  openSocket() {
    if (this.stopped) return;
    let socket;
    try {
      socket = new this.WS(
        "wss://api.openai.com/v1/realtime?intent=transcription",
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        },
      );
    } catch {
      this.recover("transport");
      return;
    }
    this.socket = socket;
    this.connection++;
    this.diagnostics("transcription.connect", {
      channel: this.channel,
      attempt: this.attempt,
    });
    this.connectTimer = setTimeout(
      () => this.recover("timeout"),
      this.connectTimeoutMs,
    );
    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.send({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: transcriptionOptions(this.model, {
                keywords: this.keywords,
                languages: this.languages,
                prompt: this.prompt,
                delay: this.delay,
              }),
              turn_detection: null,
            },
          },
        },
      });
    });
    socket.on("error", () => {
      if (this.socket === socket) this.recover("transport");
    });
    socket.on("close", () => {
      if (this.socket === socket) this.recover("closed");
    });
    socket.on("unexpected-response", (_request, response) => {
      if (this.socket !== socket) return;
      const error = providerError({
        status: response.statusCode,
        channel: this.channel,
      });
      this.diagnostics("transcription.error", {
        channel: this.channel,
        status: error.status,
      });
      if (fatalTranscriptionError(error)) this.fail(error);
      else this.recover("handshake");
      response.resume?.();
    });
    socket.on("pong", () => {
      if (this.socket === socket) this.lastPong = this.clock();
    });
    socket.on("message", (raw) => {
      if (this.socket !== socket) return;
      let event;
      try {
        event = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!event || typeof event !== "object") return;
      this.receive(event);
    });
  }
  receive(event) {
    if (event.type === "session.updated") {
      if (this.ready) return;
      clearTimeout(this.connectTimer);
      clearTimeout(this.retryDeadline);
      this.ready = true;
      this.openedAt = this.clock();
      this.recoveryStartedAt = null;
      this.attempt = 0;
      this.lastPong = this.clock();
      this.replayBuffer();
      if (!this.ready || this.stopped) return;
      this.watchdog = setInterval(() => {
        if (!this.ready || this.stopped) return;
        const waiting = [
          ...this.awaitingFinal.values(),
          ...this.pendingCommits.map((commit) => commit.at),
        ];
        if (waiting.some((at) => this.clock() - at > this.finalTimeoutMs)) {
          this.recover("stalled_segment");
          return;
        }
        if (typeof this.socket?.ping === "function") {
          if (this.clock() - this.lastPong > this.heartbeatMs * 2.5) {
            this.recover("heartbeat");
            return;
          }
          try {
            this.socket.ping();
          } catch {
            this.recover("transport");
          }
        }
      }, this.heartbeatMs);
      this.watchdog.unref?.();
      this.settle?.();
      this.onStatus?.("connected");
      return;
    }
    if (
      event.type === "error" ||
      event.type === "conversation.item.input_audio_transcription.failed"
    ) {
      const error = providerError({
        status: event.error?.status,
        code: event.error?.code,
        type: event.error?.type,
        channel: this.channel,
      });
      this.diagnostics("transcription.error", {
        channel: this.channel,
        status: error.status,
        code: error.code,
        type: error.type,
      });
      if (fatalTranscriptionError(error)) this.fail(error);
      // Ordinary Realtime error events do not imply the transport is dead.
      else if (event.type.endsWith(".failed")) this.recover("stalled_segment");
      return;
    }
    const id = event.item_id;
    if (typeof id !== "string" || id.length > 300 || this.completed.has(id))
      return;
    if (event.type === "input_audio_buffer.committed") {
      const commit = this.pendingCommits.shift();
      if (commit) this.starts.set(id, commit);
      this.awaitingFinal.set(id, this.clock());
    }
    if (event.type === "conversation.item.input_audio_transcription.delta") {
      if (typeof event.delta !== "string") return;
      const text = (this.partial.get(id) || "") + event.delta;
      if (text.length > 20000) {
        this.recover("backpressure");
        return;
      }
      this.partial.set(id, text);
      if (!this.awaitingFinal.has(id)) this.awaitingFinal.set(id, this.clock());
      this.emitSegment(id, text, false);
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      if (
        typeof event.transcript !== "string" ||
        event.transcript.length > 20000
      ) {
        this.recover("invalid_segment");
        return;
      }
      this.emitSegment(id, event.transcript, true);
      const commit = this.starts.get(id);
      if (commit) {
        this.retained = this.retained.filter(
          (frame) => frame.seq < commit.firstSeq || frame.seq > commit.endSeq,
        );
        this.retainedBytes = this.retained.reduce(
          (n, frame) => n + frame.data.length,
          0,
        );
        this.lost = this.lost.filter(
          (frame) => frame.seq < commit.firstSeq || frame.seq > commit.endSeq,
        );
      }
      this.partial.delete(id);
      this.starts.delete(id);
      this.awaitingFinal.delete(id);
      this.completed.add(id);
      if (this.completed.size > 2000)
        this.completed.delete(this.completed.values().next().value);
    }
    if (this.awaitingFinal.size > 100) this.recover("backpressure");
  }
  segmentId(id) {
    return `${this.channel}${this.namespace}:${this.connection}:${id}`;
  }
  emitSegment(id, text, final) {
    try {
      this.onSegment?.({
        id: this.segmentId(id),
        text: text || "",
        speaker: this.channel === "mic" ? "You" : "Other",
        channel: this.channel,
        startMs: this.starts.get(id)?.startMs ?? this.currentStart ?? 0,
        final,
        endMs: this.starts.get(id)?.endMs,
      });
    } catch {
      this.recover("delivery");
    }
  }
  retain(data, startMs) {
    const frame = {
      seq: ++this.sequence,
      data,
      startMs,
      duration: data.length / 48,
    };
    this.retained.push(frame);
    this.retainedBytes += data.length;
    const cap = this.bufferMs * 48;
    while (this.retainedBytes > cap && this.retained.length) {
      const oldest = this.retained[0];
      const excess = Math.min(oldest.data.length, this.retainedBytes - cap);
      this.lost.push({
        seq: oldest.seq,
        duration: excess / 48,
        startMs: oldest.startMs,
      });
      if (excess === oldest.data.length) this.retained.shift();
      else {
        oldest.data = oldest.data.subarray(excess);
        oldest.startMs += excess / 48;
        oldest.duration = oldest.data.length / 48;
      }
      this.retainedBytes -= excess;
    }
    // Loss metadata contains no PCM; coalesce repeated trims of the same chunk.
    if (this.lost.length > 1) {
      const last = this.lost.at(-1),
        previous = this.lost.at(-2);
      if (last.seq === previous.seq) {
        previous.duration += last.duration;
        this.lost.pop();
      }
    }
    return frame;
  }
  push(pcm, elapsedMs = 0) {
    if (this.stopped) return;
    if (this.delegate) {
      this.delegate.push(pcm, elapsedMs);
      return;
    }
    const data = Buffer.from(pcm);
    if (!data.length || data.length > 19200 || data.length % 2) return;
    const duration = data.length / 48;
    const startMs = Math.max(0, elapsedMs - duration);
    if (!this.ready || this.socket?.readyState !== 1) {
      if (this.recoveryStartedAt !== null) this.retain(data, startMs);
      return;
    }
    if (this.socket.bufferedAmount > 240000) {
      this.retain(data, startMs);
      this.recover("backpressure");
      return;
    }
    const active = this.voiceDetector.update(pcmRms(data), duration);
    this.idleMs = active ? 0 : this.idleMs + duration;
    if (this.clock() - this.openedAt >= this.rotateMs && !this.rotating) {
      this.rotating = true;
      const next = new LiveTranscriber({
        ...this.rotationOptions,
        namespace: `${this.namespace}:r${this.connection}`,
        onStatus: (status, error) => {
          if (this.delegate === next) this.onStatus?.(status, error);
        },
      });
      this.standby = next;
      void next.connect().catch(() => {
        next.close();
        if (this.standby === next) this.standby = null;
        this.rotating = false;
        this.openedAt = this.clock() - this.rotateMs + 60000;
      });
    }
    if (
      this.standby?.ready &&
      this.idleMs >= 1500 &&
      !this.voiceMs &&
      !this.pendingCommits.length &&
      !this.awaitingFinal.size
    ) {
      this.delegate = this.standby;
      this.standby = null;
      this.detachSocket();
      this.retained = [];
      this.retainedBytes = 0;
      this.diagnostics("transcription.rotate", { channel: this.channel });
      this.onStatus?.("connected");
      this.delegate.push(data, elapsedMs);
      return;
    }
    if (!this.voiceMs && !active) {
      this.prefix.push({ data, startMs });
      if (this.prefix.length > 3) this.prefix.shift();
      return;
    }
    if (!this.voiceMs) {
      this.currentStart = this.prefix[0]?.startMs ?? startMs;
      this.turnFirstSeq = this.sequence + 1;
      for (const pre of this.prefix) {
        this.retain(pre.data, pre.startMs);
        if (!this.append(pre.data)) break;
      }
      this.prefix = [];
    }
    this.retain(data, startMs);
    if (!this.ready || !this.append(data)) return;
    this.voiceMs += duration;
    this.silenceMs = active ? 0 : this.silenceMs + duration;
    if (
      (this.silenceMs >= 600 && this.voiceMs >= 300) ||
      (this.voiceMs >= 8000 && this.silenceMs >= 200) ||
      this.voiceMs >= 14000
    )
      this.commit();
  }
  commit() {
    if (this.pendingCommits.length >= 30) {
      this.recover("backpressure");
      return false;
    }
    this.pendingCommits.push({
      startMs: this.currentStart ?? 0,
      endMs: (this.currentStart ?? 0) + this.voiceMs,
      firstSeq: this.turnFirstSeq,
      endSeq: this.sequence,
      at: this.clock(),
    });
    const sent = this.send({ type: "input_audio_buffer.commit" });
    this.voiceMs = this.silenceMs = 0;
    return sent;
  }
  replayBuffer() {
    this.markGap();
    const frames = [...this.retained];
    this.diagnostics("transcription.replay", {
      channel: this.channel,
      bufferMs: this.retainedBytes / 48,
    });
    let duration = 0,
      firstSeq;
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      firstSeq ??= frame.seq;
      this.currentStart = duration ? this.currentStart : frame.startMs;
      if (!this.append(frame.data)) return;
      duration += frame.duration;
      const next = frames[i + 1];
      const discontinuity =
        next &&
        (next.seq !== frame.seq + 1 ||
          next.startMs - (frame.startMs + frame.duration) > 500);
      if (duration >= 8000 || !next || discontinuity) {
        this.pendingCommits.push({
          startMs: this.currentStart,
          firstSeq,
          endSeq: frame.seq,
          at: this.clock(),
        });
        if (!this.send({ type: "input_audio_buffer.commit" })) return;
        duration = 0;
        firstSeq = undefined;
      }
    }
    this.voiceMs = this.silenceMs = 0;
    this.prefix = [];
  }
  markGap(extraMs = 0) {
    const lostMs =
      this.lost.reduce((n, frame) => n + frame.duration, 0) + extraMs;
    if (!lostMs) return;
    const startMs = this.lost[0]?.startMs ?? this.retained[0]?.startMs ?? 0;
    this.lost = [];
    this.diagnostics("transcription.gap", { channel: this.channel, lostMs });
    this.onSegment?.({
      id: `${this.channel}:gap:${this.connection}:${++this.sequence}`,
      speaker: "Transcription gap",
      channel: this.channel,
      gap: true,
      final: true,
      startMs,
      text: `${this.channel === "mic" ? "Your voice" : "Call audio"}: about ${Math.max(1, Math.round(lostMs / 1000))} seconds missed.${extraMs ? " Transcription on this channel stopped; later speech is unavailable." : ""}`,
    });
  }
  append(data) {
    const sent = this.send({
      type: "input_audio_buffer.append",
      audio: data.toString("base64"),
    });
    if (sent) {
      this.sentMs += data.length / 48;
      this.onAudioSent(data.length / 48);
    }
    return sent;
  }
  send(message) {
    if (this.socket?.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      this.recover("transport");
      return false;
    }
  }
  detachSocket() {
    clearTimeout(this.connectTimer);
    clearInterval(this.watchdog);
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    if (socket) {
      socket.removeAllListeners();
      socket.on("error", () => {});
      try {
        if (socket.readyState === 0) socket.terminate();
        else socket.close();
      } catch {
        /* Already disconnected. */
      }
    }
  }
  recover(code) {
    if (this.stopped) return;
    this.detachSocket();
    this.onDiscard([...this.partial.keys()].map((id) => this.segmentId(id)));
    this.partial.clear();
    this.starts.clear();
    this.awaitingFinal.clear();
    this.completed.clear();
    this.pendingCommits = [];
    this.prefix = [];
    this.voiceMs = this.silenceMs = 0;
    if (this.recoveryStartedAt === null) {
      this.recoveryStartedAt = this.clock();
      this.retryDeadline = setTimeout(
        () =>
          this.fail(
            new Error(
              `${this.channel === "mic" ? "Your voice" : "Call audio"} transcription couldn't reconnect within a minute. Check your internet, then pause and resume.`,
            ),
          ),
        this.retryWindowMs,
      );
    }
    const remaining =
      this.retryWindowMs - (this.clock() - this.recoveryStartedAt);
    if (remaining <= 0) {
      this.fail(
        new Error(
          "Transcription could not reconnect. Check your internet, then pause and resume.",
        ),
      );
      return;
    }
    const delayMs = Math.min(
      this.retryMaxMs,
      this.retryBaseMs * 2 ** Math.min(this.attempt++, 10),
      remaining,
    );
    this.diagnostics("transcription.reconnect", {
      channel: this.channel,
      attempt: this.attempt,
      delayMs,
      code,
    });
    this.onStatus?.("reconnecting");
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.openSocket(), delayMs);
  }
  fail(error) {
    if (this.stopped) return;
    this.markGap(this.retainedBytes / 48);
    this.settle?.(error);
    this.close();
    this.onStatus?.("failed", error);
  }
  close() {
    this.stopped = true;
    this.standby?.close();
    this.delegate?.close();
    this.standby = this.delegate = null;
    this.rotating = false;
    this.settle?.(new Error("Transcription connection cancelled."));
    clearTimeout(this.retryTimer);
    clearTimeout(this.retryDeadline);
    this.detachSocket();
    this.recoveryStartedAt = null;
    this.attempt = 0;
    this.prefix = [];
    this.retained = [];
    this.lost = [];
    this.retainedBytes = 0;
    this.voiceMs = this.silenceMs = 0;
    this.pendingCommits = [];
    this.partial.clear();
    this.starts.clear();
    this.awaitingFinal.clear();
    this.completed.clear();
    this.currentStart = undefined;
  }
}

export function transcriptionOptions(
  model,
  { keywords = [], languages = ["en"], prompt = "", delay = "low" } = {},
) {
  if (!/^gpt-live-transcribe(?:-|$)/.test(model)) return { model };
  return {
    model,
    keywords: [
      ...new Set(
        keywords
          .filter((s) => typeof s === "string" && !/[<>\r\n]/.test(s))
          .map((s) => s.slice(0, 100)),
      ),
    ].slice(0, 60),
    languages: languages
      .filter(
        (s) => typeof s === "string" && /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(s),
      )
      .slice(0, 4),
    prompt: String(prompt).replace(/[<>]/g, "").slice(0, 800),
    delay: ["minimal", "low", "medium", "high"].includes(delay) ? delay : "low",
  };
}
