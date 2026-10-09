import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
export const keySignature = (config) =>
  createHash("sha256")
    .update(
      [
        config.openaiKey,
        config.fastModel,
        config.strategyModel,
        config.transcriptionModel,
      ].join("\0"),
    )
    .digest("hex");
export function readReadiness(file, storage) {
  if (!existsSync(file)) return {};
  try {
    const stat = lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 32000 ||
      !storage.isEncryptionAvailable()
    )
      return {};
    return JSON.parse(storage.decryptString(readFileSync(file)));
  } catch {
    return {};
  }
}
export function saveReadiness(file, storage, value) {
  if (
    !storage.isEncryptionAvailable() ||
    storage.getSelectedStorageBackend?.() === "basic_text"
  )
    return;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, storage.encryptString(JSON.stringify(value)), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temp, file);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
