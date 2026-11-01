// Build-time only: include the public, pinned native Codex executable so the
// person installing Callwise does not need Node, npm, or a separate CLI install.
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  rmSync,
  lstatSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexBinaries } from "./codex-bundle.mjs";
const version = "0.153.4";
const spec = `@openai/codex@${version}-darwin-arm64`;
const work = mkdtempSync(path.join(tmpdir(), "callwise-codex-bundle-"));
const out = path.resolve("bundled/codex");
try {
  const npmCli = process.env.CALLWISE_NPM_CLI || process.env.npm_execpath;
  const packed = JSON.parse(
    execFileSync(
      npmCli ? process.execPath : "npm",
      [
        ...(npmCli ? [npmCli] : []),
        "pack",
        spec,
        "--json",
        "--pack-destination",
        work,
      ],
      {
        encoding: "utf8",
        timeout: 180000,
        maxBuffer: 2000000,
      },
    ),
  );
  const packages = Array.isArray(packed) ? packed : Object.values(packed);
  if (
    packages.length !== 1 ||
    packages[0]?.version !== `${version}-darwin-arm64`
  )
    throw new Error(
      "The package manager did not return the pinned Codex archive.",
    );
  const [pkg] = packages;
  const archive = path.join(work, path.basename(pkg.filename));
  const integrity = `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;
  if (pkg.integrity !== integrity)
    throw new Error("Codex archive integrity mismatch.");
  const members = execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 2000000,
  })
    .trim()
    .split("\n");
  const binaries = codexBinaries(members);
  execFileSync(
    "tar",
    ["-xzf", archive, "-C", work, ...Object.values(binaries)],
    { timeout: 30000 },
  );
  mkdirSync(out, { recursive: true });
  const hashes = {};
  for (const [name, member] of Object.entries(binaries)) {
    const binary = path.join(work, member),
      stat = lstatSync(binary);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`The ${name} executable is not a regular file.`);
    const kind = execFileSync("file", ["-b", binary], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (!kind.includes("Mach-O") || !kind.includes("arm64"))
      throw new Error(
        `The ${name} executable is not a native Apple Silicon binary.`,
      );
    copyFileSync(binary, path.join(out, name));
    chmodSync(path.join(out, name), 0o755);
    hashes[name] = createHash("sha256")
      .update(readFileSync(binary))
      .digest("hex");
  }
  for (const name of ["LICENSE", "NOTICE"]) {
    const response = await fetch(
      `https://raw.githubusercontent.com/openai/codex/rust-v${version}/${name}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (name === "NOTICE" && response.status === 404) continue;
    if (!response.ok)
      throw new Error(`Could not obtain the Codex ${name} notice.`);
    writeFileSync(path.join(out, name), await response.text());
  }
  const manifest = {
    version,
    package: spec,
    integrity,
    archivePath: binaries.codex,
    archivePaths: binaries,
    sha256: hashes.codex,
    binaryHashesBeforeAppSigning: hashes,
    source: `https://github.com/openai/codex/tree/rust-v${version}`,
    modified: false,
  };
  writeFileSync(
    path.join(out, "BUILD.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    `Bundled official Codex ${version} and its tool host for Apple Silicon; archive integrity and native architectures verified.`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
