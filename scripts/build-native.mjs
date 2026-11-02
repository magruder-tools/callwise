import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  copyFileSync,
  chmodSync,
  existsSync,
  renameSync,
} from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
if (process.platform !== "darwin")
  throw new Error("The local meeting engine requires macOS 26 or later.");
const packageDir = path.join(root, "native/CallwiseNative");
const result = spawnSync(
  "/usr/bin/swift",
  ["build", "--package-path", packageDir, "-c", "release", "--disable-sandbox"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH:
        process.env.CLANG_MODULE_CACHE_PATH ||
        "/private/tmp/callwise-clang-modules",
    },
  },
);
if (result.status !== 0) process.exit(result.status || 1);
const built = path.join(packageDir, ".build/release/callwise-native");
if (!existsSync(built))
  throw new Error("The native meeting helper was not produced.");
mkdirSync(path.join(root, "native/build"), { recursive: true });
mkdirSync(path.join(root, "native/resources/models"), { recursive: true });
const target = path.join(root, "native/build/callwise-native");
copyFileSync(built, target + ".next");
renameSync(target + ".next", target);
chmodSync(target, 0o755);
console.log("Built the local Callwise meeting engine.");
