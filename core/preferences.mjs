// Saved defaults only: never transcripts, retrieved documents, or call consent.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sanitizePrices } from "./cost.mjs";

export function sanitizePreferences(patch, previous = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Invalid preferences.");
  const merged = { ...previous, ...patch },
    next = {};
  for (const [key, limit] of Object.entries({
    mode: 2000,
    goal: 2000,
    profile: 6000,
    project: 100,
    userName: 100,
    inputDevice: 300,
    language: 10,
  })) {
    if (merged[key] === undefined) continue;
    if (typeof merged[key] !== "string")
      throw new Error("Preferences must contain valid text.");
    next[key] = merged[key].slice(0, limit);
    if (
      key === "goal" &&
      next[key] === "Have a useful conversation and agree on clear next steps."
    )
      next[key] = "";
  }
  for (const key of ["quiet", "autoSearch", "contextConsent", "compact"]) {
    if (merged[key] === undefined) continue;
    if (typeof merged[key] !== "boolean")
      throw new Error("Invalid preference switch.");
    next[key] = merged[key];
  }
  for (const [key, allowed] of Object.entries({
    contextBackend: ["off", "codex", "mcp"],
    preferredSource: ["demo", "audio", "manual", "fireflies"],
    preferredBackend: ["openai", "codex"],
  })) {
    if (merged[key] === undefined) continue;
    if (!allowed.includes(merged[key]))
      throw new Error("Choose a supported preference.");
    next[key] = merged[key];
  }
  if (merged.contextApps !== undefined) {
    if (
      !Array.isArray(merged.contextApps) ||
      merged.contextApps.length > 12 ||
      merged.contextApps.some(
        (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id),
      )
    )
      throw new Error("Choose up to 12 valid context apps.");
    next.contextApps = [...new Set(merged.contextApps)];
  }
  if (next.mode === "strategy") next.mode = "client";
  if (next.preferredSource === "demo") next.preferredSource = "audio";
  for (const key of ["debug", "floatPanel", "setupDismissed"])
    if (merged[key] !== undefined) {
      if (typeof merged[key] !== "boolean")
        throw new Error("Invalid preference switch.");
      next[key] = merged[key];
    }
  if (merged.transcriptionDelay !== undefined) {
    if (
      !["minimal", "low", "medium", "high"].includes(merged.transcriptionDelay)
    )
      throw new Error("Choose a supported transcription delay.");
    next.transcriptionDelay = merged.transcriptionDelay;
  }
  if (merged.prices !== undefined) next.prices = sanitizePrices(merged.prices);
  if (merged.hotkeys !== undefined) {
    next.hotkeys = {};
    for (const [action, accelerator] of Object.entries(merged.hotkeys)) {
      if (
        !["help", "pause", "previous", "next", "visibility"].includes(action) ||
        typeof accelerator !== "string" ||
        !/^Control\+Alt\+(?:Shift\+)?(?:[A-Z0-9\[\]]|Space|Left|Right)$/.test(
          accelerator,
        )
      )
        throw new Error("Choose a Control + Option shortcut.");
      next.hotkeys[action] = accelerator;
    }
    if (
      new Set(Object.values(next.hotkeys)).size !==
      Object.values(next.hotkeys).length
    )
      throw new Error("Each shortcut must be different.");
  }
  if (merged.panelBounds !== undefined) {
    next.panelBounds = {};
    for (const [id, b] of Object.entries(merged.panelBounds).slice(0, 12)) {
      if (
        !/^[-0-9]{1,30}$/.test(id) ||
        !b ||
        ![b.x, b.y, b.width].every(Number.isFinite)
      )
        continue;
      next.panelBounds[id] = {
        x: Math.round(b.x),
        y: Math.round(b.y),
        width: Math.max(340, Math.min(640, Math.round(b.width))),
      };
    }
  }
  return next;
}
function requireEncryption(storage) {
  if (
    !storage?.isEncryptionAvailable() ||
    storage.getSelectedStorageBackend?.() === "basic_text"
  )
    throw new Error(
      "Preferences could not be saved. Unlock your keychain and reopen Callwise.",
    );
}
export function readPreferences(filename, storage) {
  if (!existsSync(filename)) return {};
  requireEncryption(storage);
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64000)
    throw new Error(
      "Saved preferences are invalid; the file was not replaced.",
    );
  try {
    return sanitizePreferences(
      JSON.parse(storage.decryptString(readFileSync(filename))),
    );
  } catch {
    throw new Error(
      "Saved preferences could not be unlocked; the file was not replaced.",
    );
  }
}
export function savePreferences(filename, storage, preferences) {
  requireEncryption(storage);
  readPreferences(filename, storage); // Preserve unreadable files for recovery.
  const next = sanitizePreferences(preferences);
  const encrypted = storage.encryptString(JSON.stringify(next));
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, encrypted, { mode: 0o600, flag: "wx" });
    renameSync(temporary, filename);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return next;
}
