// Package from an isolated dependency tree so iCloud hydration cannot stall a build.
import {
  cpSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
const root = path.resolve(import.meta.dirname, "..");
const stage =
  process.env.CALLWISE_BUILD_STAGE ||
  path.join(os.tmpdir(), `callwise-build-${process.getuid?.() || "local"}`);
if (path.resolve(stage) === root || !path.isAbsolute(stage))
  throw new Error("Use a separate absolute temporary build folder.");
mkdirSync(stage, { recursive: true, mode: 0o700 });
const sources = [
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "core",
  "desktop",
  "providers",
  "ui",
  "fixtures",
  "assets",
  "build",
  "scripts/sign-mac.mjs",
  "native/build",
  "native/resources",
  "bundled/codex",
];
for (const item of sources) {
  const from = path.join(root, item),
    to = path.join(stage, item);
  if (!existsSync(from)) throw new Error(`Build input missing: ${item}`);
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}
const lockHash = createHash("sha256")
  .update(readFileSync(path.join(stage, "package-lock.json")))
  .digest("hex");
const marker = path.join(stage, ".callwise-lock");
const env = {
  ...process.env,
  PATH: [
    path.join(stage, "node_modules/.bin"),
    path.dirname(process.execPath),
    process.env.PATH,
  ].join(path.delimiter),
};
function run(bin, args, cwd = stage) {
  const result = spawnSync(bin, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(
      "Callwise packaging did not complete. See the build output.",
    );
}
if (
  !existsSync(marker) ||
  readFileSync(marker, "utf8") !== lockHash ||
  !existsSync(path.join(stage, "node_modules/electron-builder/cli.js"))
) {
  const cli =
    process.env.CALLWISE_NPM_CLI ||
    path.join(root, "node_modules/npm/bin/npm-cli.js");
  run(process.execPath, [
    cli,
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  writeFileSync(marker, lockHash);
}
run(process.execPath, [
  path.join(stage, "node_modules/electron-builder/cli.js"),
  "--mac",
  "--arm64",
  "--dir",
  "--publish",
  "never",
]);
const version = JSON.parse(
  readFileSync(path.join(root, "package.json")),
).version;
const output = path.join(root, "release", `local-${version}`),
  built = path.join(stage, "release/mac-arm64/Callwise.app"),
  destination = path.join(output, "Callwise.app");
mkdirSync(output, { recursive: true });
if (existsSync(destination))
  rmSync(destination, { recursive: true, force: true });
// ditto preserves the relative framework symlinks and signed bundle metadata.
run("/usr/bin/ditto", [built, destination]);
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", destination]);
const zip = path.join(output, `Callwise-${version}-Apple-Silicon.zip`);
if (existsSync(zip)) rmSync(zip);
run("/usr/bin/ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  destination,
  zip,
]);
writeFileSync(
  path.join(output, "SHA256SUMS.txt"),
  createHash("sha256").update(readFileSync(zip)).digest("hex") +
    "  " +
    path.basename(zip) +
    "\n",
);
console.log(`Local app: ${destination}\nArchive: ${zip}`);
if (process.argv.includes("--launch")) run("/usr/bin/open", [destination]);
