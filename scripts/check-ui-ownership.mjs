import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";


const FINISH_BRANCH = "codex/round-3-finish";
const FINISH_UI = new Set([
  "ui/views/meetings.mjs", "ui/views/ready.mjs", "ui/views/settings.mjs",
  "ui/views/bank.mjs", "ui/views/rehearsal.mjs",
  "ui/components/pack-inbox.mjs", "ui/components/debrief.mjs", "ui/components/round3-settings.mjs",
  "ui/round3.css",
]);
// Inherited Claude UI at 2a80b51. The PR targets the older setup branch, so these exact
// bytes may appear in its diff; this permits inheritance, never subsequent edits.
const CLAUDE_BASELINE = {
  "ui/app.css": "5880c68b189955a6aabf27bbc76bdbee48bc19c4d6dd75bb0d13adf97062bb7c",
  "ui/components/card.mjs": "f67531185b2c053b2e464d34bce973c8efcef69146eda47a6b4ef934d6612ca1",
  "ui/components/common.mjs": "43bca16dc7121dcfde25a95b10bf710501ffcd8d0a67fdd1dfcd41ef624522cb",
  "ui/components/stage.mjs": "e85343010532181e1113081b5f9f05683b23f9a904c7358a4570d4011ebb2c3d",
  "ui/index.html": "35b568bec31c17380f76b66d7d53969e97e63d49324905e4f998946dc5256f2f",
  "ui/meetings.css": "4c4de4ff2de00ffaaab71ba00a83f0f4bdd4b11647cdd1f09aa988b6f6409ca0",
  "ui/stage.css": "b60fd2125d8632f4b81eabae7c07ec76994adcd5087e4522eb69e7c84fe8ee40",
  "ui/tokens.css": "274f6dbbb9dc2048425b02f9437dd0b96f85124a24b127ac0d4fa83fd39bc0f3",
  "ui/views/meetings.mjs": "c405e28e9bb1fcceec69eaa7a8f2c5a7604753fb20034090bc8df777f63c314d",
  "ui/views/settings.mjs": "a86db7a86442e90576d5d1d689bd0b758be31513fb9e0957712d28caa837f886",
  "ui/render.mjs": "801cd2bbfa350dab56baffa25907ab87851aa247f73d0668928d3f3e8b733332"
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

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
  return branch.startsWith("claude/") ? [] : files.filter((file) => protectedUiPath(file) && !(branch === FINISH_BRANCH && FINISH_UI.has(file)));
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
  const effective = branch !== FINISH_BRANCH ? files : files.filter((file) => {
    if (!protectedUiPath(file) || FINISH_UI.has(file)) return true;
    if (!CLAUDE_BASELINE[file]) return true;
    try {
      let bytes = execFileSync("git", ["show", `${head}:${file}`], { cwd });
      if (file === "ui/index.html") {
        const content = bytes.toString("utf8"), line = '    <link rel="stylesheet" href="round3.css" />\n';
        if (content.includes(line) && content.indexOf(line) === content.indexOf('    <link rel="stylesheet" href="stage.css" />\n') + '    <link rel="stylesheet" href="stage.css" />\n'.length)
          bytes = Buffer.from(content.replace(line, ""));
      }
      return hash(bytes) !== CLAUDE_BASELINE[file];
    } catch { return true; }
  });
  return uiOwnershipViolations(branch, effective);
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
