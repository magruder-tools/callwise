import { execFile } from "node:child_process";
import path from "node:path";
import { LocalEmbedding } from "./local-embedding.mjs";
import { PackInbox } from "./pack-import.mjs";
import { AppleSpeechSession } from "../providers/apple-speech.mjs";
import { matchingEvent } from "../core/preflight.mjs";

export function installRound3({ controller: c, native, paths, store, getWindow, send, dialog, clipboard, app, Tray, Menu, nativeImage, Notification, smoke = false, getNotified = () => [], saveNotified = () => {} }) {
  const embedding = new LocalEmbedding({ native, resources: paths.resources });
  c.round3.preflight.notified = new Set(getNotified().filter((s) => /^[a-f0-9]{64}$/.test(s)).slice(-100));
  c.round3.preflight.onNotified = saveNotified;
  let transcriber, speech, startedAt, tts, tray, calendarAt = 0, events = [], closed = false;
  const stopListening = async () => {
    // Rehearsal audio is never passed to controller.audio or MeetingService.
    send("callwise:stop-rehearsal-capture"); transcriber?.close(); speech?.close(); transcriber = speech = null;
  };
  const inbox = new PackInbox({ bank: c.round3.bank, onError: (error) => c.engine.error(error.message, { condition: "prep-watch", lifetimeMs: 15000 }),
    onChange: (state) => { c.round3.watchFolder = { ...state }; c.engine.emitState(); } });
  const open = (preflight) => {
    const matching = c.round3.bank.list().find((p) => p.title === preflight.meetingTitle && p.meetingStart === preflight.startsAt);
    if (matching?.attachedMeetingId && c.meetingService?.get("meetings", matching.attachedMeetingId)) c.meetingService.selectedId = matching.attachedMeetingId;
    else if (matching) c.round3.bank.openId = matching.id;
    getWindow()?.show(); send("callwise:navigate", { screen: "ready" }); c.engine.emitState();
  };
  if (!smoke) void c.round3.attach({ store, embed: (texts) => embedding.embed(texts), open,
    notify: (state, onClick) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title: `Callwise: ${state.meetingTitle}`, body: state.reasons.join(" · "), silent: true });
      notification.once("click", onClick); notification.show();
    }, rehearsal: {
      speak: (text) => new Promise((resolve, reject) => { tts = execFile("/usr/bin/say", ["--", text], { timeout: 60000 }, (error) => { tts = null; error && !error.killed ? reject(new Error("System speech could not read the rehearsal question.")) : resolve(); }); }),
      stopSpeech: () => { tts?.kill(); tts = null; }, stopListening,
      startListening: async (onSegment) => {
        speech = new AppleSpeechSession({ ...paths, channels: ["mic"], language: c.preferences.language || "en-US" });
        transcriber = speech.adapter({ channel: "mic", onSegment, onDiscard: () => {}, onStatus: (status) => { if (["error", "failed"].includes(status)) { void c.round3.rehearsal.stop(); c.engine.error("Rehearsal microphone stopped. Your meeting library was not changed."); } } });
        startedAt = Date.now(); await transcriber.connect();
        send("callwise:start-rehearsal-capture", { inputDevice: c.preferences.inputDevice || "" });
      },
    } }).catch((error) => c.engine.error(error.message, { condition: "offline-matcher" }));
  const tick = async () => {
    if (closed || smoke) return;
    await c.round3.refresh();
    c.round3.modelName = embedding.model || "Offline sentence model";
    const prefs = c.preferences;
    if (prefs.preflightEnabled && prefs.calendarWatching && Date.now() - calendarAt > 60000) {
      calendarAt = Date.now();
      try { events = await native.run("calendar", { onlyGranted: true, horizonHours: 12 }, { timeout: 5000 }); }
      catch { events = []; } // Never request calendar permission during a background check.
    }
    if (!prefs.calendarWatching) events = events.filter((e) => e.start >= Date.now() - 15 * 60000 && e.start <= Date.now() + 12 * 3600000);
    c.round3.attachOffers = c.round3.bank.list().flatMap((p) => { const event = matchingEvent(p, events); return event && !p.attachedMeetingId ? [{ packId: p.id, event }] : []; });
    const readiness = c.desktopState?.readiness || {};
    const readinessPacks = c.round3.bank.list().map((p) => ({ ...p, approved: c.round3.bank.record(p.id)?.active?.cards.filter((card) => card.status === "approved").length || p.approved }));
    const state = c.round3.preflight.update({ enabled: prefs.preflightEnabled === true, packs: readinessPacks, events,
      readiness: { mic: readiness.mic, system: readiness.system, speech: readiness.core, key: readiness.ai || c.strategyBackend === "codex", liveHelp: prefs.liveHelp } });
    if (state.state === "off" || ["running", "paused", "finishing"].includes(c.engine.status)) { tray?.destroy(); tray = null; }
    else {
      if (!tray) {
        const icon = nativeImage.createFromBuffer(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><path d="M3 7v4M7 3v12M11 5v8M15 8v2" stroke="black" stroke-width="2" stroke-linecap="round"/></svg>'));
        icon.setTemplateImage(true); tray = new Tray(icon); tray.on("click", () => open(c.round3.preflight.state));
      }
      const label = state.state === "ready" ? "Ready" : "Needs attention";
      tray.setToolTip(`Callwise — ${label}: ${state.meetingTitle}`);
      tray.setContextMenu(Menu.buildFromTemplate([{ label: `${label}: ${state.meetingTitle}`, enabled: false }, ...state.reasons.map((label) => ({ label, enabled: false })), { type: "separator" }, { label: "Open Ready", click: () => open(state) }]));
    }
  };
  const timer = setInterval(() => void tick(), 5000); timer.unref?.();
  if (!smoke && c.preferences.prepWatchEnabled && c.preferences.prepWatchFolder) {
    try { inbox.start(c.preferences.prepWatchFolder); } catch (error) { c.engine.error(error.message); }
  }
  return {
    cacheCalendar(values) { if (Array.isArray(values)) events = values; void tick(); },
    audio(channel, bytes) { if (channel === "mic" && c.round3.rehearsal.state.status === "listening") { transcriber?.push(bytes, Date.now() - startedAt); return true; } return false; },
    handles(name) { return ["desktop.pack.import", "watchFolder.choose", "watchFolder.disable", "prep.copyPrompt", "preflight.open", "pack.attachCalendar"].includes(name); },
    async command(name, p = {}) {
      if (name === "prep.copyPrompt") { const result = await c.round3.command(name, p); clipboard.writeText(result.text); return { copied: true }; }
      if (name === "preflight.open") return open(c.round3.preflight.state);
      if (name === "watchFolder.disable") { inbox.close(); c.rememberPreferences({ prepWatchEnabled: false }); return { ...inbox.state }; }
      if (name === "watchFolder.choose") {
        const selected = await dialog.showOpenDialog(getWindow(), { title: "Choose your Callwise Prep folder", defaultPath: c.preferences.prepWatchFolder || path.join(app.getPath("documents"), "Callwise Prep"), properties: ["openDirectory", "createDirectory"] });
        if (selected.canceled) return { cancelled: true };
        inbox.start(selected.filePaths[0]); c.rememberPreferences({ prepWatchFolder: selected.filePaths[0], prepWatchEnabled: true }); return { ...inbox.state };
      }
      if (name === "pack.attachCalendar") {
        const offer = c.round3.attachOffers?.find((o) => o.packId === p.packId && o.event.id === p.eventId);
        if (!offer) throw new Error("Calendar match is no longer available.");
        c.round3.selectedPrepMeeting = { title: offer.event.title, people: offer.event.people, start: new Date(offer.event.start).toISOString(), packId: p.packId };
        getWindow()?.show(); send("callwise:navigate", { screen: "ready", prepMeeting: c.round3.selectedPrepMeeting });
        return c.round3.selectedPrepMeeting;
      }
      const selected = p.paths ? { filePaths: p.paths, canceled: false } : await dialog.showOpenDialog(getWindow(), { title: "Add a Callwise prep pack", properties: ["openFile", "openDirectory", "multiSelections"], filters: [{ name: "Prep packs", extensions: ["zip", "json"] }] });
      if (selected.canceled) return { cancelled: true };
      if (!Array.isArray(selected.filePaths) || selected.filePaths.length > 20 || selected.filePaths.some((s) => typeof s !== "string" || !path.isAbsolute(s) || s.length > 4096)) throw new Error("Choose valid prep pack paths.");
      const imported = selected.filePaths.map((filename) => inbox.import(filename));
      // A user-initiated import can offer an existing calendar match; it never prompts for access.
      try { events = await native.run("calendar", { onlyGranted: true, horizonHours: 12 }, { timeout: 5000 }); } catch { /* Calendar access remains optional. */ }
      await tick(); c.engine.emitState(); return { imported };
    },
    tick,
    close() { closed = true; clearInterval(timer); inbox.close(); embedding.close(); tts?.kill(); void stopListening(); tray?.destroy(); },
  };
}
