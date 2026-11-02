import path from "node:path";
import os from "node:os";
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { atomicWrite } from "../core/meetings/store.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function previewAssistantInstall({
  target,
  executable,
  root,
  packaged,
  home = os.homedir(),
}) {
  if (!["claude", "codex"].includes(target))
    throw new Error("Choose Claude Desktop or Codex.");
  const file =
    target === "claude"
      ? path.join(
          home,
          "Library/Application Support/Claude/claude_desktop_config.json",
        )
      : path.join(home, ".codex/config.toml");
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  const command = executable,
    args = packaged ? ["--mcp-server"] : [root, "--mcp-server"];
  let after;
  if (target === "claude") {
    let v;
    try {
      v = before ? JSON.parse(before) : {};
    } catch {
      throw new Error(
        "Claude configuration is not valid JSON; it has not been changed.",
      );
    }
    v.mcpServers = { ...(v.mcpServers || {}), callwise: { command, args } };
    after = JSON.stringify(v, null, 2) + "\n";
  } else {
    const block = `[mcp_servers.callwise]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\nenabled = true\nstartup_timeout_sec = 30\ntool_timeout_sec = 60\n`;
    // Touch only our exact root section. Unrelated sections, including personal_mac, are preserved verbatim.
    const pattern =
      /^\[mcp_servers\.callwise\]\r?\n[\s\S]*?(?=^\[|$(?![\s\S]))/m;
    after = pattern.test(before)
      ? before.replace(pattern, block + "\n")
      : before.replace(/\s*$/, "") + "\n\n" + block;
    if (/^\[mcp_servers\.(?:"callwise"|'callwise')\]/m.test(before))
      throw new Error(
        "A quoted Callwise section already exists; review it before adding another.",
      );
  }
  return {
    target,
    file,
    beforeHash: hash(before),
    after,
    change: {
      section:
        target === "claude" ? "mcpServers.callwise" : "mcp_servers.callwise",
      command,
      args,
    },
    note: "This adds read-only access to saved meetings when the Callwise access switch is on. It does not start a conversation or copy either assistant’s chat history.",
  };
}
export function installAssistant(preview) {
  const before = existsSync(preview.file)
    ? readFileSync(preview.file, "utf8")
    : "";
  if (hash(before) !== preview.beforeHash)
    throw new Error("Assistant configuration changed. Review a fresh preview.");
  let backup = null;
  if (before) {
    backup = `${preview.file}.callwise-${Date.now()}.bak`;
    copyFileSync(preview.file, backup);
  }
  atomicWrite(preview.file, preview.after);
  return {
    installed: true,
    target: preview.target,
    backup,
    restartRequired: true,
  };
}
