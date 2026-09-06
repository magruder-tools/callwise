import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readConfig, publicConfig } from "../core/config.mjs";
const config = readConfig([".env.local"]);
const codex = spawnSync(config.codexBin, ["--version"], {
  encoding: "utf8",
  timeout: 5000,
});
const status = publicConfig(config);
console.log("Callwise setup check (no network requests, no secrets displayed)");
console.log(
  `Node: ${process.versions.node}; platform: ${process.platform}/${process.arch}`,
);
console.log(
  `Desktop dependencies: ${existsSync("node_modules/electron") ? "installed" : "run npm ci"}`,
);
console.log(
  `OpenAI key: ${status.openaiReady ? "present, not verified" : "not set; demo still works"}`,
);
console.log(
  `Fireflies key: ${status.firefliesReady ? "present, not verified" : "optional, not set"}`,
);
console.log(
  `MCP search: ${status.mcpReady ? "configured, not verified" : "optional, not set"}`,
);
console.log(
  `Codex executable: ${codex.status === 0 ? "available; sign-in still needs checking" : "not found; API strategy still available"}`,
);
console.log(
  `Models: ${status.fastModel} / ${status.strategyModel} / ${status.transcriptionModel}`,
);
console.log("Next: npm run demo, or npm start on your Mac. See START_HERE.md.");
