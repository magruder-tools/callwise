// Adapted from Cue's renderer/audio-worklet-processor.js.
// Copyright Cue contributors. GPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
// Changes: 100 ms packets, stereo downmix, RMS meter, reusable buffers.
class CallwiseAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2400);
    this.index = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.[0]) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      this.buffer[this.index++] = value / channels.length;
      if (this.index === this.buffer.length) this.flush();
    }
    return true;
  }
  flush() {
    const pcm = new Int16Array(this.index);
    let sum = 0;
    for (let i = 0; i < this.index; i++) {
      const s = Math.max(-1, Math.min(1, this.buffer[i]));
      pcm[i] = s < 0 ? s * 32768 : s * 32767;
      sum += s * s;
    }
    this.port.postMessage(
      { buffer: pcm.buffer, rms: Math.sqrt(sum / this.index) },
      [pcm.buffer],
    );
    this.index = 0;
  }
}
registerProcessor("callwise-audio", CallwiseAudioProcessor);
