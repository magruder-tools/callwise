// Runs only after the source, renderer and signed Mac jobs succeed in GitHub Actions.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const version = JSON.parse(readFileSync("package.json")).version;
const preview = process.env.GITHUB_REF === "refs/heads/claude/followup-fixes";
const tag = preview
  ? `callwise-${version}-preview`
  : process.env.GITHUB_REF_NAME;
if (!preview && tag !== `v${version}`)
  throw new Error("Tag must match the package version.");
const commit = process.env.GITHUB_SHA;
if (preview) {
  const head = execFileSync(
    "git",
    ["ls-remote", "origin", "refs/heads/claude/followup-fixes"],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\s+/)[0];
  if (head !== commit)
    throw new Error("A newer preview build has superseded this commit.");
}
if (
  !/^[a-f0-9]{40}$/.test(commit || "") ||
  readFileSync("release/BUILD_COMMIT.txt", "utf8").trim() !== commit
)
  throw new Error("Installer commit does not match this build.");
execFileSync("sha256sum", ["--check", "release/SHA256SUMS.txt"], {
  stdio: "inherit",
});
const signing = readFileSync("release/SIGNING.txt", "utf8").trim();
if (!signing.startsWith("Signed with the persistent Callwise identity."))
  throw new Error("Published builds require the persistent signing identity.");
if (
  !readFileSync("release/SIGNATURE.txt", "utf8").includes(
    "local.callwise.desktop",
  )
)
  throw new Error("Missing app signature record.");
const section = readFileSync("CHANGELOG.md", "utf8")
  .split(`## ${version} — `)[1]
  ?.split("\n## ")[0];
if (!section) throw new Error("Missing changelog for this version.");
const buildUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
writeFileSync(
  "release/RELEASE_NOTES.md",
  `${section.slice(section.indexOf("\n")).trim()}\n\nDownload the Apple Silicon ZIP or DMG below. Quit Callwise, replace the app in Applications, then reopen it. Your separate saved library is preserved. Requires macOS 26 or later.\n\n${signing}\n\nAutomated checks use synthetic data. Real-call accuracy and existing Keychain approval behavior still need a check on your Mac.\n\nVerified build: ${buildUrl}\n\nBuild commit: ${commit}\n\nSHA256SUMS.txt contains the installer checksums.\n`,
);
function gh(args) {
  execFileSync("gh", args, { stdio: "inherit" });
}
// Creation fails for an existing release; never replace an already published installer.
gh([
  "release",
  "create",
  tag,
  ...(preview ? ["--target", commit, "--prerelease"] : ["--verify-tag"]),
  "--draft",
  "--title",
  `Callwise ${version}${preview ? " preview" : ""}`,
  "--notes-file",
  "release/RELEASE_NOTES.md",
]);
const assets = readdirSync("release")
  .filter(
    (name) =>
      /\.(dmg|zip)$/.test(name) ||
      [
        "SHA256SUMS.txt",
        "SIGNATURE.txt",
        "SIGNING.txt",
        "BUILD_COMMIT.txt",
      ].includes(name),
  )
  .map((name) => `release/${name}`);
gh(["release", "upload", tag, ...assets]);
gh([
  "release",
  "edit",
  tag,
  "--draft=false",
  preview ? "--latest=false" : "--latest",
]);
