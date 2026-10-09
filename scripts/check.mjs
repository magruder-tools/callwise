import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
let count = 0,
  failures = [];
function check(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.(mjs|cjs|js)$/.test(file)) {
      const r = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
      });
      if (r.status !== 0)
        failures.push(
          `${file}: ${(r.stderr || r.stdout || "syntax error").trim()}`,
        );
      count++;
    }
  }
}
for (const root of ["core", "desktop", "providers", "ui", "scripts", "tests"])
  check(root);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (!pkg.build.mac.extendInfo.NSAudioCaptureUsageDescription)
  failures.push("Missing macOS audio permission description.");
if (!readFileSync(".gitignore", "utf8").includes(".env.*"))
  failures.push("Secrets must be ignored.");
if (failures.length) {
  const message = failures.join("\n\n");
  console.error(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Checks failed\n\n\`\`\`text\n${message}\n\`\`\`\n`,
    );
  process.exit(1);
}
console.log(
  `Syntax checked ${count} JavaScript modules; desktop metadata and secret exclusions present.`,
);
