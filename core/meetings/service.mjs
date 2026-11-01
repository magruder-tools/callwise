import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { confirmNotice, noticeHash, noticeText } from "./notice.mjs";
import { LocalDocuments, mergeActions } from "./recaps.mjs";
import { stableSpeakerTurns, assignSpeakers } from "./speakers.mjs";
const signature = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const WRITABLE = ["title", "people"];
export class MeetingService extends EventEmitter {
  constructor({
    store,
    native,
    search,
    recorder,
    diarizer,
    clock = Date.now,
  } = {}) {
    super();
    Object.assign(this, { store, native, search, recorder, diarizer, clock });
    this.documents = new LocalDocuments(native);
    this.jobs = new Map();
    this.cachedRows = new Map();
    this.pendingWrites = new Map();
    this.selectedId = null;
    this.activeId = null;
    this.warning = "";
    this.libraryRevision = 0;
    this.memory = new Map();
    this.lastDraftSave = 0;
    this.lastHeaderSave = 0;
    this.lastLibrary = null;
    this.finishingConsumers = new Set();
    this.recordCache = new Map();
  }
  attach(controller) {
    this.controller = controller;
    controller.on("state", (s) => this.observe(s));
    this.on("state", () => controller.engine.emitState());
    this.wireConsumers(this.recorder, this.diarizer);
    const resume = setTimeout(() => {
      if (!this.closed)
        for (const job of this.all("jobs"))
          if (
            job.status === "queued" &&
            ["recap", "enhance"].includes(job.id) &&
            this.get("meetings", job.meetingId)
          )
            void this.generate(job.meetingId, job.id);
    }, 250);
    resume.unref?.();
  }
  wireConsumers(recorder, diarizer) {
    if (recorder)
      recorder.on("error", () => {
        if (this.closed) return;
        this.warning =
          "Audio recording could not be saved. The transcript and notes continue.";
        this.emit("state");
      });
    recorder?.on("chunk", (record) => {
      if (this.closed) return;
      const id = recorder.meetingId;
      this.cacheRecord("audio_chunks", id, {
        ...record,
        meetingId: id,
        id: `${record.channel}:${record.sequence}`,
      });
      this.invalidate();
      this.emit("state");
    });
    diarizer?.on(
      "turns",
      (result) =>
        !this.closed && this.applyTurns(result.meetingId, result.turns),
    );
    diarizer?.on("warning", () => {
      if (this.closed) return;
      this.warning =
        "Group speaker identification is unavailable. You and Them labels still work.";
      this.emit("state");
    });
  }
  get(table, meetingId, id = meetingId) {
    if (this.memory.has(`${table}:${meetingId}:${id}`))
      return this.memory.get(`${table}:${meetingId}:${id}`);
    const pending = this.pendingWrites.get(`${table}:${meetingId}:${id}`);
    if (pending) return pending.value;
    const cached =
      this.recordCache
        .get(`${table}|${meetingId}`)
        ?.get(`${meetingId}:${id}`) ||
      this.recordCache.get(`${table}|*`)?.get(`${meetingId}:${id}`);
    if (cached) return cached;
    return this.unsavedMeeting !== meetingId && this.store
      ? this.store.get(table, meetingId, id)
      : this.memory.get(`${table}:${meetingId}:${id}`) || null;
  }
  all(table, meetingId) {
    const group = `${table}|${meetingId || "*"}`;
    if (this.recordCache.has(group))
      return [...this.recordCache.get(group).values()];
    const memory = [...this.memory.entries()]
      .filter(
        ([key]) =>
          key.startsWith(`${table}:`) &&
          (!meetingId || key.startsWith(`${table}:${meetingId}:`)),
      )
      .map(([, v]) => structuredClone(v));
    const base = this.store
      ? [
          ...(meetingId === this.unsavedMeeting
            ? []
            : this.store.all(table, meetingId)),
          ...memory,
        ]
      : memory;
    const records = new Map(base.map((r) => [`${r.meetingId}:${r.id}`, r]));
    for (const pending of this.pendingWrites.values())
      if (
        pending.table === table &&
        (!meetingId || pending.meetingId === meetingId)
      )
        records.set(`${pending.meetingId}:${pending.id}`, pending.value);
    this.recordCache.set(group, records);
    // Bound decrypted working sets; search has its own worker-owned index.
    while (this.recordCache.size > 48)
      this.recordCache.delete(this.recordCache.keys().next().value);
    return [...records.values()];
  }
  cacheRecord(table, meetingId, record) {
    for (const group of [`${table}|${meetingId}`, `${table}|*`])
      this.recordCache.get(group)?.set(`${meetingId}:${record.id}`, record);
    return record;
  }
  clearCache() {
    this.recordCache.clear();
    this.invalidate();
  }
  put(table, meetingId, id, value, expected) {
    if (
      !this.store ||
      this.unsavedMeeting === meetingId ||
      this.memory.has(`meetings:${meetingId}:${meetingId}`)
    ) {
      const prior = this.memory.get(`${table}:${meetingId}:${id}`);
      if (expected !== undefined && (prior?.revision || 0) !== expected)
        throw new Error("This meeting changed. Refresh before saving.");
      const record = {
        ...value,
        meetingId,
        id,
        revision: (prior?.revision || 0) + 1,
      };
      this.memory.set(`${table}:${meetingId}:${id}`, record);
      return this.cacheRecord(table, meetingId, record);
    }
    try {
      return this.cacheRecord(
        table,
        meetingId,
        this.store.put(table, meetingId, id, value, expected),
      );
    } catch (e) {
      if (!/SQLITE_FULL|disk|ENOSPC/i.test(`${e.code} ${e.message}`)) throw e;
      const key = `${table}:${meetingId}:${id}`;
      const previous = this.get(table, meetingId, id);
      const record = {
        ...value,
        meetingId,
        id,
        revision: (previous?.revision || 0) + 1,
      };
      const entry = { table, meetingId, id, value: record };
      this.pendingWrites.set(key, entry);
      const bytes = [...this.pendingWrites.values()].reduce(
        (n, r) => n + JSON.stringify(r.value).length * 2,
        0,
      );
      if (bytes > 50 * 1024 * 1024) {
        this.pendingWrites.delete(key);
        this.warning =
          "The disk is full and the unsaved buffer is full. End this meeting and export its notes now.";
      } else
        this.warning =
          "The disk is full. Recent notes and transcript are in memory; free space or export before closing Callwise.";
      if (!this.retryTimer) {
        this.retryTimer = setInterval(() => this.retryWrites(), 10000);
        this.retryTimer.unref?.();
      }
      return this.cacheRecord(table, meetingId, record);
    }
  }
  retryWrites() {
    for (const [key, r] of this.pendingWrites) {
      try {
        this.cacheRecord(
          r.table,
          r.meetingId,
          this.store.put(r.table, r.meetingId, r.id, r.value),
        );
        this.pendingWrites.delete(key);
      } catch {
        break;
      }
    }
    if (!this.pendingWrites.size) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
      this.warning = "";
      this.emit("state");
    }
  }
  library() {
    if (this.lastLibrary) return this.lastLibrary;
    return (this.lastLibrary = this.all("meetings")
      .filter((m) => m.status !== "draft")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 300)
      .map((m) => ({
        ...m,
        openActions: this.all("actions", m.id).filter(
          (a) => a.state !== "dismissed" && !a.completed,
        ).length,
      })));
  }
  invalidate() {
    this.lastLibrary = null;
    this.libraryRevision++;
    this.search?.invalidate();
  }
  begin({
    preferences = {},
    title,
    people,
    groupCall = false,
    prior = [],
    notice,
    captureMode = "transcribe",
    source = preferences.preferredSource || "audio",
    withoutSaving = false,
  } = {}) {
    if (
      this.activeId &&
      this.get("meetings", this.activeId)?.status !== "ended"
    )
      return this.get("meetings", this.activeId);
    if (!this.store && !withoutSaving)
      throw new Error(
        "The library is locked. Unlock your keychain, or explicitly choose Start without saving.",
      );
    if (
      withoutSaving &&
      preferences.retainAudio &&
      captureMode !== "notes-only"
    )
      throw new Error(
        "Turn off retained audio or unlock the library before starting without saving.",
      );
    const confirmed =
      captureMode === "notes-only"
        ? null
        : confirmNotice(
            { ...preferences, preferredSource: source },
            notice,
            this.clock(),
          );
    const id = randomUUID(),
      now = this.clock();
    if (withoutSaving) this.unsavedMeeting = id;
    const header = this.put("meetings", id, id, {
      title: text(title, 200) || "Untitled meeting",
      titleSource: title ? "user" : "auto",
      people: Array.isArray(people)
        ? people
            .filter((p) => typeof p === "string")
            .map((p) => p.slice(0, 100))
            .slice(0, 30)
        : [],
      language: preferences.language || "en-US",
      groupCall: groupCall === true,
      prior: prior
        .slice(0, 3)
        .filter((p) => this.get("meetings", p)?.status === "ended"),
      liveHelp: preferences.liveHelp === true,
      retainAudio:
        preferences.retainAudio === true &&
        captureMode !== "notes-only" &&
        source === "audio",
      engine: source === "audio" ? preferences.speechEngine || "apple" : source,
      captureMode,
      captureEpoch: 0,
      notice: confirmed,
      createdAt: now,
      startedAt: now,
      durationMs: 0,
      status: "running",
      contentRevision: 0,
      saving: !withoutSaving,
    });
    this.put("docs", id, "notes:original", {
      text: "",
      lineTimes: [],
      version: 0,
    });
    for (const [key, label] of [
      ["you", "You"],
      ["them", "Them"],
    ])
      this.put("speakers", id, key, { label, confirmed: false });
    this.activeId = this.selectedId = id;
    this.activeSessionId = this.controller?.engine.sessionId;
    this.cachedRows.clear();
    this.invalidate();
    this.event(id, "meeting.started", { notice: confirmed });
    this.recorder?.start({
      meetingId: id,
      enabled: header.retainAudio,
      store: withoutSaving ? null : this.store,
    });
    if (header.groupCall && captureMode !== "notes-only" && source === "audio")
      this.diarizer?.start({ meetingId: id });
    return header;
  }
  event(id, kind, data = {}) {
    this.put("events", id, randomUUID(), { ...data, kind, at: this.clock() });
  }
  migrateSheets(sheets) {
    if (!this.store) return;
    for (const sheet of sheets)
      for (const recap of sheet.history || []) {
        const id = `legacy:${signature([sheet.id, recap.at]).slice(0, 40)}`;
        if (this.get("meetings", id)) continue;
        const createdAt =
          Date.parse(recap.at) || sheet.updatedAt || this.clock();
        this.put("meetings", id, id, {
          title: sheet.name || "Carried recap",
          titleSource: "user",
          people: [],
          status: "ended",
          createdAt,
          endedAt: createdAt,
          durationMs: 0,
          captureMode: "legacy",
          engine: "legacy",
          retainAudio: false,
          saving: true,
          contentRevision: 0,
          importedFrom: "Callwise 0.4 carried recap",
        });
        this.put("docs", id, "notes:original", {
          text: recap.recap,
          version: 1,
          lineTimes: [],
          importedFrom: "carried recap",
        });
        this.put("docs", id, "materials", { materials: sheet.materials || [] });
        this.put("docs", id, "recap", {
          engine: "extractive",
          label: "Previously carried recap — imported from Callwise 0.4",
          summary: [{ id: randomUUID(), text: recap.recap, refs: [] }],
          decisions: [],
          openQuestions: [],
          actions: [],
          version: 1,
        });
      }
    this.invalidate();
  }
  observe(snapshot) {
    const id = this.activeId;
    if (!id || snapshot.source === "demo" || snapshot.status === "idle") return;
    let m = this.get("meetings", id);
    if (!m || m.status === "ended") return;
    const now = this.clock(),
      seen = new Set();
    let changed = false,
      savedDraft = false;
    for (const row of snapshot.transcript) {
      seen.add(row.id);
      const fingerprint = signature(row);
      if (this.cachedRows.get(row.id) === fingerprint) continue;
      if (!row.final && now - this.lastDraftSave < 2000) continue;
      const saved = this.get("segments", id, row.id);
      // User corrections and speaker overrides survive speech or diarization revisions.
      const next = saved?.edited
        ? { ...row, ...saved }
        : {
            ...row,
            ...(saved?.speakerOverride
              ? {
                  speakerOverride: true,
                  speakerKey: saved.speakerKey,
                  speaker: saved.speaker,
                }
              : {}),
          };
      this.put("segments", id, row.id, next);
      this.cachedRows.set(row.id, fingerprint);
      changed = true;
      if (!row.final) savedDraft = true;
    }
    if (savedDraft) this.lastDraftSave = now;
    for (const rowId of this.cachedRows.keys())
      if (!seen.has(rowId)) {
        if (this.store && this.unsavedMeeting !== id)
          this.store.remove("segments", id, rowId);
        else this.memory.delete(`segments:${id}:${rowId}`);
        this.recordCache.get(`segments|${id}`)?.delete(`${id}:${rowId}`);
        this.cachedRows.delete(rowId);
        changed = true;
      }
    const statusChanged = m.status !== snapshot.status;
    if (changed || statusChanged || now - this.lastHeaderSave > 5000) {
      m = this.put("meetings", id, id, {
        ...m,
        status: snapshot.status,
        durationMs: snapshot.activeTimeMs,
        captureEpoch: this.controller?.captureEpoch || m.captureEpoch,
        contentRevision: (m.contentRevision || 0) + (changed ? 1 : 0),
        ...(snapshot.status === "ended" ? { endedAt: now } : {}),
      });
      this.lastHeaderSave = now;
      this.invalidate();
    }
    if (statusChanged) {
      this.event(id, `capture.${snapshot.status}`, {
        durationMs: snapshot.activeTimeMs,
      });
      if (snapshot.status === "ended") {
        this.put("jobs", id, "recap", {
          status: "queued",
          basedOn: { revision: m.contentRevision },
          queuedAt: now,
        });
        this.put("docs", id, "coaching", {
          cards: snapshot.cards.slice(-300),
          adviceOnly: true,
        });
        const recorder = this.recorder,
          diarizer = this.diarizer;
        // A following meeting gets new consumers while this meeting finishes independently.
        if (recorder) this.recorder = new recorder.constructor();
        if (diarizer) this.diarizer = new diarizer.constructor(diarizer.paths);
        this.wireConsumers(this.recorder, this.diarizer);
        const finishing = { recorder, diarizer };
        this.finishingConsumers.add(finishing);
        void Promise.allSettled([recorder?.finish(), diarizer?.finish()]).then(
          () => {
            this.finishingConsumers.delete(finishing);
            if (!this.closed && this.get("meetings", id)) {
              this.invalidate();
              this.emit("state");
              void this.generate(id, "recap");
            }
          },
        );
      }
    }
  }
  audio(channel, bytes, at) {
    try {
      this.recorder?.push(channel, bytes, at);
    } catch {
      this.warning =
        "Audio could not be retained. Notes and transcript continue.";
    }
    if (channel === "system") this.diarizer?.push(bytes, at);
  }
  current(id = this.selectedId) {
    if (!id) return null;
    const header = this.get("meetings", id);
    if (!header) return null;
    return {
      ...header,
      segments: (id === this.activeId &&
      this.controller &&
      this.controller.engine.sessionId === this.activeSessionId
        ? [...this.controller.engine.transcript.values()]
        : this.all("segments", id)
      ).sort((a, b) => a.startMs - b.startMs),
      speakers: this.all("speakers", id),
      notes: this.get("docs", id, "notes:original") || { text: "", version: 0 },
      enhanced: this.get("docs", id, "notes:enhanced"),
      enhancedDraft: this.get("docs", id, "notes:enhancedDraft"),
      recap: this.get("docs", id, "recap"),
      recapDraft: this.get("docs", id, "recap:draft"),
      actions: this.all("actions", id),
      audio: this.all("audio_chunks", id).map(({ path, ...a }) => a),
      jobs: this.all("jobs", id),
      events: this.all("events", id).slice(-50),
    };
  }
  snapshot() {
    const current = this.current();
    if (
      current &&
      current.id === this.activeId &&
      this.controller &&
      this.controller.engine.sessionId === this.activeSessionId
    ) {
      current.liveTranscript = true;
      delete current.segments;
    }
    return {
      current,
      activeId: this.activeId,
      library: this.library(),
      warning: this.warning,
      locked: !this.store,
      libraryRevision: this.libraryRevision,
      unsaved: !!this.current() && this.current().saving === false,
    };
  }
  saveNotes(id, { text: value, version, lineTimes = [] }) {
    const prior = this.get("docs", id, "notes:original");
    if (!prior || prior.version !== version)
      throw new Error("These notes changed. Refresh before saving.");
    if (typeof value !== "string" || Buffer.byteLength(value) > 200000)
      throw new Error("Keep meeting notes under 200 KB.");
    const notes = this.put("docs", id, "notes:original", {
      text: value,
      version: version + 1,
      lineTimes: lineTimes
        .filter((t) => Number.isSafeInteger(t.line) && Number.isFinite(t.ms))
        .slice(0, 10000),
    });
    this.invalidate();
    this.emit("state");
    return notes;
  }
  editSegment(id, { segmentId, text: value, speakerKey }) {
    const row = this.get("segments", id, segmentId);
    if (!row) throw new Error("Transcript line not found.");
    const speaker = speakerKey ? this.get("speakers", id, speakerKey) : null;
    const next = this.put("segments", id, segmentId, {
      ...row,
      ...(typeof value === "string"
        ? {
            text: value.slice(0, 20000),
            originalText: row.originalText || row.text,
            edited: true,
          }
        : {}),
      ...(speaker
        ? {
            speakerKey,
            speaker: speaker.name || speaker.label,
            speakerOverride: true,
          }
        : {}),
    });
    if (
      id === this.activeId &&
      this.controller.engine.transcript.has(segmentId)
    ) {
      this.controller.engine.transcript.set(segmentId, next);
      this.cachedRows.set(segmentId, signature(next));
    }
    this.touch(id);
    this.emit("state");
    return next;
  }
  touch(id) {
    const m = this.get("meetings", id);
    if (m)
      this.put("meetings", id, id, {
        ...m,
        contentRevision: (m.contentRevision || 0) + 1,
      });
    this.invalidate();
  }
  renameSpeaker(id, { speakerKey, name }) {
    const s = this.get("speakers", id, speakerKey);
    if (!s || !text(name, 100).trim()) throw new Error("Enter a speaker name.");
    this.put("speakers", id, speakerKey, {
      ...s,
      name: name.trim().slice(0, 100),
      confirmed: true,
      nameSource: "user",
    });
    for (const r of this.all("segments", id))
      if (r.speakerKey === speakerKey)
        this.editSegment(id, { segmentId: r.id, speakerKey });
    this.event(id, "speaker.renamed", { speakerKey });
    this.touch(id);
    this.emit("state");
  }
  mergeSpeaker(id, { from, into }) {
    if (
      from === into ||
      !this.get("speakers", id, from) ||
      !this.get("speakers", id, into)
    )
      throw new Error("Choose two different speakers.");
    // Flatten the merge so repeated merges cannot create a cycle.
    let target = this.get("speakers", id, into);
    const visited = new Set([from]);
    while (target.mergedInto) {
      if (visited.has(target.id))
        throw new Error("Those speakers are already merged.");
      visited.add(target.id);
      target = this.get("speakers", id, target.mergedInto);
      if (!target) throw new Error("Speaker not found.");
    }
    if (target.id === from)
      throw new Error("Those speakers are already merged.");
    const s = this.get("speakers", id, from);
    this.put("speakers", id, from, { ...s, mergedInto: target.id });
    for (const r of this.all("segments", id))
      if (r.speakerKey === from)
        this.editSegment(id, { segmentId: r.id, speakerKey: target.id });
    this.event(id, "speaker.merged", { from, into: target.id });
    this.emit("state");
  }
  applyTurns(id, turns) {
    if (!this.get("meetings", id)) return;
    const prior = this.get("docs", id, "speaker:turns")?.turns || [],
      speakers = this.all("speakers", id);
    const stable = stableSpeakerTurns(prior, turns, speakers);
    for (const key of new Set(stable.map((t) => t.speakerKey)))
      if (!this.get("speakers", id, key))
        this.put("speakers", id, key, {
          label: key === "them" ? "Them" : `Speaker ${key.slice(1)}`,
          confirmed: false,
        });
    this.put("docs", id, "speaker:turns", { turns: stable });
    for (const row of assignSpeakers(
      this.all("segments", id),
      stable,
      this.all("speakers", id),
    )) {
      const r = this.put("segments", id, row.id, row);
      if (
        id === this.activeId &&
        this.controller?.engine.transcript.has(row.id)
      ) {
        this.controller.engine.transcript.set(row.id, r);
        this.cachedRows.set(row.id, signature(r));
      }
    }
    this.touch(id);
    this.emit("state");
  }
  async generate(id, task = "recap") {
    if (this.closed) return;
    const key = `${id}:${task}`;
    if (this.jobs.has(key)) return;
    const meeting = this.current(id);
    if (!meeting) return;
    const cancellation = new AbortController();
    this.jobs.set(key, cancellation);
    const basedOn = {
      revision: meeting.contentRevision,
      notesVersion: meeting.notes.version,
    };
    this.put("jobs", id, task, {
      status: "running",
      basedOn,
      startedAt: this.clock(),
    });
    this.emit("state");
    try {
      const generated = await this.documents.generate(meeting.segments, {
        task,
        notes: meeting.notes.text,
        signal: cancellation.signal,
      });
      if (
        this.closed ||
        cancellation.signal.aborted ||
        !this.get("meetings", id)
      )
        return;
      const latest = this.current(id),
        changed =
          latest.notes.version !== basedOn.notesVersion ||
          latest.contentRevision !== basedOn.revision;
      if (task === "enhance") {
        if (generated.engine !== "apple" || !generated.enhancedNotes)
          this.warning =
            "Local note enhancement could not finish. Your original notes are unchanged; you can try again.";
        // A fallback never pretends to enhance the user's prose.
        if (generated.engine === "apple" && generated.enhancedNotes)
          this.put(
            "docs",
            id,
            changed || latest.enhanced?.editedAt
              ? "notes:enhancedDraft"
              : "notes:enhanced",
            { text: generated.enhancedNotes, basedOn, engine: "apple" },
          );
      } else {
        const draft = changed || latest.recap?.editedAt;
        this.put("docs", id, draft ? "recap:draft" : "recap", {
          ...generated,
          basedOn,
          generatedAt: this.clock(),
          version: (latest.recap?.version || 0) + 1,
        });
        if (!draft) {
          for (const a of mergeActions(latest.actions, generated.actions))
            this.put("actions", id, a.id, a);
          if (latest.titleSource === "auto" && generated.title)
            this.put("meetings", id, id, {
              ...latest,
              segments: undefined,
              speakers: undefined,
              notes: undefined,
              enhanced: undefined,
              enhancedDraft: undefined,
              recap: undefined,
              recapDraft: undefined,
              actions: undefined,
              audio: undefined,
              jobs: undefined,
              events: undefined,
              title: generated.title,
              titleSource: "auto",
            });
        }
      }
      this.put("jobs", id, task, {
        status: "done",
        basedOn,
        engine: generated.engine,
        finishedAt: this.clock(),
      });
    } catch {
      if (!this.closed && this.get("meetings", id))
        this.put("jobs", id, task, {
          status: cancellation.signal.aborted ? "cancelled" : "failed",
          basedOn,
          finishedAt: this.clock(),
        });
    } finally {
      this.jobs.delete(key);
      if (this.closed) return;
      this.invalidate();
      this.emit("state");
    }
  }
  updateAction(id, payload) {
    const prior = payload.id ? this.get("actions", id, payload.id) : null;
    const a = prior || {
      id: randomUUID(),
      origin: "user",
      refs: [],
      owner: { name: null, confirmed: false },
      due: { text: null, date: null, confirmed: false, inferred: false },
      state: "proposed",
    };
    const patch = {};
    if (typeof payload.text === "string")
      patch.text = payload.text.slice(0, 2000);
    if (["proposed", "confirmed", "dismissed"].includes(payload.state))
      patch.state = payload.state;
    if (typeof payload.completed === "boolean")
      patch.completed = payload.completed;
    if (typeof payload.owner === "string")
      patch.owner = {
        name: payload.owner.slice(0, 100) || null,
        confirmed: payload.confirmOwner === true,
      };
    if (typeof payload.due === "string")
      patch.due = {
        text: payload.due.slice(0, 100) || null,
        date: /^\d{4}-\d{2}-\d{2}$/.test(payload.due) ? payload.due : null,
        confirmed: payload.confirmDue === true,
        inferred: false,
      };
    const saved = this.put("actions", id, a.id, {
      ...a,
      ...patch,
      edited: true,
    });
    this.invalidate();
    this.emit("state");
    return saved;
  }
  delete(id) {
    const m = this.get("meetings", id);
    if (!m || m.status !== "ended")
      throw new Error("End the meeting before deleting it.");
    for (const [key, controller] of this.jobs)
      if (key.startsWith(`${id}:`)) controller.abort();
    this.store?.deleteMeeting(id);
    for (const [key, entry] of this.pendingWrites)
      if (entry.meetingId === id) this.pendingWrites.delete(key);
    for (const [group, records] of this.recordCache) {
      if (group.endsWith(`|${id}`)) this.recordCache.delete(group);
      else
        for (const [key, record] of records)
          if (record.meetingId === id) records.delete(key);
    }
    for (const key of this.memory.keys())
      if (key.includes(`:${id}:`)) this.memory.delete(key);
    if (this.selectedId === id) this.selectedId = null;
    if (this.activeId === id) this.activeId = null;
    this.invalidate();
    this.emit("state");
  }
  async command(name, p = {}) {
    const id = p.meetingId || this.selectedId;
    switch (name) {
      case "meeting.open":
        if (!this.get("meetings", p.id)) throw new Error("Meeting not found.");
        this.selectedId = p.id;
        break;
      case "meeting.active":
        this.selectedId = this.activeId;
        break;
      case "meeting.notes":
        return this.saveNotes(id, p);
      case "meeting.edit": {
        const m = this.get("meetings", id);
        if (!m) throw new Error("Meeting not found.");
        const patch = {};
        for (const k of WRITABLE)
          if (k === "title" && typeof p[k] === "string") {
            patch.title = p[k].slice(0, 200);
            patch.titleSource = "user";
          } else if (k === "people" && Array.isArray(p[k]))
            patch.people = p[k]
              .filter((x) => typeof x === "string")
              .map((x) => x.slice(0, 100))
              .slice(0, 30);
        this.put("meetings", id, id, { ...m, ...patch });
        this.touch(id);
        break;
      }
      case "meeting.segment":
        return this.editSegment(id, p);
      case "meeting.speaker":
        return this.renameSpeaker(id, p);
      case "meeting.merge":
        return this.mergeSpeaker(id, p);
      case "meeting.action":
        return this.updateAction(id, p);
      case "meeting.generate":
        void this.generate(id, p.task === "enhance" ? "enhance" : "recap");
        break;
      case "meeting.cancel": {
        const task = p.task === "enhance" ? "enhance" : "recap";
        this.jobs.get(`${id}:${task}`)?.abort();
        break;
      }
      case "meeting.document": {
        if (!["recap", "notes:enhanced"].includes(p.kind))
          throw new Error("Invalid document.");
        const d = this.get("docs", id, p.kind);
        if (!d) throw new Error("Document not found.");
        if (p.kind === "notes:enhanced")
          this.put("docs", id, p.kind, {
            ...d,
            text: text(p.text, 200000),
            editedAt: this.clock(),
          });
        else {
          const fields = ["summary", "decisions", "openQuestions"];
          if (!fields.includes(p.section))
            throw new Error("Invalid recap section.");
          this.put("docs", id, p.kind, {
            ...d,
            [p.section]: d[p.section].map((b) =>
              b.id === p.id
                ? { ...b, text: text(p.text, 2000), edited: true }
                : b,
            ),
            editedAt: this.clock(),
          });
        }
        break;
      }
      case "meeting.adopt": {
        const kind = p.kind === "enhanced" ? "notes:enhanced" : "recap",
          source = kind === "recap" ? "recap:draft" : "notes:enhancedDraft";
        const d = this.get("docs", id, source);
        if (d) {
          this.put("docs", id, kind, { ...d, editedAt: this.clock() });
          if (kind === "recap")
            for (const a of mergeActions(
              this.all("actions", id),
              d.actions || [],
            ))
              this.put("actions", id, a.id, a);
          this.store?.remove("docs", id, source);
        }
        break;
      }
      case "meeting.notice": {
        const m = this.get("meetings", id);
        if (p.objection === true) {
          await this.controller.command("pause");
          this.event(id, "capture.objection");
          this.warning =
            "Capture is paused. Resolve the objection before resuming.";
        } else {
          if (!p.confirmed)
            throw new Error("Confirm that the participant heard the notice.");
          m.notice.repeats.push({ at: this.clock() });
          this.put("meetings", id, id, m);
          this.event(id, "notice.repeated");
        }
        break;
      }
      case "meeting.delete":
        if (p.confirm !== true) throw new Error("Confirm deletion first.");
        this.delete(id);
        break;
      case "meeting.search":
        return this.search?.search(p.query || "", p.filters || {}) || [];
      case "meeting.ask": {
        const hits =
          (await this.search?.search(p.question || "", p.filters || {})) || [];
        const selected = hits.slice(0, 5);
        const rows = selected.flatMap((h) =>
          this.all("segments", h.id).map((r) => ({
            ...r,
            id: `${h.id}:${r.id}`,
          })),
        );
        const generated = await this.documents.generate(rows, {
          task: "answer",
          question: text(p.question, 1000),
        });
        return {
          answer:
            generated.answer ||
            "Here are matching transcript excerpts. Local AI could not produce a grounded answer.",
          refs: generated.answerRefs,
          meetings: selected,
          engine: generated.engine,
        };
      }
      case "meeting.export":
        return this.export(id, p.format);
      case "meeting.notice.preview":
        return {
          text: noticeText(this.controller?.preferences),
          configHash: noticeHash(this.controller?.preferences),
          presentedAt: this.clock(),
        };
      default:
        throw new Error("Unknown meeting action.");
    }
    this.invalidate();
    this.emit("state");
    return this.snapshot();
  }
  export(id, format = "markdown") {
    const m = this.current(id);
    if (!m) throw new Error("Meeting not found.");
    if (format === "json") return JSON.stringify(m, null, 2);
    const bullet = (items) =>
      (items || [])
        .map(
          (b) =>
            `- ${b.text} ${(b.refs || []).map((ref) => `[${ref}]`).join(" ")}`,
        )
        .join("\n");
    return `# ${m.title}\n\n${new Date(m.createdAt).toLocaleString()}\nPeople: ${m.people.join(", ")}\n\n## Summary\n${bullet(m.recap?.summary)}\n\n## Decisions\n${bullet(m.recap?.decisions)}\n\n## Open questions\n${bullet(m.recap?.openQuestions)}\n\n## Actions\n${m.actions
      .filter((a) => a.state !== "dismissed")
      .map((a) => `- [${a.completed ? "x" : " "}] ${a.text}`)
      .join(
        "\n",
      )}\n\n## Original notes\n${m.notes.text}\n\n## Enhanced notes\n${m.enhanced?.text || ""}\n\n## Transcript\n${m.segments.map((r) => `[${r.id}] ${Math.floor(r.startMs / 60000)}:${String(Math.floor(r.startMs / 1000) % 60).padStart(2, "0")} ${r.speaker}: ${r.text}${r.unfinalized ? " [not finalized]" : ""}`).join("\n\n")}\n`;
  }
  close() {
    if (this.closed) return;
    clearInterval(this.retryTimer);
    this.retryWrites();
    for (const [key] of this.jobs) {
      const split = key.lastIndexOf(":");
      const id = key.slice(0, split),
        task = key.slice(split + 1);
      if (this.get("meetings", id))
        this.put("jobs", id, task, { status: "queued", recovered: true });
    }
    this.closed = true;
    for (const j of this.jobs.values()) j.abort();
    this.recorder?.close();
    this.diarizer?.close();
    for (const consumers of this.finishingConsumers) {
      consumers.recorder?.close();
      consumers.diarizer?.close();
    }
    this.search?.close();
    this.store?.close();
  }
}
