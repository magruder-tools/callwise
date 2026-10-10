import { AdaptiveVoice } from "./audio-level.mjs";
export class AudioCapture {
  constructor(bridge, onMeter, onError, onNotice = () => {}) {
    Object.assign(this, { bridge, onMeter, onError, onNotice });
    this.channels = new Map();
    this.generation = 0;
    this.active = false;
    this.deviceChange = () => {
      for (const channel of this.channels.keys()) void this.recover(channel);
    };
  }
  async devices() {
    return (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "audioinput",
    );
  }
  async start({ inputDevice = "", channels = ["mic", "system"] } = {}) {
    this.stop();
    const generation = ++this.generation;
    this.active = true;
    this.inputDevice = inputDevice;
    navigator.mediaDevices.addEventListener("devicechange", this.deviceChange);
    try {
      for (const channel of channels) {
        try {
          await this.acquire(channel, generation);
        } catch (error) {
          error.channel = channel;
          throw error;
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.stop();
        throw error;
      }
    }
  }
  async acquire(channel, generation, defaultDevice = false) {
    const stream =
      channel === "mic"
        ? await navigator.mediaDevices.getUserMedia({
            audio: {
              ...(this.inputDevice && !defaultDevice
                ? { deviceId: { exact: this.inputDevice } }
                : {}),
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          })
        : await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 1 },
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            systemAudio: "include",
          });
    if (!this.active || generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        "Callwise can't hear the call audio. Run the sound check in Settings.",
      );
    }
    // Electron's display-media contract requires a video track. No video frames are read.
    const record = {
      stream,
      ctx: new AudioContext({ sampleRate: 24000 }),
      nodes: [],
      generation,
      recovering: false,
      heard: false,
    };
    this.release(channel);
    this.channels.set(channel, record);
    for (const track of stream.getTracks())
      track.addEventListener("ended", () => {
        if (this.active && this.channels.get(channel) === record)
          void this.recover(channel);
      });
    await record.ctx.audioWorklet.addModule("./audio-worklet.js");
    if (
      !this.active ||
      generation !== this.generation ||
      this.channels.get(channel) !== record
    ) {
      this.release(channel);
      return;
    }
    if (record.ctx.sampleRate !== 24000)
      throw new Error("Choose an audio input that supports 24 kHz capture.");
    const audioStream = new MediaStream(stream.getAudioTracks()),
      source = record.ctx.createMediaStreamSource(audioStream),
      processor = new AudioWorkletNode(record.ctx, "callwise-audio"),
      mute = record.ctx.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(record.ctx.destination);
    record.nodes = [source, processor, mute];
    const voice = new AdaptiveVoice();
    let heard = false;
    record.timer = setTimeout(() => {
      if (this.active && !heard)
        this.bridge.captureStatus(channel, "No signal yet — verify audio");
    }, 15000);
    processor.port.onmessage = ({ data }) => {
      if (
        !this.active ||
        generation !== this.generation ||
        this.channels.get(channel) !== record
      )
        return;
      if (voice.update(data.rms) && !heard) {
        heard = true;
        record.heard = true;
        this.bridge.captureStatus(channel, "receiving");
      }
      this.onMeter(channel, data.rms);
      this.bridge.audio(channel, data.buffer);
    };
    await record.ctx.resume();
    this.bridge.captureStatus(channel, "listening");
  }
  async recover(channel) {
    const record = this.channels.get(channel);
    if (!this.active || !record || record.recovering) return;
    if (
      channel === "mic" &&
      record.stream.getAudioTracks().every((t) => t.readyState === "live")
    ) {
      const devices = await this.devices().catch(() => []);
      const id = record.stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (devices.some((d) => d.deviceId === id)) return;
    }
    record.recovering = true;
    const generation = this.generation;
    this.bridge.captureStatus(channel, "reconnecting");
    try {
      try {
        await this.acquire(channel, generation);
      } catch (error) {
        if (channel !== "mic" || !this.active || generation !== this.generation)
          throw error;
        await this.acquire(channel, generation, true);
      }
      if (this.active && generation === this.generation) {
        const name =
          this.channels.get(channel)?.stream.getAudioTracks()[0]?.label ||
          "the default audio device";
        this.onNotice(`Switched to ${name}.`);
      }
    } catch (error) {
      if (this.active && generation === this.generation) {
        this.release(channel);
        this.bridge.captureStatus(channel, "failed");
        this.onError(
          error.message ||
            "Audio couldn't reconnect. Check the device and retry.",
          channel,
        );
      }
    }
  }
  async retry(channel) {
    if (!this.active) return;
    try {
      await this.acquire(channel, this.generation);
    } catch (error) {
      this.bridge.captureStatus(channel, "failed");
      this.onError(error.message, channel);
    }
  }
  release(channel) {
    const r = this.channels.get(channel);
    if (!r) return;
    this.channels.delete(channel);
    clearTimeout(r.timer);
    for (const t of r.stream.getTracks()) t.stop();
    for (const n of r.nodes) {
      if (n.port) n.port.onmessage = null;
      try {
        n.disconnect();
      } catch {}
    }
    void r.ctx.close().catch(() => {});
  }
  stop() {
    this.active = false;
    this.generation++;
    navigator.mediaDevices?.removeEventListener(
      "devicechange",
      this.deviceChange,
    );
    for (const channel of [...this.channels.keys()]) this.release(channel);
    for (const channel of ["mic", "system"]) this.onMeter(channel, 0);
  }
}
export function describeAudioCapture(capture = {}) {
  const label = (s) =>
    s === "receiving"
      ? "receiving"
      : s === "reconnecting"
        ? "reconnecting"
        : s === "failed"
          ? "transcription stopped"
          : s === "listening"
            ? "listening"
            : s?.startsWith("No signal")
              ? "no signal yet"
              : "starting";
  return `Mic: ${label(capture.mic)} · Computer: ${label(capture.system)}`;
}
