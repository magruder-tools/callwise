export class AudioCapture {
  constructor(bridge, onMeter, onError) {
    this.bridge = bridge;
    this.onMeter = onMeter;
    this.onError = onError;
    this.streams = [];
    this.contexts = [];
    this.nodes = [];
    this.active = false;
    this.generation = 0;
    this.meterTimers = [];
  }
  async start() {
    this.stop();
    const generation = ++this.generation;
    this.active = true;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (generation !== this.generation) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      this.streams.push(mic);
      const system = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        systemAudio: "include",
      });
      if (generation !== this.generation) {
        system.getTracks().forEach((t) => t.stop());
        return;
      }
      this.streams.push(system);
      if (!system.getAudioTracks().length)
        throw new Error(
          "No meeting audio track was provided. Choose a source with audio sharing enabled, or use Fireflies/manual transcript mode.",
        );
      // Retain the display track solely to keep audio loopback alive. No video frames are read, stored, or sent.
      for (const track of [...mic.getTracks(), ...system.getTracks()])
        track.addEventListener("ended", () => {
          if (this.active) {
            this.stop();
            this.onError("Audio sharing ended. The session has been paused.");
          }
        });
      await this.wire(mic, "mic", generation);
      await this.wire(
        new MediaStream(system.getAudioTracks()),
        "system",
        generation,
      );
    } catch (error) {
      if (generation === this.generation) {
        this.stop();
        throw error;
      }
    }
  }
  async wire(stream, channel, generation) {
    if (generation !== this.generation) return;
    const ctx = new AudioContext({ sampleRate: 24000 });
    this.contexts.push(ctx);
    await ctx.audioWorklet.addModule("./audio-worklet.js");
    if (generation !== this.generation) return;
    if (ctx.sampleRate !== 24000)
      throw new Error(
        "Audio device did not negotiate 24 kHz capture. Try another input device.",
      );
    const source = ctx.createMediaStreamSource(stream);
    const processor = new AudioWorkletNode(ctx, "callwise-audio");
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
    this.nodes.push(source, processor, mute);
    let heard = false;
    this.meterTimers.push(
      setTimeout(() => {
        if (this.active && !heard)
          this.bridge.captureStatus(channel, "No signal yet — verify audio");
      }, 12000),
    );
    processor.port.onmessage = ({ data }) => {
      if (!this.active || generation !== this.generation) return;
      if (data.rms > 0.007 && !heard) {
        heard = true;
        this.bridge.captureStatus(channel, "receiving");
      }
      this.onMeter(channel, data.rms);
      this.bridge.audio(channel, data.buffer);
    };
    await ctx.resume();
    if (this.active && generation === this.generation) this.bridge.captureStatus(channel, "listening");
  }
  stop() {
    this.generation++;
    this.active = false;
    for (const timer of this.meterTimers) clearTimeout(timer);
    this.meterTimers = [];
    for (const stream of this.streams)
      for (const t of stream.getTracks()) t.stop();
    for (const node of this.nodes) {
      if (node.port) node.port.onmessage = null;
      node.disconnect();
    }
    for (const ctx of this.contexts) void ctx.close().catch(() => {});
    this.streams = [];
    this.nodes = [];
    this.contexts = [];
    for (const channel of ["mic", "system"]) this.onMeter(channel, 0);
  }
}

export function describeAudioCapture(capture = {}) {
  const label = (status) => status === "receiving" ? "receiving" :
    status === "listening" ? "listening" :
    status?.startsWith("No signal") ? "no signal yet" : "starting";
  return `Mic: ${label(capture.mic)} · Computer: ${label(capture.system)}`;
}
