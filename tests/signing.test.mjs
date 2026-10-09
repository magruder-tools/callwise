import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

test("signing setup exports a readable, reusable identity with the system OpenSSL and removes the loose private key", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "callwise-signing-test-"));
  const env = {
    ...process.env,
    CALLWISE_SIGNING_DIRECTORY: dir,
    CALLWISE_SIGNING_PASSWORD: randomBytes(32).toString("hex"),
    CALLWISE_OPENSSL_BIN:
      process.platform === "darwin" ? "/usr/bin/openssl" : "openssl",
  };
  const file = path.join(dir, "Callwise.p12");
  try {
    execFileSync(process.execPath, ["scripts/create-signing-identity.mjs"], {
      env,
      stdio: "pipe",
    });
    assert.ok(existsSync(file));
    assert.equal(existsSync(path.join(dir, "identity.key")), false);
    assert.equal(existsSync(path.join(dir, "signing.cnf")), false);
    const cert = execFileSync(
      env.CALLWISE_OPENSSL_BIN,
      [
        "pkcs12",
        "-in",
        file,
        "-clcerts",
        "-nokeys",
        "-passin",
        "env:CALLWISE_SIGNING_PASSWORD",
      ],
      { env },
    );
    const details = execFileSync(
      env.CALLWISE_OPENSSL_BIN,
      ["x509", "-noout", "-text"],
      { input: cert, encoding: "utf8" },
    );
    assert.match(details, /Code Signing/);
    assert.match(details, /CA:FALSE/);
    const original = readFileSync(file);
    const second = spawnSync(
      process.execPath,
      ["scripts/create-signing-identity.mjs"],
      { env, encoding: "utf8" },
    );
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /Reuse it/);
    assert.deepEqual(readFileSync(file), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
