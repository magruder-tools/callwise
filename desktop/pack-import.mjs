import { readFileSync, lstatSync, realpathSync, readdirSync, watch } from "node:fs";
import path from "node:path";
import { inflateRawSync, crc32 } from "node:zlib";
import AdmZip from "adm-zip";
import { PACK_LIMITS, validatePack } from "../core/packs.mjs";

const MAX_ARCHIVE = 50 * 1024 * 1024;
function safeName(name) { return typeof name === "string" && name.length < 500 && !name.includes("\\") && !name.includes("\0") && !path.posix.isAbsolute(name) && !name.split("/").some((p) => p === ".." || p === "."); }
function fileBytes(filename, maximum) {
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error("Pack file is too large or is not a regular file.");
  return readFileSync(filename);
}
export function imageData(bytes, filename) {
  const ext = path.extname(filename).toLowerCase(), mimes = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
  if (!mimes[ext] || bytes.length > PACK_LIMITS.image) throw new Error("Each pack image must be SVG, PNG, JPEG or WebP and at most 5 MB.");
  if (ext === ".svg") {
    const svg = bytes.toString("utf8");
    // Image elements do not execute scripts, but also reject active/external resources at import.
    if (!/<svg\b/i.test(svg) || /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|image|use)\b|\bon\w+\s*=|(?:href|src)\s*=|url\s*\(/i.test(svg)) throw new Error("SVG tiles must be self-contained drawings without scripts or linked resources.");
  } else if ((ext === ".png" && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    ([".jpg", ".jpeg"].includes(ext) && (bytes[0] !== 255 || bytes[1] !== 216)) ||
    (ext === ".webp" && (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP"))) throw new Error("Invalid image data.");
  return `data:${mimes[ext]};base64,${bytes.toString("base64")}`;
}
export function readPackPath(filename) {
  const stat = lstatSync(filename);
  if (stat.isSymbolicLink()) throw new Error("Choose a prep pack file or folder, not a symbolic link.");
  let pack, images = {};
  if (stat.isDirectory() || path.basename(filename).toLowerCase() === "pack.json" || path.extname(filename).toLowerCase() === ".json") {
    const jsonPath = stat.isDirectory() ? path.join(filename, "pack.json") : filename, directory = realpathSync(path.dirname(jsonPath));
    pack = validatePack(fileBytes(jsonPath, PACK_LIMITS.json).toString("utf8"));
    for (const tile of pack.tiles) {
      const image = path.join(directory, tile.file);
      try { lstatSync(image); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (lstatSync(image).isSymbolicLink() || !realpathSync(image).startsWith(directory + path.sep)) throw new Error("A tile points outside the pack folder.");
      images[tile.file] = imageData(fileBytes(image, PACK_LIMITS.image), tile.file);
    }
  } else if (path.extname(filename).toLowerCase() === ".zip") {
    const zip = new AdmZip(fileBytes(filename, MAX_ARCHIVE)), entries = zip.getEntries();
    if (entries.length > 500) throw new Error("A prep zip contains too many files.");
    const byName = new Map(); let total = 0;
    for (const e of entries) {
      if (!safeName(e.entryName) || byName.has(e.entryName) || ((e.header.attr >>> 16) & 0xf000) === 0xa000) throw new Error("Unsafe or duplicate path in prep zip.");
      total += e.header.size;
      if (e.header.size > PACK_LIMITS.image || total > MAX_ARCHIVE) throw new Error("Prep zip expands beyond its size limit.");
      byName.set(e.entryName, e);
    }
    const jsons = entries.filter((e) => !e.isDirectory && /(?:^|\/)pack\.json$/i.test(e.entryName));
    if (jsons.length !== 1) throw new Error("A prep zip must contain one pack.json.");
    const read = (e, max) => {
      if (!e || e.isDirectory || e.header.size > max || (e.header.flags & 1)) throw new Error("Missing, encrypted or oversized pack entry.");
      const compressed = e.getCompressedData();
      const data = e.header.method === 0 ? compressed : e.header.method === 8 ? inflateRawSync(compressed, { maxOutputLength: max }) : null;
      if (!data || data.length > max || data.length !== e.header.size || crc32(data) !== e.header.crc) throw new Error("Damaged pack entry.");
      return data;
    };
    pack = validatePack(read(jsons[0], PACK_LIMITS.json).toString("utf8"));
    const prefix = path.posix.dirname(jsons[0].entryName);
    for (const tile of pack.tiles) {
      const entry = byName.get(prefix === "." ? tile.file : `${prefix}/${tile.file}`);
      if (entry) images[tile.file] = imageData(read(entry, PACK_LIMITS.image), tile.file);
    }
  } else throw new Error("Choose a pack.json, a prep folder or a .zip.");
  return { pack, images };
}
export class PackInbox {
  constructor({ bank, onError = () => {}, onChange = () => {} }) { Object.assign(this, { bank, onError, onChange }); this.seen = new Map(); this.state = { path: null, enabled: false }; }
  import(filename, origin = "import") { const { pack, images } = readPackPath(filename); return this.bank.import(pack, { origin, images }); }
  start(directory) {
    this.close();
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error("Choose a regular prep folder.");
    this.state = { path: realpathSync(directory), enabled: true }; this.seen.clear();
    this.watcher = watch(directory, () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.scan(), 400); this.timer.unref?.(); });
    this.watcher.on("error", () => { this.close(); this.onError(new Error("The watched prep folder is unavailable. Choose it again in Settings.")); });
    this.poll = setInterval(() => this.scan(), 5000); this.poll.unref?.(); this.scan(); this.onChange(this.state);
  }
  scan() {
    if (!this.state.enabled) return;
    try {
      for (const entry of readdirSync(this.state.path, { withFileTypes: true }).slice(0, 500)) {
        if (entry.isSymbolicLink() || !(entry.isDirectory() || /(?:\.zip|\.json)$/i.test(entry.name))) continue;
        const filename = path.join(this.state.path, entry.name), target = entry.isDirectory() ? path.join(filename, "pack.json") : filename;
        try {
          const stat = lstatSync(target), fingerprint = `${stat.mtimeMs}:${stat.size}`;
          if (this.seen.get(filename) === fingerprint) continue;
          this.import(filename, "watched_folder"); this.seen.set(filename, fingerprint);
        } catch (error) { if (error.code !== "ENOENT") this.onError(error); }
      }
    } catch { this.onError(new Error("The watched prep folder could not be read.")); }
  }
  close() { this.watcher?.close(); this.watcher = null; clearTimeout(this.timer); clearInterval(this.poll); this.state.enabled = false; this.onChange(this.state); }
}
