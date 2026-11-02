import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
const VERSION = 1;
export function seal(
  key,
  value,
  aad = "",
  keyId = "archive",
  { version = VERSION } = {},
) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const payload = Buffer.isBuffer(value)
    ? value
    : Buffer.from(JSON.stringify(value));
  const body = Buffer.concat([cipher.update(payload), cipher.final()]);
  const id = Buffer.from(keyId);
  if (id.length > 255) throw new Error("Invalid archive key identifier.");
  return Buffer.concat([
    Buffer.from([version, id.length]),
    id,
    nonce,
    cipher.getAuthTag(),
    body,
  ]);
}
export function unseal(
  key,
  data,
  aad = "",
  { binary = false, keyId = "archive" } = {},
) {
  data = Buffer.from(data);
  if (![VERSION, 2].includes(data[0]) || data.length < 30 + data[1])
    throw new Error("Invalid encrypted meeting record.");
  const id = data.subarray(2, 2 + data[1]);
  if (
    id.length !== Buffer.byteLength(keyId) ||
    !timingSafeEqual(id, Buffer.from(keyId))
  )
    throw new Error("Wrong archive key.");
  const n = 2 + data[1];
  const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(n, n + 12));
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(data.subarray(n + 12, n + 28));
  const result = Buffer.concat([
    cipher.update(data.subarray(n + 28)),
    cipher.final(),
  ]);
  return binary ? result : JSON.parse(result.toString("utf8"));
}
export function sealBackup(value, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 12)
    throw new Error("Use a backup passphrase of at least 12 characters.");
  const salt = randomBytes(32);
  const key = scryptSync(passphrase, salt, 32, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  try {
    return Buffer.concat([
      Buffer.from("CWBACKUP1"),
      salt,
      seal(key, value, "callwise:backup:v1", "backup"),
    ]);
  } finally {
    key.fill(0);
  }
}
export function openBackup(data, passphrase) {
  data = Buffer.from(data);
  if (data.length < 80 || data.subarray(0, 9).toString() !== "CWBACKUP1")
    throw new Error("This is not a Callwise backup.");
  const key = scryptSync(passphrase, data.subarray(9, 41), 32, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  try {
    return unseal(key, data.subarray(41), "callwise:backup:v1", {
      keyId: "backup",
    });
  } catch {
    throw new Error("The backup could not be unlocked. Check the passphrase.");
  } finally {
    key.fill(0);
  }
}
