import { coversText } from "./coverage.mjs";
import { createHash } from "node:crypto";
export function matchingEvent(pack, events = []) {
  const start = Date.parse(pack.meetingStart);
  if (!Number.isFinite(start)) return null;
  return events.find((e) => Math.abs(e.start - start) <= 12 * 60 * 60 * 1000 && (coversText(pack.title, e.title) || coversText(e.title, pack.title))) || null;
}
export function preflightState({ enabled = false, packs = [], events = [], readiness = {}, now = Date.now() } = {}) {
  const off = { state: "off", meetingTitle: null, startsAt: null, reasons: [] };
  if (!enabled) return off;
  const upcoming = packs.filter((p) => p.meetingStart && Date.parse(p.meetingStart) >= now - 15 * 60000).sort((a, b) => Date.parse(a.meetingStart) - Date.parse(b.meetingStart));
  const pack = upcoming[0], event = [...events].filter((e) => e.start >= now - 15 * 60000).sort((a, b) => a.start - b.start)[0];
  const start = pack ? Date.parse(pack.meetingStart) : event?.start;
  if (!Number.isFinite(start) || start - now > 12 * 3600000) return off;
  const reasons = [];
  if (!readiness.mic) reasons.push("Microphone permission needs attention");
  if (!readiness.system) reasons.push("Call audio needs attention");
  if (!readiness.speech) reasons.push("Local speech needs attention");
  if (readiness.liveHelp && !readiness.key) reasons.push("Live help connection needs attention");
  if (!pack?.approved) reasons.push("No approved cards");
  if (pack?.gaps) reasons.push(`${pack.gaps} open ${pack.gaps === 1 ? "gap" : "gaps"}`);
  return { state: reasons.length ? "attention" : "ready", meetingTitle: pack?.title || event.title, startsAt: new Date(start).toISOString(), reasons };
}
export class Preflight {
  constructor({ notify = () => {}, open = () => {}, clock = Date.now, onNotified = () => {} } = {}) { Object.assign(this, { notify, open, clock, onNotified }); this.notified = new Set(); this.state = preflightState(); }
  update(input) {
    this.state = preflightState({ ...input, now: this.clock() });
    const key = createHash("sha256").update(`${this.state.meetingTitle}|${this.state.startsAt}`).digest("hex"), until = Date.parse(this.state.startsAt) - this.clock();
    if (this.state.state === "attention" && until >= 0 && until <= 5 * 60000 && !this.notified.has(key)) {
      this.notified.add(key); this.onNotified([...this.notified].slice(-100)); this.notify(this.state, () => this.open(this.state));
    }
    return this.state;
  }
}
