import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const roots=["core","desktop","providers","ui","scripts","tests"];
let count=0;
for(const root of roots)for(const name of readdirSync(root)){if(!/\.(mjs|cjs|js)$/.test(name))continue;const file=path.join(root,name);const result=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});if(result.status!==0){console.error(`Syntax check failed: ${file}`);console.error(result.stderr);process.exit(1);}count++;}
const pkg=JSON.parse(readFileSync("package.json","utf8"));
if(!pkg.build.mac.extendInfo.NSAudioCaptureUsageDescription)throw new Error("Missing macOS audio permission description.");
if(!readFileSync(".gitignore","utf8").includes(".env.*"))throw new Error("Secrets must be ignored.");
console.log(`Syntax checked ${count} JavaScript modules; desktop metadata and secret exclusions present.`);
