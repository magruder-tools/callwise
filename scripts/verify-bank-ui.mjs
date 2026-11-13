import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
const root = path.resolve(import.meta.dirname, ".."), manifest = JSON.parse(readFileSync(path.join(root, "fixtures/ui/index.json")));
const fixtures = Object.fromEntries(manifest.map((f) => [f.name, JSON.parse(readFileSync(path.join(root, "fixtures/ui", f.file)))]));
const artifacts = path.join(root, "artifacts/browser/round3"); mkdirSync(artifacts, { recursive: true });
const port = "4193", server = spawn(process.execPath, ["scripts/demo-server.mjs"], { cwd: root, env: { ...process.env, CALLWISE_DEMO_PORT: port }, stdio: ["ignore", "pipe", "inherit"] });
let browser, page; const errors = [];
try {
  await Promise.race([once(server.stdout, "data"), once(server, "exit").then(() => { throw new Error("Round 3 browser server did not start."); })]);
  browser = await chromium.launch({ ...(process.env.CALLWISE_BROWSER_BIN ? { executablePath: process.env.CALLWISE_BROWSER_BIN } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  page = await browser.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((data) => {
    window.fixtures = data; window.calls = [];
    window.callwise = { desktop: true, onState(cb) { window.pushSnapshot = cb; queueMicrotask(() => cb(data["ready-packs"])); return () => {}; }, onNavigate(cb) { window.navigateFixture = cb; return () => {}; }, onStopCapture: () => () => {},
      async command(name, payload) {
        window.calls.push({ name, payload });
        if (name === "state") return data["ready-packs"];
        if (name === "bank.open") window.pushSnapshot(data["review-cards"]);
        if (name === "bank.close") window.pushSnapshot(data["ready-packs"]);
        if (name === "prep.copyPrompt") return { text: "Synthetic prep prompt" };
        if (name === "rehearsal.start") window.pushSnapshot(data["rehearsal-listening"]);
        if (name === "rehearsal.stop") window.pushSnapshot(data["ready-packs"]);
        return {};
      },
    };
  }, fixtures);
  await page.goto(`http://127.0.0.1:${port}`); await page.getByRole("heading", { name: "Prep packs", exact: true }).waitFor();
  for (const width of [400, 640, 980, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const fixture of manifest) {
      await page.evaluate(({ name, screen, tab }) => { window.pushSnapshot(structuredClone(window.fixtures[name])); window.navigateFixture({ screen, tab }); }, fixture);
      await page.locator("#app").waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${fixture.name} overflow at ${width}`);
      const small = await page.locator(".round3 button:visible, .round3 input:visible, .round3 select:visible, .round3 summary:visible").evaluateAll(nodes => nodes.filter(n => (n.type === "checkbox" ? n.closest("label") : n).getBoundingClientRect().height < 43.5).map(n => n.textContent || n.id));
      assert.deepEqual(small, [], `${fixture.name} target sizes at ${width}`);
      await page.screenshot({ path: path.join(artifacts, `${fixture.name}-${width}.png`), fullPage: true });
    }
  }
  await page.evaluate(() => { window.pushSnapshot(structuredClone(window.fixtures["ready-packs"])); window.navigateFixture({ screen: "ready" }); });
  await page.getByRole("button", { name: "Copy prep prompt", exact: true }).click();
  await page.getByRole("button", { name: "Review", exact: true }).first().click();
  const input = page.locator('[data-r3-draft^="say:"]').first(); await input.fill("I kept an unsaved sentence while checking the source.");
  await page.evaluate(() => window.pushSnapshot(structuredClone(window.fixtures["review-cards"])));
  assert.equal(await input.inputValue(), "I kept an unsaved sentence while checking the source.");
  await page.getByRole("button", { name: "Save edit", exact: true }).first().click();
  const edit = await page.evaluate(() => window.calls.find(c => c.name === "bank.card.edit")); assert.equal(edit.payload.say, "I kept an unsaved sentence while checking the source.");
  await page.getByRole("button", { name: "Approve all", exact: true }).click();
  const calls = await page.evaluate(() => window.calls.map(c => c.name)); assert.ok(calls.includes("bank.approveAll")); assert.ok(calls.includes("prep.copyPrompt")); assert.ok(calls.includes("desktop.copy"));
  assert.deepEqual(errors, []);
  console.log(`Round 3 screens passed: ${manifest.length} snapshots at four widths (${manifest.length * 4} screenshots), 44px targets, no horizontal overflow, preserved edits and real command payloads.`);
} catch (error) { console.error("Page errors:", errors); if (page) console.error((await page.locator("body").innerText()).slice(0, 1800)); throw error; } finally { await browser?.close(); server.kill(); }
