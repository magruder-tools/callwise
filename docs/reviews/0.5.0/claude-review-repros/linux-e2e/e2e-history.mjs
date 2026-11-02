// End-to-end in the real Electron app (Linux, stand-in keychain, no native helper): save a notes-only meeting,
// quit, relaunch, and look at History.
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
const require = createRequire(`${process.env.CALLWISE_ROOT}/package.json`);
const { _electron } = require("playwright");
const data = `${process.cwd()}/data-e2e`; rmSync(data, { recursive: true, force: true }); mkdirSync(data);
const launch = () => _electron.launch({ executablePath: `${process.env.CALLWISE_ROOT}/node_modules/electron/dist/electron`,
  args: ["--no-sandbox", `${process.cwd()}/wrapper`], env: { DISPLAY: ":99", HOME: process.env.HOME, PATH: process.env.PATH, CALLWISE_TEST_DATA: data }, timeout: 60000 });
const shot = (w, n) => w.screenshot({ path: `${process.cwd()}/${n}.png` });
async function ready(win) {
  await win.waitForSelector("[data-action]", { timeout: 30000 });
  if (await win.locator('[data-action="skip-setup"]').count()) await win.locator('[data-action="skip-setup"]').first().click();
  await win.waitForSelector('[data-action="m-notes-only"], [data-action="m-history"]', { timeout: 15000 });
}
let app = await launch(), win = await app.firstWindow();
await ready(win);
await win.fill("#meeting-title", "E2E planning call");
await win.click('[data-action="m-notes-only"]');
await win.waitForSelector("textarea[data-meeting-notes]", { timeout: 15000 });
await win.locator("textarea[data-meeting-notes]").type("Decided to move the launch to March.");
await win.waitForTimeout(1200);
await win.click('[data-action="end"]');
await win.waitForTimeout(1500);
await win.locator('[data-action="m-history"]').first().click();
await win.waitForTimeout(800);
const before = await win.locator(".history-meeting h2").allInnerTexts();
console.log("History in the session that created the meeting:", before);
await shot(win, "history-before-restart");
await app.close();
app = await launch(); win = await app.firstWindow();
await ready(win);
await win.locator('[data-action="m-history"]').first().click();
await win.waitForTimeout(1000);
console.log("History after quitting and relaunching:", await win.locator(".history-meeting h2").allInnerTexts(), "| empty state shown:", await win.locator(".empty-history").count() > 0);
await shot(win, "history-after-restart");
await win.fill("#meeting-search", "planning"); await win.click('#meeting-search-form button[type="submit"]'); await win.waitForTimeout(2500);
console.log("Search 'planning' after relaunch:", await win.locator(".history-meeting h2").allInnerTexts());
await app.close();
