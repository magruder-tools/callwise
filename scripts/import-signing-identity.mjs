import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
const encoded = process.env.CALLWISE_SIGNING_P12,
  password = process.env.CALLWISE_SIGNING_PASSWORD;
if (!encoded || !password) {
  if (process.env.CALLWISE_RELEASE === "1")
    throw new Error(
      "Configure the persistent signing certificate in repository Actions secrets before publishing a release.",
    );
  console.log(
    "No persistent certificate configured. Building a development preview only.",
  );
  process.exit(0);
}
const dir = process.env.RUNNER_TEMP || process.cwd(),
  file = path.join(dir, "callwise-signing.p12"),
  keychain = path.join(dir, "callwise-signing.keychain-db"),
  keychainPassword = randomBytes(32).toString("hex");
console.log(`::add-mask::${keychainPassword}`);
writeFileSync(file, Buffer.from(encoded, "base64"), { mode: 0o600 });
try {
  execFileSync(
    "security",
    ["create-keychain", "-p", keychainPassword, keychain],
    { stdio: "ignore" },
  );
  execFileSync(
    "security",
    ["set-keychain-settings", "-lut", "21600", keychain],
    { stdio: "ignore" },
  );
  execFileSync(
    "security",
    ["unlock-keychain", "-p", keychainPassword, keychain],
    { stdio: "ignore" },
  );
  execFileSync(
    "security",
    ["import", file, "-k", keychain, "-P", password, "-T", "/usr/bin/codesign"],
    { stdio: "ignore" },
  );
  execFileSync(
    "security",
    [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      keychainPassword,
      keychain,
    ],
    { stdio: "ignore" },
  );
  const cert = path.join(dir, "callwise-signing.crt");
  try {
    execFileSync(
      "openssl",
      [
        "pkcs12",
        "-in",
        file,
        "-clcerts",
        "-nokeys",
        "-passin",
        "env:CALLWISE_SIGNING_PASSWORD",
        "-out",
        cert,
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "sudo",
      [
        "security",
        "add-trusted-cert",
        "-d",
        "-r",
        "trustRoot",
        "-p",
        "codeSign",
        "-k",
        keychain,
        cert,
      ],
      { stdio: "ignore" },
    );
  } finally {
    try {
      unlinkSync(cert);
    } catch {}
  }
  const output = execFileSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning", keychain],
    { encoding: "utf8" },
  );
  const identity = output
    .match(/\b([A-Fa-f0-9]{40})\s+"/g)?.[0]
    ?.match(/[A-Fa-f0-9]{40}/)?.[0];
  if (!identity)
    throw new Error(
      "The certificate isn't a usable code-signing identity. Trust the self-signed code-signing certificate and export it with its private key.",
    );
  appendFileSync(
    process.env.GITHUB_ENV,
    `CALLWISE_SIGN_IDENTITY=${identity}\nCALLWISE_SIGN_KEYCHAIN=${keychain}\n`,
  );
} finally {
  unlinkSync(file);
}
