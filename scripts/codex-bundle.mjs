import path from "node:path";

export function codexBinaries(members) {
  if (
    members.some(
      (name) => path.posix.isAbsolute(name) || name.split("/").includes(".."),
    )
  )
    throw new Error("The Codex archive contains an unsafe path.");
  const result = {};
  for (const name of ["codex", "codex-code-mode-host"]) {
    const candidates = members.filter(
      (member) =>
        member.includes("/aarch64-apple-darwin/") &&
        path.posix.basename(member) === name &&
        !member.endsWith("/"),
    );
    if (candidates.length !== 1)
      throw new Error(
        `The pinned Codex package must contain exactly one Apple Silicon ${name} executable.`,
      );
    result[name] = candidates[0];
  }
  if (
    path.posix.dirname(result.codex) !==
    path.posix.dirname(result["codex-code-mode-host"])
  )
    throw new Error("The Codex runtime and tool host must be siblings.");
  return result;
}
