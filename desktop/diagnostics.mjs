import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { safeErrorLabel } from "../providers/errors.mjs";

const states = new Set([
  "idle",
  "running",
  "paused",
  "ended",
  "off",
  "starting",
  "connected",
  "capturing",
  "reconnecting",
  "failed",
  "error",
  "closed",
  "backpressure",
  "active",
  "silent",
  "stopped",
  "listening",
  "receiving",
]);
const numeric = new Set([
  "attempt",
  "delayMs",
  "latencyMs",
  "requestedAt",
  "firstTokenAt",
  "firstPaintAt",
  "doneAt",
  "lostMs",
  "bufferMs",
  "status",
]);
export function diagnosticFields(fields = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(fields)) {
    if (numeric.has(key) && Number.isFinite(value) && value >= 0)
      safe[key] = value;
    else if (key === "state" && states.has(value)) safe[key] = value;
    else if (key === "channel" && ["mic", "system"].includes(value))
      safe[key] = value;
    else if (key === "lane" && ["fast", "strategy"].includes(value))
      safe[key] = value;
    else if (key === "origin" && ["auto", "asked", "hotkey"].includes(value))
      safe[key] = value;
    else if (["code", "type"].includes(key) && safeErrorLabel(value))
      safe[key] = value;
  }
  return safe;
}

export class Diagnostics {
  constructor(
    directory,
    { maxBytes = 1024 * 1024, files = 5, versions = {}, clock = Date.now } = {},
  ) {
    this.filename = path.join(directory, "callwise.log");
    this.maxBytes = maxBytes;
    this.files = files;
    this.clock = clock;
    this.versions = Object.fromEntries(
      Object.entries(versions).filter(
        ([key, value]) =>
          ["app", "os", "electron", "node"].includes(key) &&
          typeof value === "string" &&
          /^[a-zA-Z0-9. _()+-]{1,100}$/.test(value),
      ),
    );
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.write("app.start");
  }
  write(event, fields = {}) {
    if (!/^[a-z][a-z0-9_.]{0,63}$/.test(event)) return;
    try {
      const line =
        JSON.stringify({
          at: new Date(this.clock()).toISOString(),
          event,
          ...(event === "app.start" ? { versions: this.versions } : {}),
          ...diagnosticFields(fields),
        }) + "\n";
      if (
        existsSync(this.filename) &&
        statSync(this.filename).size + Buffer.byteLength(line) > this.maxBytes
      ) {
        for (let i = this.files - 1; i >= 1; i--) {
          const from = i === 1 ? this.filename : `${this.filename}.${i - 1}`;
          const to = `${this.filename}.${i}`;
          if (existsSync(to)) unlinkSync(to);
          if (existsSync(from)) renameSync(from, to);
        }
      }
      appendFileSync(this.filename, line, { mode: 0o600 });
    } catch {
      /* Diagnostics must never interrupt a call. */
    }
  }
  copy({ status, source, config = {}, preferences = {} } = {}) {
    const lines = [];
    for (let i = this.files - 1; i >= 0; i--) {
      const file = i === 0 ? this.filename : `${this.filename}.${i}`;
      try {
        lines.push(...readFileSync(file, "utf8").trim().split("\n"));
      } catch {
        /* Optional rotated file. */
      }
    }
    const summary = {
      versions: this.versions,
      state: states.has(status) ? status : "unknown",
      source: ["demo", "audio", "manual", "fireflies"].includes(source)
        ? source
        : "unknown",
      openaiConfigured: !!config.openaiKey,
      firefliesConfigured: !!config.firefliesKey,
      contextBackend: ["off", "codex", "mcp"].includes(
        preferences.contextBackend,
      )
        ? preferences.contextBackend
        : "off",
      quiet: preferences.quiet === true,
      autoSearch: preferences.autoSearch === true,
      floatingPanel: preferences.compact === true,
    };
    const safeLines = lines.flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        if (
          !/^[a-z][a-z0-9_.]{0,63}$/.test(entry.event) ||
          !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(entry.at)
        )
          return [];
        return [
          JSON.stringify({
            at: entry.at,
            event: entry.event,
            ...diagnosticFields(entry),
          }),
        ];
      } catch {
        return [];
      }
    });
    return `Callwise diagnostics\n${JSON.stringify(summary, null, 2)}\n\nRecent events\n${safeLines.slice(-200).join("\n")}`;
  }
}
