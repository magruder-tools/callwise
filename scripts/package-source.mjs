import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
const root = process.cwd();
const destination = path.join(root, "dist");
mkdirSync(destination, { recursive: true });
execFileSync(
  "git",
  [
    "bundle",
    "create",
    path.join(destination, "callwise-history.bundle"),
    "--all",
  ],
  { stdio: "inherit" },
);
execFileSync(
  "git",
  [
    "archive",
    "--format=zip",
    "--prefix=callwise/",
    "-o",
    path.join(destination, "Callwise-source.zip"),
    "HEAD",
  ],
  { stdio: "inherit" },
);
// Append portable history with a stable path inside the archive using Python's
// standard library. No credentials, dependencies, or local context are included.
execFileSync(
  "python3",
  [
    "-c",
    `import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1], 'a', zipfile.ZIP_DEFLATED) as z:\n z.write(sys.argv[2], 'callwise/callwise-history.bundle')`,
    path.join(destination, "Callwise-source.zip"),
    path.join(destination, "callwise-history.bundle"),
  ],
  { stdio: "inherit" },
);
console.log(`Source archive: ${path.join(destination, "Callwise-source.zip")}`);
