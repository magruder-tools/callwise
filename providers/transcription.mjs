import WebSocket from "ws";
export function pcmRms(buffer) {
  let sum = 0;
  const n = Math.floor(buffer.length / 2);
  for (let i = 0; i < n; i++) {
    const x = buffer.readInt16LE(i * 2) / 32768;
    sum += x * x;
  }
  return n ? Math.sqrt(sum / n) : 0;
}
export class LiveTranscriber {
  constructor({
    apiKey,
    model = "gpt-live-transcribe",
    channel,
    onSegment,
    onStatus,
    WebSocketClass = WebSocket,
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.channel = channel;
    this.onSegment = onSegment;
    this.onStatus = onStatus;
    this.WS = WebSocketClass;
    this.socket = null;
    this.ready = false;
    this.partial = new Map();
    this.starts = new Map();
    this.prefix = [];
    this.voiceMs = 0;
    this.silenceMs = 0;
    this.sentMs = 0;
    this.pendingCommits = [];
  }
  async connect() {
    if (!this.apiKey)
      throw new Error(
        "OpenAI transcription needs an API key. Choose Demo to try the app first.",
      );
    const socket = new this.WS(
      "wss://api.openai.com/v1/realtime?intent=transcription",
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
    );
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
        reject(
          new Error(`${this.channel}: transcription connection timed out.`),
        );
      }, 12000);
      this.cancelConnect = () => {
        clearTimeout(timer);
        reject(new Error("Transcription connection cancelled."));
      };
      const fail = () => {
        clearTimeout(timer);
        this.cancelConnect = null;
        this.onStatus?.("error");
        reject(
          new Error(
            `${this.channel}: transcription connection failed. Check your API access.`,
          ),
        );
      };
      socket.on("open", () =>
        socket.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "transcription",
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: 24000 },
                  transcription: { model: this.model },
                  turn_detection: null,
                },
              },
            },
          }),
        ),
      );
      socket.on("error", fail);
      socket.on("close", () => {
        this.ready = false;
        this.onStatus?.("closed");
      });
      socket.on("message", (raw) => {
        let e;
        try {
          e = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (e.type === "session.updated") {
          clearTimeout(timer);
          this.cancelConnect = null;
          this.ready = true;
          this.onStatus?.("connected");
          resolve();
        }
        if (e.type === "error") {
          fail();
          return;
        }
        if (e.type === "input_audio_buffer.committed")
          this.starts.set(
            e.item_id,
            this.pendingCommits.shift() ?? this.currentStart ?? 0,
          );
        if (e.type === "conversation.item.input_audio_transcription.delta") {
          this.partial.set(
            e.item_id,
            (this.partial.get(e.item_id) || "") + (e.delta || ""),
          );
          this.starts.set(
            e.item_id,
            this.starts.get(e.item_id) ?? this.currentStart ?? 0,
          );
          this.emitSegment(e.item_id, this.partial.get(e.item_id), false);
        }
        if (
          e.type === "conversation.item.input_audio_transcription.completed"
        ) {
          this.emitSegment(e.item_id, e.transcript, true);
          this.partial.delete(e.item_id);
          this.starts.delete(e.item_id);
        }
      });
    });
  }
  emitSegment(id, text, final) {
    this.onSegment({
      id: `${this.channel}:${id}`,
      text: text || "",
      speaker: this.channel === "mic" ? "You" : "Other",
      channel: this.channel,
      startMs: this.starts.get(id) ?? this.currentStart ?? 0,
      final,
    });
  }
  push(pcm, elapsedMs = 0) {
    if (!this.ready || this.socket?.readyState !== 1) return;
    const b = Buffer.from(pcm);
    if (!b.length || b.length > 19200 || b.length % 2) return;
    if (this.socket.bufferedAmount > 240000) {
      this.onStatus?.("backpressure");
      return;
    }
    const duration = b.length / 48,
      active = pcmRms(b) > 0.007;
    if (!this.voiceMs && !active) {
      this.prefix.push(b);
      if (this.prefix.length > 3) this.prefix.shift();
      return;
    }
    if (!this.voiceMs) {
      this.currentStart = Math.max(
        0,
        elapsedMs -
          duration -
          this.prefix.reduce((n, p) => n + p.length / 48, 0),
      );
      for (const pre of this.prefix) this.append(pre);
      this.prefix = [];
    }
    this.append(b);
    this.voiceMs += duration;
    this.silenceMs = active ? 0 : this.silenceMs + duration;
    if (
      (this.silenceMs >= 600 && this.voiceMs >= 300) ||
      this.voiceMs >= 8000
    ) {
      this.pendingCommits.push(this.currentStart);
      if (this.pendingCommits.length > 30) {
        this.onStatus?.("backpressure");
        return;
      }
      this.send({ type: "input_audio_buffer.commit" });
      this.voiceMs = 0;
      this.silenceMs = 0;
    }
  }
  append(b) {
    this.send({
      type: "input_audio_buffer.append",
      audio: b.toString("base64"),
    });
    this.sentMs += b.length / 48;
  }
  send(message) {
    if (this.socket?.readyState === 1)
      this.socket.send(JSON.stringify(message));
  }
  close() {
    this.cancelConnect?.();
    this.cancelConnect = null;
    this.ready = false;
    this.prefix = [];
    this.voiceMs = 0;
    this.silenceMs = 0;
    this.pendingCommits = [];
    this.partial.clear();
    this.starts.clear();
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      s.removeAllListeners();
      s.on("error", () => {});
      if (s.readyState === 0) s.terminate();
      else s.close();
    }
  }
}
