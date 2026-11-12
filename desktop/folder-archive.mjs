// A finished-meeting export, not a cloud uploader. macOS owns iCloud syncing.
// The live database and its key never leave Application Support.
import { EventEmitter } from "node:events";
import path from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  renameSync,
  rmSync,
  lstatSync,
  readdirSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
const safeId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(id);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const save = (file, value) => {
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temp, file);
};

// Runs in a worker against an encrypted, read-only snapshot. No key is exported.
export function prepareFolderExport({ meetings, id, stage }) {
  if (!safeId(id)) throw new Error("Invalid meeting identifier.");
  const m = meetings.current(id),
    store = meetings.store;
  if (
    !store ||
    !m ||
    m.status !== "ended" ||
    m.saving === false ||
    !m.iCloudArchive?.folder ||
    m.iCloudArchive.cancelled
  )
    throw new Error("Only an opted-in, ended saved meeting can be archived.");
  mkdirSync(stage, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(stage, "transcript-and-notes.md"),
    meetings.export(id, "markdown"),
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(stage, "transcript-and-notes.txt"),
    meetings.export(id, "markdown"),
    { mode: 0o600 },
  );
  writeFileSync(path.join(stage, "meeting.json"), meetings.export(id, "json"), {
    mode: 0o600,
  });
  const audio = [];
  for (const a of store
    .all("audio_chunks", id)
    .sort(
      (a, b) => a.channel.localeCompare(b.channel) || a.sequence - b.sequence,
    )) {
    if (a.missing || a.archived) continue;
    if (!["mic", "system"].includes(a.channel))
      throw new Error("Unknown recording channel.");
    const bytes = store.readAudio(id, a.id),
      file = a.channel === "mic" ? "microphone.mp3" : "call-audio.mp3";
    appendFileSync(path.join(stage, file), bytes, { mode: 0o600 });
    audio.push({
      id: a.id,
      channel: a.channel,
      startMs: a.startMs,
      endMs: a.endMs,
      bytes: bytes.length,
      sha256: digest(bytes),
    });
  }
  const files = readdirSync(stage)
    .filter((f) => f !== "manifest.json")
    .map((file) => {
      const bytes = readFileSync(path.join(stage, file));
      return {
        file,
        bytes: bytes.length,
        sha256: digest(bytes),
        audio: file.endsWith(".mp3"),
      };
    });
  return {
    version: 1,
    meetingId: id,
    folder: m.iCloudArchive.folder,
    exportName: `${new Date(m.createdAt).toISOString().slice(0, 10)}-${id}`,
    sourceRevision: m.contentRevision || 0,
    audio,
    files,
    timing:
      "Per-channel MP3 files concatenate retained chunks; pauses are not padded. Audio chunk times preserve the original timeline.",
  };
}

export class FolderArchive extends EventEmitter {
  constructor({
    meetings,
    native,
    directory,
    prepareJob,
    clock = Date.now,
    publish = renameSync,
    removeOriginal = (file) => rmSync(file, { force: true }),
  }) {
    super();
    Object.assign(this, {
      meetings,
      native,
      directory,
      prepareJob,
      clock,
      publish,
      removeOriginal,
    });
    this.running = new Map();
    this.completions = new Map();
    this.cancelTasks = new Map();
    this.cancelledIds = new Set();
    this.closed = false;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    meetings.on("archive.ready", (id) => void this.enqueue(id));
    meetings.beforeArchiveDelete = (id) => this.cancel(id);
  }
  update(id, state, message = "") {
    this.emit("status", { meetingId: id, state, message });
  }
  cancel(id) {
    if (!safeId(id)) return Promise.resolve();
    if (this.cancelTasks.has(id)) return this.cancelTasks.get(id);
    this.cancelledIds.add(id);
    this.running.get(id)?.abort();
    const completion = this.completions.get(id);
    const task = (async () => {
      try {
        if (completion) await completion;
        const jobDir = path.join(this.directory, id),
          jobFile = path.join(jobDir, "job.json");
        const job = existsSync(jobFile) ? json(jobFile) : null;
        if (job?.destination && existsSync(job.destination))
          await this.native.run("archive-files", {
            op: "cancel-pending",
            folder: job.destination,
            meetingId: id,
            manifestSHA256: job.manifestSHA256,
            files: job.files.map((f) => ({
              ...f,
              path: path.join(job.destination, f.file),
            })),
          });
        rmSync(jobDir, { recursive: true, force: true });
        const meeting = this.meetings.store?.get("meetings", id);
        if (meeting?.iCloudArchive) {
          this.meetings.store.put("meetings", id, id, {
            ...meeting,
            iCloudArchive: { ...meeting.iCloudArchive, cancelled: true },
          });
          this.meetings.clearCache();
        }
      } catch (error) {
        this.cancelledIds.delete(id);
        this.update(
          id,
          "waiting",
          "The pending iCloud export could not be safely cancelled. The local meeting was kept.",
        );
        throw error;
      } finally {
        this.cancelTasks.delete(id);
      }
    })();
    this.cancelTasks.set(id, task);
    return task;
  }
  async cancelAll() {
    const ids = new Set(this.meetings.all("meetings").map((m) => m.id));
    for (const entry of readdirSync(this.directory, { withFileTypes: true }))
      if (
        entry.isDirectory() &&
        safeId(entry.name) &&
        existsSync(path.join(this.directory, entry.name, "job.json"))
      )
        ids.add(entry.name);
    await Promise.all([...ids].map((id) => this.cancel(id)));
  }
  close() {
    this.closed = true;
    for (const c of this.running.values()) c.abort();
  }
  cleanupVerified(id, job) {
    const m = this.meetings.store?.get("meetings", id),
      proof = m?.folderArchived;
    if (
      !safeId(id) ||
      !proof ||
      proof.provider !== "icloud" ||
      !Number.isFinite(proof.verifiedAt) ||
      proof.folder !== job.destination ||
      proof.sourceRevision !== job.sourceRevision ||
      job.meetingId !== id
    )
      throw new Error("Verified archive cleanup does not match this meeting.");
    for (const audio of job.audio) {
      const row = this.meetings.store.get("audio_chunks", id, audio.id);
      if (!row) continue;
      const match = /^(mic|system):(\d+)$/.exec(audio.id);
      if (
        !match ||
        !row.archived ||
        !row.missing ||
        row.folderArchive?.folder !== proof.folder
      )
        throw new Error("Unexpected recording metadata; local file was kept.");
      const relative = `audio/${id}/${match[1]}/${match[2]}.cwa`;
      if (row.path !== relative)
        throw new Error("Unexpected recording path; local file was kept.");
      const file = path.join(this.meetings.store.directory, relative);
      if (
        existsSync(file) &&
        (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
      )
        throw new Error("Unexpected recording file; local file was kept.");
      this.removeOriginal(file);
    }
    rmSync(path.join(this.directory, id), { recursive: true, force: true });
  }
  resume() {
    for (const m of this.meetings.all("meetings")) {
      if (m.folderArchived) {
        const jobFile = path.join(this.directory, m.id, "job.json");
        if (existsSync(jobFile)) {
          try {
            this.cleanupVerified(m.id, json(jobFile));
          } catch (error) {
            this.update(m.id, "waiting", error.message);
          }
        }
      } else if (
        m.status === "ended" &&
        m.iCloudArchive?.folder &&
        !m.iCloudArchive.cancelled
      )
        void this.enqueue(m.id);
    }
  }
  async enqueue(id) {
    if (
      !safeId(id) ||
      this.closed ||
      this.cancelledIds.has(id) ||
      this.running.has(id) ||
      [...this.meetings.finishingConsumers].some((c) => c.meetingId === id)
    )
      return;
    const controller = new AbortController();
    this.running.set(id, controller);
    let markDone;
    this.completions.set(
      id,
      new Promise((resolve) => {
        markDone = resolve;
      }),
    );
    const cancelled = () =>
      controller.signal.aborted ||
      this.closed ||
      this.cancelledIds.has(id) ||
      !this.meetings.get("meetings", id);
    const jobDir = path.join(this.directory, id),
      jobFile = path.join(jobDir, "job.json");
    try {
      let m = this.meetings.get("meetings", id);
      if (
        !m ||
        m.status !== "ended" ||
        !m.iCloudArchive?.folder ||
        m.iCloudArchive.cancelled ||
        m.folderArchived
      )
        return;
      mkdirSync(jobDir, { recursive: true, mode: 0o700 });
      let job = existsSync(jobFile) ? json(jobFile) : null;
      if (job && !existsSync(job.destination)) {
        if (job.stage && existsSync(job.stage) && !cancelled())
          renameSync(job.stage, job.destination);
        else
          throw new Error(
            "The pending export is missing. Original audio was kept.",
          );
      }
      if (!job) {
        for (const entry of readdirSync(jobDir, { withFileTypes: true }))
          if (entry.isDirectory() && entry.name.startsWith("preparing-"))
            rmSync(path.join(jobDir, entry.name), {
              recursive: true,
              force: true,
            });
        const stage = path.join(jobDir, `preparing-${randomUUID()}`);
        this.update(id, "exporting");
        job = this.prepareJob
          ? await this.prepareJob(id, stage, controller.signal)
          : prepareFolderExport({ meetings: this.meetings, id, stage });
        if (cancelled()) {
          rmSync(stage, { recursive: true, force: true });
          return;
        }
        await this.native.run(
          "archive-files",
          {
            op: "pdf",
            folder: stage,
            input: path.join(stage, "transcript-and-notes.txt"),
            output: path.join(stage, "transcript-and-notes.pdf"),
          },
          { signal: controller.signal },
        );
        const pdf = readFileSync(path.join(stage, "transcript-and-notes.pdf"));
        job.files.push({
          file: "transcript-and-notes.pdf",
          bytes: pdf.length,
          sha256: digest(pdf),
          audio: false,
        });
        save(path.join(stage, "manifest.json"), job);
        const manifest = readFileSync(path.join(stage, "manifest.json"));
        job.manifestSHA256 = digest(manifest);
        job.files.push({
          file: "manifest.json",
          bytes: manifest.length,
          sha256: job.manifestSHA256,
          audio: false,
        });
        const destination = path.join(job.folder, job.exportName);
        if (cancelled()) {
          rmSync(stage, { recursive: true, force: true });
          return;
        }
        if (
          !path.isAbsolute(job.folder) ||
          !lstatSync(job.folder).isDirectory() ||
          lstatSync(job.folder).isSymbolicLink()
        )
          throw new Error("Choose an existing iCloud Drive folder first.");
        if (existsSync(destination))
          throw new Error(
            "An export already exists here. Nothing was overwritten.",
          );
        // iCloud Drive on this Mac is on the same volume. An unsupported cross-volume
        // destination fails safely; it never falls back to an uncontrolled partial copy.
        job = { ...job, destination, stage, publishedAt: null };
        save(jobFile, job);
        this.publish(stage, destination);
        job.publishedAt = this.clock();
        save(jobFile, job);
      }
      if (cancelled()) return;
      this.update(
        id,
        "syncing",
        "Waiting for macOS to confirm the iCloud upload. Original audio is kept.",
      );
      const files = job.files.map((f) => ({
        ...f,
        path: path.join(job.destination, f.file),
      }));
      const uploaded = await this.native.run(
        "archive-files",
        { op: "wait-upload", folder: job.destination, files },
        {
          signal: controller.signal,
          timeout: 24 * 60 * 60 * 1000,
          onProgress: (value) =>
            this.update(
              id,
              value.uploadErrors?.length ? "waiting" : "syncing",
              value.uploadErrors?.length
                ? "iCloud reports an upload problem. Original audio is kept until syncing succeeds."
                : "Waiting for iCloud to confirm upload.",
            ),
        },
      );
      if (cancelled()) return;
      if (uploaded?.uploaded !== true)
        throw new Error(
          "iCloud has not confirmed the export. Original audio was kept.",
        );
      const verified = await this.native.run(
        "archive-files",
        { op: "verify-and-evict", folder: job.destination, files },
        { signal: controller.signal, timeout: 10 * 60 * 1000 },
      );
      if (cancelled()) return;
      if (verified?.verified !== true || verified?.audioEvicted !== true)
        throw new Error(
          "iCloud offload is not confirmed. Original audio was kept.",
        );
      m = this.meetings.store.get("meetings", id);
      if (!m || m.status !== "ended") return;
      const inventory = this.meetings.store
        .all("audio_chunks", id)
        .filter((a) => !a.missing && !a.archived);
      if (
        inventory.length !== job.audio.length ||
        inventory.some((a) => !job.audio.some((b) => b.id === a.id))
      )
        throw new Error(
          "The recording gained more audio after export. All originals were kept.",
        );
      for (const a of job.audio) {
        const row = this.meetings.store.get("audio_chunks", id, a.id);
        if (
          row &&
          !row.archived &&
          digest(this.meetings.store.readAudio(id, a.id)) !== a.sha256
        )
          throw new Error(
            "The recording changed after export. Original audio was kept.",
          );
      }
      const remote = {
        folder: job.destination,
        provider: "icloud",
        verifiedAt: this.clock(),
        sourceRevision: job.sourceRevision,
      };
      this.meetings.store.transaction(() => {
        this.meetings.store.put("meetings", id, id, {
          ...m,
          folderArchived: remote,
        });
        for (const a of job.audio) {
          const row = this.meetings.store.get("audio_chunks", id, a.id);
          if (!row) continue;
          this.meetings.store.put("audio_chunks", id, a.id, {
            ...row,
            missing: true,
            archived: true,
            folderArchive: remote,
          });
        }
      });
      this.cleanupVerified(id, job);
      this.meetings.clearCache();
      this.meetings.emit("state");
      this.update(
        id,
        "archived",
        "Recording saved in iCloud; local audio offloaded. Transcript and notes remain searchable here.",
      );
    } catch (error) {
      if (!cancelled())
        this.update(
          id,
          "waiting",
          error.message || "Export could not finish. Original audio was kept.",
        );
    } finally {
      this.running.delete(id);
      this.completions.delete(id);
      markDone?.();
    }
  }
}
