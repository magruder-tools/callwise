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
  constructor({ apiKey, model = "gpt-live-transcribe", channel, onSegment, onStatus,
    WebSocketClass = WebSocket, connectTimeoutMs = 12000, heartbeatMs = 15000,
    finalTimeoutMs = 45000 }) {
    Object.assign(this, { apiKey, model, channel, onSegment, onStatus,
      WS: WebSocketClass, connectTimeoutMs, heartbeatMs, finalTimeoutMs });
    this.socket = null;
    this.ready = false;
    this.partial = new Map();
    this.starts = new Map();
    this.awaitingFinal = new Map();
    this.completed = new Set();
    this.prefix = [];
    this.voiceMs = this.silenceMs = this.sentMs = 0;
    this.pendingCommits = [];
  }
  async connect() {
    if (!this.apiKey) throw new Error("OpenAI transcription needs an API key. Choose Demo to try the app first.");
    this.close();
    const socket = new this.WS("wss://api.openai.com/v1/realtime?intent=transcription", {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    this.socket = socket;
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(this.connectTimer);
        this.cancelConnect = null;
        if (error) reject(error); else resolve();
      };
      const fail = (status = "error", message = "Transcription interrupted. Check your connection and model access, then resume.") => {
        if (this.socket !== socket) return;
        settle(new Error(`${this.channel}: ${message}`));
        this.close();
        this.onStatus?.(status);
      };
      this.fail = fail;
      this.cancelConnect = () => settle(new Error("Transcription connection cancelled."));
      this.connectTimer = setTimeout(() => fail("error", "Transcription connection timed out."), this.connectTimeoutMs);
      socket.on("open", () => {
        if (this.socket !== socket) return;
        this.send({ type: "session.update", session: { type: "transcription", audio: { input: {
          format: { type: "audio/pcm", rate: 24000 },
          transcription: { model: this.model }, turn_detection: null,
        } } } });
      });
      socket.on("error", () => fail());
      socket.on("close", () => fail("closed", "Transcription connection closed. Resume to reconnect."));
      socket.on("pong", () => { this.lastPong = Date.now(); });
      socket.on("message", (raw) => {
        if (this.socket !== socket) return;
        let e;
        try { e = JSON.parse(String(raw)); } catch { return; }
        if (!e || typeof e !== "object") return;
        if (e.type === "session.updated") {
          if (this.ready) return;
          this.ready = true;
          this.lastPong = Date.now();
          this.watchdog = setInterval(() => {
            if (this.socket !== socket) return;
            if ([...this.awaitingFinal.values()].some(at => Date.now() - at > this.finalTimeoutMs)) {
              fail("error", "A transcript segment did not finish. Session paused to avoid missing speech.");
              return;
            }
            if (typeof socket.ping === "function") {
              if (Date.now() - this.lastPong > this.heartbeatMs * 2.5) {
                fail("error", "The audio connection stopped responding. Resume to reconnect.");
                return;
              }
              try { socket.ping(); } catch { fail(); }
            }
          }, this.heartbeatMs);
          this.watchdog.unref?.();
          settle();
          this.onStatus?.("connected");
          return;
        }
        if (e.type === "error" || e.type === "conversation.item.input_audio_transcription.failed") {
          fail(); return;
        }
        if (typeof e.item_id !== "string" || e.item_id.length > 300 || this.completed.has(e.item_id)) return;
        if (e.type === "input_audio_buffer.committed") {
          this.starts.set(e.item_id, this.pendingCommits.shift() ?? this.currentStart ?? 0);
          this.awaitingFinal.set(e.item_id, Date.now());
        }
        if (e.type === "conversation.item.input_audio_transcription.delta") {
          if (typeof e.delta !== "string") return;
          const text = (this.partial.get(e.item_id) || "") + e.delta;
          if (text.length > 20000) { fail("backpressure"); return; }
          this.partial.set(e.item_id, text);
          this.starts.set(e.item_id, this.starts.get(e.item_id) ?? this.currentStart ?? 0);
          if (!this.awaitingFinal.has(e.item_id)) this.awaitingFinal.set(e.item_id, Date.now());
          this.emitSegment(e.item_id, text, false);
        }
        if (e.type === "conversation.item.input_audio_transcription.completed") {
          if (typeof e.transcript !== "string" || e.transcript.length > 20000) { fail(); return; }
          this.emitSegment(e.item_id, e.transcript, true);
          this.partial.delete(e.item_id);
          this.starts.delete(e.item_id);
          this.awaitingFinal.delete(e.item_id);
          this.completed.add(e.item_id);
          if (this.completed.size > 2000) this.completed.delete(this.completed.values().next().value);
        }
        if (this.awaitingFinal.size > 100) fail("backpressure");
      });
    });
  }
  emitSegment(id, text, final) {
    try {
      this.onSegment?.({ id: `${this.channel}:${id}`, text: text || "",
        speaker: this.channel === "mic" ? "You" : "Other", channel: this.channel,
        startMs: this.starts.get(id) ?? this.currentStart ?? 0, final });
    } catch { this.fail?.("error", "Transcript delivery failed. Resume to reconnect."); }
  }
  push(pcm, elapsedMs = 0) {
    if (!this.ready || this.socket?.readyState !== 1) return;
    const b = Buffer.from(pcm);
    if (!b.length || b.length > 19200 || b.length % 2) return;
    if (this.socket.bufferedAmount > 240000) { this.fail?.("backpressure"); return; }
    const duration = b.length / 48, active = pcmRms(b) > 0.007;
    if (!this.voiceMs && !active) {
      this.prefix.push(b);
      if (this.prefix.length > 3) this.prefix.shift();
      return;
    }
    if (!this.voiceMs) {
      this.currentStart = Math.max(0, elapsedMs - duration - this.prefix.reduce((n, p) => n + p.length / 48, 0));
      for (const pre of this.prefix) this.append(pre);
      this.prefix = [];
    }
    this.append(b);
    this.voiceMs += duration;
    this.silenceMs = active ? 0 : this.silenceMs + duration;
    if ((this.silenceMs >= 600 && this.voiceMs >= 300) || this.voiceMs >= 8000) {
      if (this.pendingCommits.length >= 30) { this.fail?.("backpressure"); return; }
      this.pendingCommits.push(this.currentStart);
      this.send({ type: "input_audio_buffer.commit" });
      this.voiceMs = this.silenceMs = 0;
    }
  }
  append(b) {
    this.send({ type: "input_audio_buffer.append", audio: b.toString("base64") });
    this.sentMs += b.length / 48;
  }
  send(message) {
    if (this.socket?.readyState !== 1) return;
    try { this.socket.send(JSON.stringify(message)); } catch { this.fail?.(); }
  }
  close() {
    this.cancelConnect?.();
    this.cancelConnect = null;
    clearTimeout(this.connectTimer);
    clearInterval(this.watchdog);
    this.ready = false;
    this.prefix = [];
    this.voiceMs = this.silenceMs = 0;
    this.pendingCommits = [];
    this.partial.clear();
    this.starts.clear();
    this.awaitingFinal.clear();
    this.completed.clear();
    this.currentStart = undefined;
    if (this.socket) {
      const s = this.socket; this.socket = null;
      s.removeAllListeners(); s.on("error", () => {});
      if (s.readyState === 0) s.terminate(); else s.close();
    }
  }
}
