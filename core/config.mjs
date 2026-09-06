import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function readConfig(paths = []) {
  const env = { ...process.env };
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(path, "utf8")),
    )) {
      if (!env[key]) env[key] = value;
    }
  }
  return {
    openaiKey: env.OPENAI_API_KEY || "",
    fastModel: env.CALLWISE_FAST_MODEL || "gpt-5.6-luna",
    strategyModel: env.CALLWISE_STRATEGY_MODEL || "gpt-6-astra",
    transcriptionModel:
      env.CALLWISE_TRANSCRIPTION_MODEL || "gpt-live-transcribe",
    codexBin: env.CALLWISE_CODEX_BIN || "codex",
    codexEffort: env.CALLWISE_CODEX_EFFORT || "high",
    firefliesKey: env.FIREFLIES_API_KEY || "",
    mcpUrl: env.CALLWISE_MCP_URL || "",
    mcpToken: env.CALLWISE_MCP_TOKEN || "",
    mcpSearchTool: env.CALLWISE_MCP_SEARCH_TOOL || "",
    mcpSearchArguments:
      env.CALLWISE_MCP_SEARCH_ARGUMENTS || '{"query":"{{query}}"}',
  };
}

export function publicConfig(config) {
  return {
    openaiReady: !!config.openaiKey,
    firefliesReady: !!config.firefliesKey,
    mcpReady: !!(config.mcpUrl && config.mcpSearchTool),
    fastModel: config.fastModel,
    strategyModel: config.strategyModel,
    transcriptionModel: config.transcriptionModel,
    codexEffort: config.codexEffort,
  };
}
