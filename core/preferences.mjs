// Saved defaults only: never transcripts, retrieved documents, or call consent.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function sanitizePreferences(patch, previous = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Invalid preferences.");
  const merged = { ...previous, ...patch }, next = {};
  for (const [key, limit] of Object.entries({mode:2000, goal:2000, profile:6000, project:100})) {
    if (merged[key] === undefined) continue;
    if (typeof merged[key] !== "string") throw new Error("Preferences must contain valid text.");
    next[key] = merged[key].slice(0, limit);
  }
  for (const key of ["quiet", "autoSearch", "contextConsent", "compact"]) {
    if (merged[key] === undefined) continue;
    if (typeof merged[key] !== "boolean") throw new Error("Invalid preference switch.");
    next[key] = merged[key];
  }
  for (const [key, allowed] of Object.entries({
    contextBackend:["off", "codex", "mcp"],
    preferredSource:["demo", "audio", "manual", "fireflies"],
    preferredBackend:["openai", "codex"],
  })) {
    if (merged[key] === undefined) continue;
    if (!allowed.includes(merged[key])) throw new Error("Choose a supported preference.");
    next[key] = merged[key];
  }
  if (merged.contextApps !== undefined) {
    if (!Array.isArray(merged.contextApps) || merged.contextApps.length > 12 ||
        merged.contextApps.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id)))
      throw new Error("Choose up to 12 valid context apps.");
    next.contextApps = [...new Set(merged.contextApps)];
  }
  return next;
}
function requireEncryption(storage) {
  if (!storage?.isEncryptionAvailable() || storage.getSelectedStorageBackend?.() === "basic_text")
    throw new Error("Preferences could not be saved. Unlock your keychain and reopen Callwise.");
}
export function readPreferences(filename, storage) {
  if (!existsSync(filename)) return {};
  requireEncryption(storage);
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64000)
    throw new Error("Saved preferences are invalid; the file was not replaced.");
  try { return sanitizePreferences(JSON.parse(storage.decryptString(readFileSync(filename)))); }
  catch { throw new Error("Saved preferences could not be unlocked; the file was not replaced."); }
}
export function savePreferences(filename, storage, preferences) {
  requireEncryption(storage);
  readPreferences(filename, storage); // Preserve unreadable files for recovery.
  const next = sanitizePreferences(preferences);
  const encrypted = storage.encryptString(JSON.stringify(next));
  mkdirSync(path.dirname(filename), {recursive:true, mode:0o700});
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, encrypted, {mode:0o600, flag:"wx"});
    renameSync(temporary, filename);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return next;
}
