import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { readConnections, saveConnections } from "./connections.mjs";

const LEGACY_FIELDS = {
  OPENAI_API_KEY: "openaiKey",
  FIREFLIES_API_KEY: "firefliesKey",
  CALLWISE_FAST_MODEL: "fastModel",
  CALLWISE_STRATEGY_MODEL: "strategyModel",
  CALLWISE_TRANSCRIPTION_MODEL: "transcriptionModel",
  CALLWISE_MCP_URL: "mcpUrl",
  CALLWISE_MCP_TOKEN: "mcpToken",
  CALLWISE_MCP_SEARCH_TOOL: "mcpSearchTool",
  CALLWISE_MCP_SEARCH_ARGUMENTS: "mcpSearchArguments",
};

// Only migrate this app's explicit user-data file, never a packaged .env or
// inherited shell environment. Existing encrypted choices always win.
export function readConnectionsWithMigration(dataDir, storage) {
  const vault = path.join(dataDir, "connections.bin");
  const saved = readConnections(vault, storage);
  const legacy = path.join(dataDir, ".env.local");
  if (!existsSync(legacy)) return saved;
  try {
    const stat = lstatSync(legacy);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 64000 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error(
        "Legacy connection settings are invalid; the original files were preserved.",
      );
    let env;
    try {
      env = parseEnv(readFileSync(legacy, "utf8"));
    } catch {
      throw new Error(
        "Legacy connection settings could not be read; the original files were preserved.",
      );
    }
    const patch = {};
    for (const [envName, field] of Object.entries(LEGACY_FIELDS))
      if (!saved[field] && env[envName]?.trim()) patch[field] = env[envName];
    if (!Object.keys(patch).length) return saved;
    return saveConnections(vault, storage, patch);
  } catch (error) {
    // A stale legacy file must never hide newer, already unlocked credentials.
    if (Object.keys(saved).length) return saved;
    throw error;
  }
}
