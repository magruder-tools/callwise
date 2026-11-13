import { coversText } from "./coverage.mjs";
export class Rehearsal {
  constructor({ bank, speak = async () => {}, stopSpeech = () => {}, startListening = async () => {}, stopListening = async () => {}, onChange = () => {} } = {}) {
    Object.assign(this, { bank, speak, stopSpeech, startListening, stopListening, onChange }); this.state = this.empty(); this.epoch = 0;
  }
  empty() { return { status: "idle", packId: null, index: 0, total: 0, question: null, cues: [], results: [] }; }
  snapshot() { return structuredClone(this.state); }
  async start(packId) {
    await this.stop();
    const record = this.bank.record(packId), pack = record?.active || record?.pack;
    this.cards = pack?.cards.filter((c) => c.status === "approved") || [];
    if (!this.cards.length) throw new Error("Approve at least one card before rehearsal.");
    this.state = { ...this.empty(), packId, total: this.cards.length }; this.transcript = new Map();
    await this.ask();
  }
  async ask() {
    const epoch = ++this.epoch, c = this.cards[this.state.index];
    if (!c) { this.state.status = "done"; await this.stopListening(); this.onChange(); return; }
    await this.stopListening(); this.transcript.clear();
    this.state = { ...this.state, status: "asking", question: c.questions[0], cues: c.cues.map((c) => ({ text: c.text, covered: false })) };
    this.onChange();
    await this.speak(c.questions[0]);
    if (epoch !== this.epoch) return;
    this.state.status = "listening"; this.onChange();
    try { await this.startListening((row) => this.ingest(row)); }
    catch (error) { await this.stop(); throw error; }
  }
  ingest(row) {
    if (this.state.status !== "listening" || row.channel !== "mic" || row.gap) return;
    this.transcript.set(row.id, row.text);
    const answer = [...this.transcript.values()].join(" ");
    for (const c of this.state.cues) c.covered = coversText(c.text, answer);
    this.onChange();
  }
  async next() {
    if (!["listening", "between"].includes(this.state.status)) return;
    this.state.status = "between"; await this.stopListening();
    this.state.results.push({ question: this.state.question, covered: this.state.cues.filter((c) => c.covered).length, total: this.state.cues.length });
    this.state.index++; await this.ask();
  }
  async repeat() { if (["asking", "listening", "between"].includes(this.state.status)) { this.stopSpeech(); await this.ask(); } }
  async stop() { ++this.epoch; this.stopSpeech(); await this.stopListening(); this.state = this.empty(); this.transcript?.clear(); this.onChange(); }
}
