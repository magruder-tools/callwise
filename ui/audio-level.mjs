// Shared by capture meters and the trusted transcriber. Calibrate from quiet samples.
export class AdaptiveVoice {
  constructor() {
    this.samples = [];
    this.elapsed = 0;
    this.floor = 0.001;
  }
  update(rms, duration = 100) {
    if (!Number.isFinite(rms)) return false;
    this.elapsed += duration;
    if (this.elapsed <= 1000) {
      this.samples.push(rms);
      const sorted = [...this.samples].sort((a, b) => a - b);
      this.floor = Math.min(
        0.007,
        sorted[Math.floor((sorted.length - 1) * 0.2)] || 0.001,
      );
    }
    const threshold = Math.max(0.004, this.floor * 2.5);
    const active = rms > threshold;
    if (!active && this.elapsed > 1000)
      this.floor = this.floor * 0.995 + Math.min(0.012, rms) * 0.005;
    return active;
  }
}
