import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${readFileSync(path.join(root, "assets/icon.svg"), "utf8")}`);
  await page.screenshot({ path: path.join(root, "assets/icon.png"), omitBackground: true });
} finally { await browser.close(); }
if (process.platform === "darwin") {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "callwise-icon-")), iconset = path.join(temporary, "Callwise.iconset");
  mkdirSync(iconset);
  try {
    for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2])
      execFileSync("/usr/bin/sips", ["-z", String(size * scale), String(size * scale), path.join(root, "assets/icon.png"), "--out", path.join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`)], { stdio: "ignore" });
    execFileSync("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", path.join(root, "assets/icon.icns")]);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
console.log("Built the light and indigo Callwise icon.");
