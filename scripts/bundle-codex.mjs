// Build-time only: include the public, pinned native Codex executable so the
// person installing Callwise does not need Node, npm, or a separate CLI install.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, rmSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
const version = "0.153.4";
const spec = `@openai/codex@${version}-darwin-arm64`;
const work = mkdtempSync(path.join(tmpdir(), "callwise-codex-bundle-"));
const out = path.resolve("bundled/codex");
try {
  const [pkg] = JSON.parse(execFileSync("npm", ["pack", spec, "--json", "--pack-destination", work], {
    encoding: "utf8", timeout: 180000, maxBuffer: 2000000,
  }));
  const archive = path.join(work, path.basename(pkg.filename));
  const integrity = `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;
  if (pkg.integrity !== integrity) throw new Error("Codex archive integrity mismatch.");
  const members = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", timeout: 30000, maxBuffer: 2000000 }).trim().split("\n");
  if (members.some(name => path.isAbsolute(name) || name.split("/").includes("..")))
    throw new Error("The Codex archive contains an unsafe path.");
  const candidates = members.filter(name => name.includes("/aarch64-apple-darwin/") && path.posix.basename(name) === "codex" && !name.endsWith("/"));
  if (candidates.length !== 1) throw new Error("The pinned Codex package must contain exactly one Apple Silicon codex executable.");
  execFileSync("tar", ["-xzf", archive, "-C", work], { timeout: 30000 });
  const binary = path.join(work, candidates[0]);
  const stat = lstatSync(binary);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The Codex executable is not a regular file.");
  const kind = execFileSync("file", ["-b", binary], { encoding: "utf8", timeout: 5000 });
  if (!kind.includes("Mach-O") || !kind.includes("arm64")) throw new Error("The Codex executable is not a native Apple Silicon binary.");
  mkdirSync(out, { recursive: true });
  copyFileSync(binary, path.join(out, "codex"));
  chmodSync(path.join(out, "codex"), 0o755);
  for (const name of ["LICENSE", "NOTICE"]) {
    const response = await fetch(`https://raw.githubusercontent.com/openai/codex/rust-v${version}/${name}`, { signal: AbortSignal.timeout(15000) });
    if (name === "NOTICE" && response.status === 404) continue;
    if (!response.ok) throw new Error(`Could not obtain the Codex ${name} notice.`);
    writeFileSync(path.join(out, name), await response.text());
  }
  const manifest = { version, package: spec, integrity, archivePath: candidates[0],
    sha256: createHash("sha256").update(readFileSync(binary)).digest("hex"),
    source: `https://github.com/openai/codex/tree/rust-v${version}`,
    modified: false };
  writeFileSync(path.join(out, "BUILD.json"), JSON.stringify(manifest, null, 2));
  console.log(`Bundled official Codex ${version} for Apple Silicon; archive integrity and native architecture verified.`);
} finally { rmSync(work, { recursive: true, force: true }); }
