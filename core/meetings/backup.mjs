import { randomBytes, scryptSync } from "node:crypto";
import { openSync, readSync, closeSync } from "node:fs";
import { seal, unseal } from "./crypto.mjs";
const MAGIC = Buffer.from("CWBACKUP2");
const MAX_FRAME = 16 * 1024 * 1024;
function derive(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < 12)
    throw new Error("Use a backup passphrase of at least 12 characters.");
  return scryptSync(passphrase, salt, 32, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
}
export function* sealFrames(frames, passphrase) {
  const salt = randomBytes(32),
    key = derive(passphrase, salt);
  try {
    yield Buffer.concat([MAGIC, salt]);
    let index = 0;
    for (const frame of frames) {
      const data = seal(
        key,
        frame,
        `callwise:backup:v2:${salt.toString("hex")}:${index++}`,
        "backup",
      );
      if (data.length > MAX_FRAME)
        throw new Error("A backup record is too large.");
      const size = Buffer.alloc(4);
      size.writeUInt32BE(data.length);
      yield size;
      yield data;
    }
  } finally {
    key.fill(0);
  }
}
export function* openFrames(source, passphrase) {
  let fd,
    offset = 0;
  const read = (size) => {
    const data = Buffer.alloc(size);
    let count = 0;
    while (count < size) {
      const n = Buffer.isBuffer(source)
        ? source.copy(data, count, offset, offset + size - count)
        : readSync(fd, data, count, size - count, offset);
      if (!n) break;
      offset += n;
      count += n;
    }
    if (count && count !== size) throw new Error("The backup is incomplete.");
    return count ? data : null;
  };
  let key;
  try {
    if (!Buffer.isBuffer(source)) fd = openSync(source, "r");
    const header = read(41);
    if (!header || !header.subarray(0, 9).equals(MAGIC))
      throw new Error("Unsupported backup.");
    const salt = header.subarray(9);
    key = derive(passphrase, salt);
    let index = 0;
    while (true) {
      const size = read(4);
      if (!size) return;
      const n = size.readUInt32BE();
      if (n < 32 || n > MAX_FRAME) throw new Error("Invalid backup frame.");
      const data = read(n);
      if (!data) throw new Error("The backup is incomplete.");
      yield unseal(
        key,
        data,
        `callwise:backup:v2:${salt.toString("hex")}:${index++}`,
        { keyId: "backup" },
      );
    }
  } catch (error) {
    throw new Error("The backup could not be unlocked or is incomplete.", {
      cause: error,
    });
  } finally {
    key?.fill(0);
    if (fd !== undefined) closeSync(fd);
  }
}
