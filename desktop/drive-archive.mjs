// Drive credentials stay with the authenticated upload worker. This module only
// prepares portable files and consumes its verified receipt; it never syncs the
// live database or exports the Keychain-wrapped library key.
import path from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  existsSync,
  renameSync,
  rmSync,
  statSync,
  lstatSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const hash = (bytes, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");
const safeId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(id);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) =>
  writeFileSync(file, JSON.stringify(value, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
const regular = (file) =>
  lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink();

export class DriveArchive {
  constructor({ meetings, directory, folderId, clock = Date.now, prepareJob }) {
    if (!safeId(folderId))
      throw new Error("Choose the private Drive archive folder first.");
    Object.assign(this, { meetings, directory, folderId, clock, prepareJob });
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    meetings.on?.("archive.cancel", (id) => this.cancel(id));
  }
  cancelled(id) {
    return existsSync(path.join(this.directory, "cancelled", id));
  }
  cancel(id) {
    if (!safeId(id)) throw new Error("Invalid meeting identifier.");
    const tombstones = path.join(this.directory, "cancelled");
    mkdirSync(tombstones, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(tombstones, id), "Cancelled before upload.\n", {
      mode: 0o600,
    });
    rmSync(path.join(this.directory, id), { recursive: true, force: true });
  }
  cancelAll() {
    for (const id of new Set([
      ...this.pending(),
      ...this.meetings.all("meetings").map((m) => m.id),
    ]))
      this.cancel(id);
  }
  pending() {
    return readdirSync(this.directory, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          safeId(e.name) &&
          existsSync(path.join(this.directory, e.name, "job.json")),
      )
      .map((e) => e.name);
  }
  prepare(id) {
    if (!safeId(id)) throw new Error("Invalid meeting identifier.");
    const m = this.meetings.current(id),
      store = this.meetings.store;
    if (
      !store ||
      !m ||
      m.status !== "ended" ||
      m.saving === false ||
      m.driveArchive !== true
    )
      return { skipped: true };
    if (this.cancelled(id)) return { skipped: true, cancelled: true };
    if (m.driveArchived) return { archived: true };
    const destination = path.join(this.directory, id);
    if (existsSync(path.join(destination, "job.json"))) return { queued: true };
    const stage = path.join(this.directory, `.preparing-${randomUUID()}`);
    mkdirSync(stage, { mode: 0o700 });
    try {
      const content = path.join(stage, "content");
      mkdirSync(content, { mode: 0o700 });
      writeFileSync(
        path.join(content, "meeting.json"),
        this.meetings.export(id, "json"),
        { mode: 0o600 },
      );
      writeFileSync(
        path.join(content, "transcript-and-notes.md"),
        this.meetings.export(id, "markdown"),
        { mode: 0o600 },
      );
      const audio = store
        .all("audio_chunks", id)
        .sort(
          (a, b) =>
            a.channel.localeCompare(b.channel) || a.sequence - b.sequence,
        );
      const exported = [];
      for (const chunk of audio) {
        if (chunk.missing || chunk.archived) continue;
        // Refuse an incomplete export. Nothing is cleaned if any expected audio is unavailable.
        const bytes = store.readAudio(id, chunk.id);
        const channelFile =
          chunk.channel === "mic" ? "microphone.mp3" : "call-audio.mp3";
        if (!["mic", "system"].includes(chunk.channel))
          throw new Error("Unknown audio channel.");
        appendFileSync(path.join(content, channelFile), bytes, { mode: 0o600 });
        exported.push({
          id: chunk.id,
          channel: chunk.channel,
          sequence: chunk.sequence,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          bytes: bytes.length,
          sha256: hash(bytes),
        });
      }
      const manifest = {
        version: 1,
        meetingId: id,
        createdAt: this.clock(),
        audio: exported,
        audioTiming:
          "MP3 files concatenate retained chunks per channel. Pauses and missing capture are not padded; chunk start/end times below preserve the original timeline.",
        sourceRevision: m.contentRevision || 0,
      };
      writeJson(path.join(content, "manifest.json"), manifest);
      const fileName = `Callwise-${new Date(m.createdAt).toISOString().slice(0, 10)}-${id}.tar.gz`;
      const archive = path.join(stage, fileName);
      execFileSync("/usr/bin/tar", ["-czf", archive, "-C", content, "."], {
        stdio: "pipe",
      });
      const bytes = readFileSync(archive);
      const job = {
        version: 1,
        meetingId: id,
        fileName,
        folderId: this.folderId,
        bytes: bytes.length,
        md5: hash(bytes, "md5"),
        sha256: hash(bytes),
        exportedAt: this.clock(),
        sourceRevision: m.contentRevision || 0,
        audio: exported,
      };
      writeJson(path.join(stage, "job.json"), job);
      rmSync(content, { recursive: true, force: true });
      if (this.cancelled(id)) {
        rmSync(stage, { recursive: true, force: true });
        return { skipped: true, cancelled: true };
      }
      renameSync(stage, destination);
      return { queued: true, ...job };
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }
  acknowledge(id) {
    if (!safeId(id)) throw new Error("Invalid meeting identifier.");
    const dir = path.join(this.directory, id),
      receiptFile = path.join(dir, "verified-drive-receipt.json");
    if (!existsSync(receiptFile)) return { waiting: true };
    const jobFile = path.join(dir, "job.json");
    if (!regular(jobFile) || !regular(receiptFile))
      throw new Error("Archive receipt must be an ordinary file.");
    const job = readJson(jobFile),
      receipt = readJson(receiptFile);
    const archive = path.join(dir, job.fileName || "");
    if (path.basename(job.fileName || "") !== job.fileName || !regular(archive))
      throw new Error("Invalid archive file.");
    const data = readFileSync(archive);
    if (
      job.meetingId !== id ||
      job.folderId !== this.folderId ||
      receipt.folderId !== this.folderId ||
      !safeId(receipt.fileId) ||
      receipt.md5 !== job.md5 ||
      receipt.bytes !== job.bytes ||
      receipt.trashed !== false ||
      receipt.verified !== true ||
      !Number.isFinite(receipt.checkedAt) ||
      receipt.checkedAt < job.exportedAt ||
      receipt.checkedAt > this.clock() + 60000 ||
      statSync(archive).size !== job.bytes ||
      hash(data, "md5") !== job.md5 ||
      hash(data) !== job.sha256
    )
      throw new Error(
        "Drive verification does not match the local archive; audio was kept.",
      );
    const m = this.meetings.store.get("meetings", id);
    if (!m || m.status !== "ended")
      throw new Error("Only an ended saved meeting can be offloaded.");
    // Recheck the actual audio against the exported bytes before removing any original.
    for (const chunk of job.audio) {
      const row = this.meetings.store.get("audio_chunks", id, chunk.id);
      if (!row || row.archived) continue;
      if (hash(this.meetings.store.readAudio(id, chunk.id)) !== chunk.sha256)
        throw new Error(
          "Audio changed after export; the original audio was kept.",
        );
    }
    const remote = {
      fileId: receipt.fileId,
      folderId: this.folderId,
      md5: job.md5,
      bytes: job.bytes,
      verifiedAt: receipt.checkedAt,
      sourceRevision: job.sourceRevision,
      url: `https://drive.google.com/file/d/${receipt.fileId}/view`,
    };
    const files = [];
    this.meetings.store.transaction(() => {
      this.meetings.store.put("meetings", id, id, {
        ...m,
        driveArchived: remote,
      });
      for (const chunk of job.audio) {
        const row = this.meetings.store.get("audio_chunks", id, chunk.id);
        if (!row) continue;
        if (row.archived && row.archive?.fileId !== receipt.fileId)
          throw new Error("Conflicting archive receipt; local audio was kept.");
        files.push(path.join(this.meetings.store.directory, row.path));
        this.meetings.store.put("audio_chunks", id, chunk.id, {
          ...row,
          missing: true,
          archived: true,
          archive: remote,
        });
      }
    });
    for (const file of files) rmSync(file, { force: true });
    this.meetings.clearCache?.();
    this.meetings.emit?.("state");
    rmSync(dir, { recursive: true, force: true });
    return {
      archived: true,
      removedLocalAudioChunks: files.length,
      url: remote.url,
    };
  }
  async sweep() {
    for (const id of this.pending()) this.acknowledge(id);
    if (
      this.meetings.pendingWrites?.size ||
      this.meetings.jobs?.size ||
      this.meetings.finishingConsumers?.size ||
      this.meetings.archiveOperation
    )
      return;
    for (const m of this.meetings.all("meetings"))
      if (m.status === "ended" && m.driveArchive === true && !m.driveArchived) {
        if (existsSync(path.join(this.directory, m.id, "job.json"))) continue;
        if (this.prepareJob) await this.prepareJob(m.id);
        else this.prepare(m.id);
      }
  }
}
