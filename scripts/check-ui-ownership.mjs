import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function protectedUiPath(file) {
  return (
    /^(?:ui\/views\/|ui\/components\/)/.test(file) ||
    ["ui/index.html", "ui/render.mjs"].includes(file) ||
    /\.css$/i.test(file)
  );
}
export function uiOwnershipViolations(branch, files) {
  if (!branch)
    throw new Error("A source branch is required for the UI ownership check.");
  return branch.startsWith("claude/") ? [] : files.filter(protectedUiPath);
}
export function checkUiOwnership({
  branch = process.env.GITHUB_HEAD_REF ||
    execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
    }).trim(),
  base = process.env.CALLWISE_OWNERSHIP_BASE ||
    `origin/${process.env.GITHUB_BASE_REF || "main"}`,
  head = process.env.CALLWISE_OWNERSHIP_HEAD || "HEAD",
  cwd = process.cwd(),
} = {}) {
  // Without rename detection, both sides of a rename are checked.
  const files = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`, "--"],
    { cwd, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  return uiOwnershipViolations(branch, files);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const violations = checkUiOwnership();
    if (violations.length) {
      console.error(
        "UI changes belong on a claude/ branch. Protected paths:\n" +
          violations.map((file) => `  ${file}`).join("\n"),
      );
      process.exitCode = 1;
    } else console.log("UI ownership check passed.");
  } catch (error) {
    console.error(`UI ownership check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
