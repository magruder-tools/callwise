import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  lstatSync,
  readdirSync,
  rmSync,
  chmodSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import { seal, unseal, sealBackup, openBackup } from "./crypto.mjs";
export const SCHEMA_VERSION = 1;
const TABLES = [
  "meetings",
  "segments",
  "speakers",
  "docs",
  "actions",
  "exports",
  "events",
  "audio_chunks",
  "jobs",
  "access_log",
];
const safeId = (v) =>
  typeof v === "string" && /^[a-zA-Z0-9:_-]{1,200}$/.test(v);
function checked(v) {
  if (!safeId(v)) throw new Error("Invalid meeting identifier.");
  return v;
}
export function atomicWrite(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temp, data, { mode: 0o600, flag: "wx" });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}
function storageReady(storage) {
  if (
    !storage?.isEncryptionAvailable() ||
    storage.getSelectedStorageBackend?.() === "basic_text"
  )
    throw new Error(
      "Meeting library is locked. Unlock your keychain and reopen Callwise, or explicitly start without saving.",
    );
}
export class MeetingStore {
  constructor(
    directory,
    {
      storage,
      key,
      keyId = "test-key",
      readOnly = false,
      recover = true,
      clock = Date.now,
    } = {},
  ) {
    this.directory = directory;
    this.readOnly = readOnly;
    this.clock = clock;
    this.closed = false;
    if (!readOnly) mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyFile = path.join(directory, "archive-key.bin");
    if (key) {
      this.key = Buffer.from(key);
      this.keyId = keyId;
    } else {
      storageReady(storage);
      if (existsSync(keyFile)) {
        const stat = lstatSync(keyFile);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16000)
          throw new Error(
            "The existing meeting key cannot be opened; it has not been replaced.",
          );
        try {
          const v = JSON.parse(storage.decryptString(readFileSync(keyFile)));
          this.key = Buffer.from(v.key, "base64");
          this.keyId = v.id;
        } catch {
          throw new Error(
            "The meeting key cannot be unlocked; it has not been replaced.",
          );
        }
      } else {
        if (readOnly || existsSync(path.join(directory, "library.db")))
          throw new Error(
            "The meeting key is missing. Restore a backup; the library has not been changed.",
          );
        this.key = randomBytes(32);
        this.keyId = randomUUID();
        atomicWrite(
          keyFile,
          storage.encryptString(
            JSON.stringify({
              id: this.keyId,
              key: this.key.toString("base64"),
            }),
          ),
        );
      }
    }
    if (this.key.length !== 32 || !safeId(this.keyId))
      throw new Error("Invalid meeting library key.");
    this.file = path.join(directory, "library.db");
    if (
      existsSync(this.file) &&
      (!lstatSync(this.file).isFile() || lstatSync(this.file).isSymbolicLink())
    )
      throw new Error("Invalid meeting library file.");
    this.db = new DatabaseSync(this.file, { readOnly });
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if ((readOnly && version !== SCHEMA_VERSION) || version > SCHEMA_VERSION) {
      this.db.close();
      throw new Error(
        "Open this library with a compatible version of Callwise.",
      );
    }
    if (!readOnly) {
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;");
      if (version !== SCHEMA_VERSION) this.migrate(version);
      chmodSync(this.file, 0o600);
      if (recover) this.recover();
    }
  }
  migrate(version) {
    if (version > 0) {
      this.db.exec("PRAGMA wal_checkpoint(FULL)");
      mkdirSync(path.join(this.directory, "backups"), {
        recursive: true,
        mode: 0o700,
      });
      copyFileSync(
        this.file,
        path.join(
          this.directory,
          "backups",
          `schema-${version}-${this.clock()}.db`,
        ),
      );
    }
    this.transaction(() => {
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      for (const table of TABLES)
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS ${table} (id TEXT NOT NULL, meeting_id TEXT NOT NULL, at INTEGER NOT NULL, revision INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(meeting_id,id)); CREATE INDEX IF NOT EXISTS ${table}_at ON ${table}(at);`,
        );
      this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    });
  }
  transaction(fn) {
    if (this.readOnly) throw new Error("Meeting connection is read-only.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  table(table) {
    if (!TABLES.includes(table))
      throw new Error("Unknown meeting record type.");
    return table;
  }
  get(table, meetingId, id = meetingId) {
    this.table(table);
    checked(meetingId);
    checked(id);
    const row = this.db
      .prepare(`SELECT revision,data FROM ${table} WHERE meeting_id=? AND id=?`)
      .get(meetingId, id);
    return row
      ? {
          ...unseal(this.key, row.data, `${table}:${meetingId}:${id}`, {
            keyId: this.keyId,
          }),
          revision: row.revision,
        }
      : null;
  }
  all(table, meetingId, { limit = 100000, offset = 0, newest = false } = {}) {
    this.table(table);
    if (meetingId) checked(meetingId);
    const rows = this.db
      .prepare(
        `SELECT * FROM ${table} ${meetingId ? "WHERE meeting_id=?" : ""} ORDER BY at ${newest ? "DESC" : "ASC"}, id LIMIT ? OFFSET ?`,
      )
      .all(
        ...(meetingId ? [meetingId] : []),
        Math.min(100000, Math.max(1, limit)),
        Math.max(0, offset),
      );
    return rows.map((r) => ({
      ...unseal(this.key, r.data, `${table}:${r.meeting_id}:${r.id}`, {
        keyId: this.keyId,
      }),
      revision: r.revision,
    }));
  }
  put(table, meetingId, id, value, expectedRevision) {
    this.table(table);
    checked(meetingId);
    checked(id);
    if (this.readOnly) throw new Error("Meeting connection is read-only.");
    const prior = this.db
      .prepare(`SELECT revision FROM ${table} WHERE meeting_id=? AND id=?`)
      .get(meetingId, id);
    if (
      expectedRevision !== undefined &&
      (prior?.revision || 0) !== expectedRevision
    )
      throw new Error("This meeting changed. Refresh before saving.");
    const revision = (prior?.revision || 0) + 1;
    const record = { ...value, id, meetingId, revision };
    const data = seal(
      this.key,
      record,
      `${table}:${meetingId}:${id}`,
      this.keyId,
    );
    this.db
      .prepare(
        `INSERT INTO ${table}(id,meeting_id,at,revision,data) VALUES(?,?,?,?,?) ON CONFLICT(meeting_id,id) DO UPDATE SET at=excluded.at,revision=excluded.revision,data=excluded.data`,
      )
      .run(
        id,
        meetingId,
        value.createdAt ?? value.startMs ?? this.clock(),
        revision,
        data,
      );
    return record;
  }
  remove(table, meetingId, id) {
    if (this.readOnly) throw new Error("Read-only library.");
    this.table(table);
    this.db
      .prepare(`DELETE FROM ${table} WHERE meeting_id=? AND id=?`)
      .run(checked(meetingId), checked(id));
  }
  deleteMeeting(meetingId) {
    checked(meetingId);
    this.transaction(() => {
      for (const table of TABLES)
        this.db
          .prepare(`DELETE FROM ${table} WHERE meeting_id=?`)
          .run(meetingId);
    });
    rmSync(path.join(this.directory, "audio", meetingId), {
      recursive: true,
      force: true,
    });
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  recover() {
    for (const m of this.all("meetings"))
      if (["running", "paused", "finishing"].includes(m.status)) {
        this.put("meetings", m.id, m.id, {
          ...m,
          status: "ended",
          interrupted: true,
          endedAt: this.clock(),
        });
        for (const s of this.all("segments", m.id))
          if (!s.final)
            this.put("segments", m.id, s.id, {
              ...s,
              final: true,
              unfinalized: true,
            });
        this.put("events", m.id, randomUUID(), {
          kind: "gap",
          text: "Callwise closed before this meeting ended. No audio was captured while it was closed.",
          at: this.clock(),
        });
      }
    for (const j of this.all("jobs"))
      if (j.status === "running")
        this.put("jobs", j.meetingId, j.id, {
          ...j,
          status: "queued",
          recovered: true,
        });
    for (const a of this.all("audio_chunks"))
      if (!existsSync(path.join(this.directory, a.path)))
        this.put("audio_chunks", a.meetingId, a.id, { ...a, missing: true });
    const audio = path.join(this.directory, "audio");
    const valid = new Set(
      this.all("audio_chunks").map((a) => path.join(this.directory, a.path)),
    );
    const walk = (d) => {
      if (!existsSync(d)) return;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (!valid.has(p)) rmSync(p, { force: true });
      }
    };
    walk(audio);
    const temp = path.join(this.directory, "tmp");
    if (existsSync(temp)) rmSync(temp, { recursive: true, force: true });
  }
  writeAudio(meetingId, channel, sequence, bytes, timing) {
    checked(meetingId);
    if (
      !["mic", "system"].includes(channel) ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0
    )
      throw new Error("Invalid audio chunk.");
    const id = `${channel}:${sequence}`,
      relative = `audio/${meetingId}/${channel}/${sequence}.cwa`;
    atomicWrite(
      path.join(this.directory, relative),
      seal(this.key, bytes, `audio:${meetingId}:${id}`, this.keyId),
    );
    return this.put("audio_chunks", meetingId, id, {
      ...timing,
      channel,
      sequence,
      path: relative,
      bytes: bytes.length,
    });
  }
  readAudio(meetingId, id) {
    const row = this.get("audio_chunks", meetingId, id);
    if (!row || row.missing)
      throw new Error("This recording is no longer available.");
    return unseal(
      this.key,
      readFileSync(path.join(this.directory, row.path)),
      `audio:${meetingId}:${id}`,
      { keyId: this.keyId, binary: true },
    );
  }
  prune({ meetingDays = 0, audioDays = 30 } = {}) {
    const cutoff = this.clock();
    if (meetingDays > 0)
      for (const m of this.all("meetings"))
        if (
          m.status === "ended" &&
          m.createdAt < cutoff - meetingDays * 86400000
        )
          this.deleteMeeting(m.id);
    if (audioDays > 0)
      for (const a of this.all("audio_chunks")) {
        const m = this.get("meetings", a.meetingId);
        if (
          m?.status === "ended" &&
          m.createdAt < cutoff - audioDays * 86400000
        ) {
          rmSync(path.join(this.directory, a.path), { force: true });
          this.remove("audio_chunks", a.meetingId, a.id);
        }
      }
  }
  backup(passphrase) {
    const records = Object.fromEntries(TABLES.map((t) => [t, this.all(t)]));
    const audio = records.audio_chunks
      .filter((r) => !r.missing)
      .map((r) => ({
        meetingId: r.meetingId,
        id: r.id,
        data: this.readAudio(r.meetingId, r.id).toString("base64"),
      }));
    return sealBackup({ schema: SCHEMA_VERSION, records, audio }, passphrase);
  }
  restore(bytes, passphrase) {
    if (this.all("meetings", null, { limit: 1 }).length)
      throw new Error(
        "Restore requires an empty library. Export or back up your existing meetings first.",
      );
    const v = openBackup(bytes, passphrase);
    if (v.schema !== SCHEMA_VERSION || !v.records || !Array.isArray(v.audio))
      throw new Error("Unsupported backup.");
    for (const t of TABLES)
      for (const r of v.records[t] || []) {
        checked(r.id);
        checked(r.meetingId);
      }
    this.transaction(() => {
      for (const t of TABLES)
        for (const r of v.records[t] || [])
          if (t !== "audio_chunks") this.put(t, r.meetingId, r.id, r, 0);
    });
    for (const a of v.audio) {
      const r = v.records.audio_chunks.find(
        (r) => r.id === a.id && r.meetingId === a.meetingId,
      );
      if (r)
        this.writeAudio(
          r.meetingId,
          r.channel,
          r.sequence,
          Buffer.from(a.data, "base64"),
          r,
        );
    }
    this.recover();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (!this.readOnly) this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.close();
    this.key.fill(0);
  }
}
