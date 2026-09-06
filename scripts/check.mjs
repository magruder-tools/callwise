import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const roots=["core","desktop","providers","ui","scripts","tests"];
let count=0,failures=[];
for(const root of roots)for(const name of readdirSync(root)){if(!/\.(mjs|cjs|js)$/.test(name))continue;const file=path.join(root,name);const result=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});if(result.status!==0)failures.push(`${file}: ${String(result.stderr||result.stdout||"syntax error").trim()}`);count++;}
const pkg=JSON.parse(readFileSync("package.json","utf8"));
if(!pkg.build.mac.extendInfo.NSAudioCaptureUsageDescription)failures.push("package.json: Missing macOS audio permission description.");
if(!readFileSync(".gitignore","utf8").includes(".env.*"))failures.push(".gitignore: Secrets must be ignored.");
if(failures.length){const summary=`JavaScript / metadata check failures:\n\n${failures.join("\n\n")}\n`;console.error(summary);if(process.env.GITHUB_STEP_SUMMARY){const{appendFileSync}=await import("node:fs");appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Callwise check failed\n\n\`\`\`text\n${summary}\`\`\`\n`);}process.exit(1);}
console.log(`Syntax checked ${count} JavaScript modules; desktop metadata and secret exclusions present.`);
