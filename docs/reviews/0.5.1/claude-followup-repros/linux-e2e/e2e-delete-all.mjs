// End-to-end: "Delete all Callwise data" in the real app, then look at History in the same session.
// 0.5.1 run: passes CALLWISE_ROOT to Electron and selects the main window (the panel window can open first).
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const mainWindow = async (app) => { await app.firstWindow(); for (let i = 0; i < 100; i++) { const w = app.windows().find((w) => !w.url().includes("surface=panel")); if (w) return w; await new Promise((r) => setTimeout(r, 100)); } throw new Error("main window not found"); };
const require = createRequire(`${process.env.CALLWISE_ROOT}/package.json`);
const { _electron } = require("playwright");
const data = `${process.cwd()}/data-del`; rmSync(data, { recursive: true, force: true }); mkdirSync(data);
const app = await _electron.launch({ executablePath: `${process.env.CALLWISE_ROOT}/node_modules/electron/dist/electron`,
  args: ["--no-sandbox", "--disable-gpu", `${process.cwd()}/wrapper`], env: { DISPLAY: ":99", HOME: process.env.HOME, PATH: process.env.PATH, CALLWISE_TEST_DATA: data, CALLWISE_ROOT: process.env.CALLWISE_ROOT }, timeout: 60000 });
const win = await mainWindow(app);
await win.waitForSelector("[data-action]", { timeout: 30000 });
if (await win.locator('[data-action="skip-setup"]').count()) await win.locator('[data-action="skip-setup"]').first().click();
await win.waitForSelector('[data-action="m-notes-only"]', { timeout: 15000 });
await win.fill("#meeting-title", "Salary negotiation prep");
await win.click('[data-action="m-notes-only"]');
await win.waitForSelector("textarea[data-meeting-notes]");
await win.locator("textarea[data-meeting-notes]").type("My floor is 180k.");
await win.waitForTimeout(1200);
await win.click('[data-action="end"]'); await win.waitForTimeout(1200);
await win.locator('[data-action="settings"]').first().click(); await win.waitForTimeout(500);
await win.locator('[data-action="settings-tab"][data-tab="Privacy"]').click(); await win.waitForTimeout(300);
await win.locator('[data-action="delete-everything"]').click(); await win.waitForTimeout(300);
await win.locator('[data-action="confirm-delete"]').click(); await win.waitForTimeout(1500);
const { readdirSync, existsSync } = await import("node:fs");
console.log("files in meetings/ after Delete all:", readdirSync(`${data}/meetings`), "| MCP audit log present:", existsSync(`${data}/meeting-access.jsonl`));
const db = new DatabaseSync(`${data}/meetings/library.db`, { readOnly: true });
console.log("meeting rows in SQLite after Delete all:", db.prepare("SELECT count(*) c FROM meetings").get().c); db.close();
if (await win.locator('[data-action="skip-setup"]').count()) await win.locator('[data-action="skip-setup"]').first().click();
await win.locator('[data-action="m-history"]').first().click(); await win.waitForTimeout(800);
console.log("History right after Delete all:", await win.locator(".history-meeting h2").allInnerTexts());
if (await win.locator('.history-meeting [data-action="m-open"]').count()) {
  await win.locator('.history-meeting [data-action="m-open"]').first().click(); await win.waitForTimeout(800);
  console.log("Opened meeting shows notes:", await win.locator("textarea[data-meeting-notes]").inputValue().catch(() => "(not shown)"));
} else console.log("No meeting left to open; empty state shown:", (await win.locator(".empty-history").count()) > 0);
await win.screenshot({ path: `${process.cwd()}/after-delete-all.png` });
await app.close();
