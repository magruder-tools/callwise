import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

// Finder-launched apps do not inherit a developer's shell PATH. Prefer the
// version bundled with this build; a deliberate custom location still wins.
export function resolveCodexBin(configured, {
  resources = process.resourcesPath,
  platform = process.platform,
  home = homedir(),
  exists = existsSync,
} = {}) {
  if (configured && configured !== "codex") return configured;
  const filename = platform === "win32" ? "codex.exe" : "codex";
  const candidates = [
    resources && path.join(resources, "codex", filename),
    ...(platform === "darwin" ? [
      path.join(home, ".local", "bin", "codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    ] : []),
  ].filter(Boolean);
  return candidates.find(exists) || "codex";
}
