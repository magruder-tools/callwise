// Run once on your own Mac. Private key material must never enter this repository.
import { execFileSync } from "node:child_process";
import { mkdirSync, chmodSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
const dir =
  process.env.CALLWISE_SIGNING_DIRECTORY ||
  path.join(homedir(), "Library", "Application Support", "Callwise Signing");
const password = process.env.CALLWISE_SIGNING_PASSWORD;
if (!password || password.length < 16)
  throw new Error(
    "Set CALLWISE_SIGNING_PASSWORD to a private password of at least 16 characters. Keep it in your password manager.",
  );
mkdirSync(dir, { recursive: true, mode: 0o700 });
const key = path.join(dir, "identity.key"),
  cert = path.join(dir, "identity.crt"),
  p12 = path.join(dir, "Callwise.p12");
if (existsSync(p12))
  throw new Error(
    "A persistent certificate already exists. Reuse it; do not regenerate an identity for each release.",
  );
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "3650",
    "-subj",
    "/CN=Callwise Personal Signing",
    "-addext",
    "keyUsage=critical,digitalSignature",
    "-addext",
    "extendedKeyUsage=critical,codeSigning",
  ],
  { stdio: "ignore" },
);
chmodSync(key, 0o600);
try {
  execFileSync(
    "openssl",
    [
      "pkcs12",
      "-export",
      "-legacy",
      "-inkey",
      key,
      "-in",
      cert,
      "-out",
      p12,
      "-passout",
      "env:CALLWISE_SIGNING_PASSWORD",
    ],
    { stdio: "ignore" },
  );
  chmodSync(p12, 0o600);
} finally {
  rmSync(key, { force: true });
}
console.log(
  `Persistent certificate created at ${p12}. Store its base64 encoding in the CALLWISE_SIGNING_P12 Actions secret and the password in CALLWISE_SIGNING_PASSWORD. Keep a private backup and reuse this exact certificate for future builds.`,
);
