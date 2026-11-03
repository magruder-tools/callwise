// End-to-end in the real Electron app (Linux, stand-in keychain): a typed-source meeting with a participant notice,
// notes, an objection, "Delete transcript and audio; continue with notes only", then History.
// 0.5.2 run: the objection dialog, "Delete transcript and audio", and the notes-only continuation.
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const mainWindow = async (app) => { await app.firstWindow(); for (let i = 0; i < 100; i++) { const w = app.windows().find((w) => !w.url().includes("surface=panel")); if (w) return w; await new Promise((r) => setTimeout(r, 100)); } throw new Error("main window not found"); };
const require = createRequire(`${process.env.CALLWISE_ROOT}/package.json`);
const { _electron } = require("playwright");
const data = `${process.cwd()}/data-objection`; rmSync(data, { recursive: true, force: true }); mkdirSync(data);
const app = await _electron.launch({ executablePath: `${process.env.CALLWISE_ROOT}/node_modules/electron/dist/electron`,
  args: ["--no-sandbox", "--disable-gpu", `${process.cwd()}/wrapper`], env: { DISPLAY: ":99", HOME: process.env.HOME, PATH: process.env.PATH, CALLWISE_TEST_DATA: data, CALLWISE_ROOT: process.env.CALLWISE_ROOT }, timeout: 60000 });
const win = await mainWindow(app);
win.on("pageerror", (e) => console.log("page error:", e.message));
await win.waitForSelector("[data-action]", { timeout: 30000 });
if (await win.locator('[data-action="skip-setup"]').count()) await win.locator('[data-action="skip-setup"]').first().click();
await win.waitForSelector('[data-action="m-start"]', { timeout: 15000 });
// Typed source: a transcribed meeting with a notice, without Apple speech (not available on Linux).
await win.evaluate(() => window.callwise.command("configure", { preferredSource: "manual" }));
await win.fill("#meeting-title", "Vendor negotiation");
await win.fill("#meeting-people", "Dana");
await win.click('[data-action="m-start"]');
await win.waitForSelector("#meeting-notice", { timeout: 15000 });
await win.check('#meeting-notice input[type="checkbox"]');
await win.click('[data-action="m-confirm-start"]');
await win.waitForSelector("textarea[data-meeting-notes]", { timeout: 15000 });
await win.locator("textarea[data-meeting-notes]").type("Walk-away price 35k");
await win.waitForTimeout(1500);
await win.locator("details.notice-receipt summary").click();
await win.click('[data-action="m-objection"]');
await win.waitForSelector("#meeting-objection", { timeout: 10000 });
console.log("objection dialog:", (await win.locator("#meeting-objection").innerText()).replace(/\s+/g, " "));
await win.click('[data-action="m-objection-delete"]');
await win.waitForTimeout(2500);
console.log("after delete, notebook title:", await win.inputValue("#saved-meeting-title"), "| notes:", await win.locator("textarea[data-meeting-notes]").inputValue(), "| status:", (await win.locator(".meeting-status").innerText()).replace(/\s+/g, " "));
const db = new DatabaseSync(`${data}/meetings/library.db`, { readOnly: true });
console.log("meeting rows in SQLite:", db.prepare("SELECT count(*) c FROM meetings").get().c, "| transcript rows:", db.prepare("SELECT count(*) c FROM segments").get().c);
db.close();
await win.screenshot({ path: `${process.cwd()}/after-objection-delete.png` });
await win.click('[data-action="end"]');
await win.waitForTimeout(1500);
const history = await win.evaluate(() => window.callwise.command("state").then((s) => s.meetings.library.map((m) => ({ title: m.title, captureMode: m.captureMode, status: m.status }))));
console.log("History after ending the continuation:", JSON.stringify(history));
await app.close();
