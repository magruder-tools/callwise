import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";

test("signing setup exports a readable, reusable identity with the system OpenSSL and removes the loose private key", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "callwise-signing-test-"));
  const env = {
    ...process.env,
    CALLWISE_SIGNING_DIRECTORY: dir,
    CALLWISE_GH_BIN: path.join(dir, "unavailable-gh"),
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

test("signing setup configures both Actions secrets through authenticated gh stdin", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "callwise-signing-gh-"));
  const fake = path.join(dir, "fake-gh.mjs"),
    log = path.join(dir, "gh-calls.jsonl");
  writeFileSync(
    fake,
    `#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const input = process.argv[2] === 'secret' ? readFileSync(0) : Buffer.alloc(0);
appendFileSync(process.env.CALLWISE_GH_TEST_LOG, JSON.stringify({args:process.argv.slice(2),bytes:input.length,hash:createHash('sha256').update(input).digest('hex')})+'\\n', {mode:0o600});
`,
  );
  chmodSync(fake, 0o700);
  const password = randomBytes(32).toString("hex");
  try {
    const output = execFileSync(
      process.execPath,
      ["scripts/create-signing-identity.mjs"],
      {
        env: {
          ...process.env,
          CALLWISE_SIGNING_DIRECTORY: dir,
          CALLWISE_SIGNING_PASSWORD: password,
          CALLWISE_GH_BIN: fake,
          CALLWISE_GH_TEST_LOG: log,
        },
        encoding: "utf8",
      },
    );
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      calls.map((c) => c.args),
      [
        ["auth", "status"],
        [
          "secret",
          "set",
          "CALLWISE_SIGNING_P12",
          "--repo",
          "magruder-tools/callwise",
        ],
        [
          "secret",
          "set",
          "CALLWISE_SIGNING_PASSWORD",
          "--repo",
          "magruder-tools/callwise",
        ],
      ],
    );
    const hash = (input) => createHash("sha256").update(input).digest("hex");
    assert.equal(
      calls[1].hash,
      hash(readFileSync(path.join(dir, "Callwise.p12")).toString("base64")),
    );
    assert.equal(calls[2].hash, hash(password));
    assert.doesNotMatch(output, new RegExp(password));
    assert.match(output, /both Actions secrets configured/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
