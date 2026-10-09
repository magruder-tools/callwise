import {
  existsSync,
  lstatSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const MATERIAL_LIMIT = 2 * 1024 * 1024;
export function sanitizeSheets(sheets) {
  if (!Array.isArray(sheets) || sheets.length > 5)
    throw new Error("Saved calls are invalid.");
  return sheets.map((s) => {
    if (
      !s ||
      typeof s.id !== "string" ||
      !Array.isArray(s.materials) ||
      s.materials.length > 150
    )
      throw new Error("Saved calls are invalid.");
    const materials = s.materials.map((d) => ({
      id: String(d.id || randomUUID()).slice(0, 200),
      title: String(d.title || "Notes").slice(0, 200),
      text: String(d.text || ""),
      kind: "document",
      url: /^https?:\/\//.test(d.url || "") ? String(d.url).slice(0, 2000) : "",
    }));
    if (
      materials.reduce((n, d) => n + Buffer.byteLength(d.text), 0) >
      MATERIAL_LIMIT
    )
      throw new Error("Keep extracted material below 2 MB per call.");
    return {
      id: s.id.slice(0, 200),
      name: String(s.name || s.line || "Untitled call").slice(0, 100),
      type: ["interview", "sales", "client", "negotiation", "general"].includes(
        s.type,
      )
        ? s.type
        : "general",
      line: String(s.line || "").slice(0, 2000),
      materials,
      history: (Array.isArray(s.history) ? s.history : [])
        .slice(-3)
        .map((h) => ({
          at: String(h.at || "").slice(0, 30),
          recap: String(h.recap || "").slice(0, 20000),
        })),
      updatedAt: Number(s.updatedAt) || Date.now(),
    };
  });
}
function secure(storage) {
  if (
    !storage?.isEncryptionAvailable() ||
    storage.getSelectedStorageBackend?.() === "basic_text"
  )
    throw new Error("Unlock your keychain to save calls. Nothing was saved.");
}
export function readSheets(file, storage) {
  if (!existsSync(file)) return [];
  secure(storage);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
    throw new Error("Saved calls are invalid; the file was preserved.");
  try {
    return sanitizeSheets(
      JSON.parse(storage.decryptString(readFileSync(file))),
    );
  } catch {
    throw new Error(
      "Saved calls couldn't be unlocked; the file was preserved.",
    );
  }
}
export function saveSheets(file, storage, sheets) {
  secure(storage);
  readSheets(file, storage);
  const next = sanitizeSheets(sheets),
    temp = `${file}.${randomUUID()}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temp, storage.encryptString(JSON.stringify(next)), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temp, file);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
  return next;
}
