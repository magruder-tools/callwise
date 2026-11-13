import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "@playwright/test";
import { CallController } from "../core/controller.mjs";

// Exercise the shipped event handlers with synthetic snapshots and deferred commands.
const controller = new CallController({ demoOnly: true });
const initial = controller.snapshot();
controller.close();
const port = "4190";
const server = spawn(process.execPath, ["scripts/demo-server.mjs"], {
  env: { ...process.env, CALLWISE_DEMO_PORT: port },
  stdio: ["ignore", "pipe", "inherit"],
});
let browser;
try {
  await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(() => {
      throw new Error("Draft test server did not start.");
    }),
  ]);
  browser = await chromium.launch({
    ...(process.env.CALLWISE_BROWSER_BIN
      ? { executablePath: process.env.CALLWISE_BROWSER_BIN }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((snapshot) => {
    window.pending = {};
    window.snapshot = snapshot;
    window.callwise = {
      desktop: false,
      onState(cb) {
        window.pushSnapshot = cb;
        queueMicrotask(() => cb(window.snapshot));
        return () => {};
      },
      onStopCapture: () => () => {},
      command: async (name) => {
        if (["ask", "context.add"].includes(name))
          return new Promise((resolve, reject) => {
            window.pending[name] = { resolve, reject };
          });
        return window.snapshot;
      },
    };
  }, initial);
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator('[data-action="paste"]').click();
  await page.locator("#material-title").fill("Unsent client notes");
  await page
    .locator("#material-text")
    .fill("A note that must survive navigation.");
  const pulse = () => page.evaluate(() => window.pushSnapshot(window.snapshot));
  const settings = () =>
    page.locator('[data-action="settings"]').first().click();
  const done = async () => {
    const back = page.getByRole("button", { name: "Back to call", exact: true });
    if (await back.count()) await back.click();
    else await page.getByRole("button", { name: "Done", exact: true }).click();
  };
  const settle = async (name, error = "") => {
    await page.waitForFunction((name) => !!window.pending[name], name);
    await page.evaluate(
      ({ name, error }) => {
        const pending = window.pending[name];
        delete window.pending[name];
        error
          ? pending.reject(new Error(error))
          : pending.resolve({ ok: true });
      },
      { name, error },
    );
  };
  await pulse();
  assert.equal(
    await page.locator("#material-title").inputValue(),
    "Unsent client notes",
  );
  await settings();
  await done();
  assert.equal(
    await page.locator("#material-text").inputValue(),
    "A note that must survive navigation.",
  );
  await page.locator("#material-form").evaluate((form) => form.requestSubmit());
  await settle("context.add", "Synthetic add failure");
  await page.getByText("Synthetic add failure", { exact: true }).waitFor();
  assert.equal(
    await page.locator("#material-title").inputValue(),
    "Unsent client notes",
  );
  assert.equal(
    await page.locator("#material-text").inputValue(),
    "A note that must survive navigation.",
  );
  await page.locator("#material-form").evaluate((form) => form.requestSubmit());
  await settle("context.add");
  await page.locator("#material-form").waitFor({ state: "hidden" });
  await page.locator('[data-action="paste"]').click();
  assert.equal(await page.locator("#material-title").inputValue(), "Notes");
  assert.equal(await page.locator("#material-text").inputValue(), "");
  await page.locator("#material-text").fill("Cancel this note");
  await page.locator('[data-action="cancel-paste"]').click();
  await page.locator('[data-action="paste"]').click();
  assert.equal(await page.locator("#material-text").inputValue(), "");

  await page.evaluate(() => {
    window.snapshot = {
      ...window.snapshot,
      status: "running",
      source: "manual",
    };
    window.pushSnapshot(window.snapshot);
  });
  await page.locator("#question").fill("Keep my unsent question?");
  await pulse();
  assert.equal(
    await page.locator("#question").inputValue(),
    "Keep my unsent question?",
  );
  await page.locator("#ask-form").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => !!window.pending.ask);
  assert.equal(
    await page.locator("#question").inputValue(),
    "Keep my unsent question?",
  );
  await settings();
  await settle("ask", "Synthetic ask failure");
  await page.getByText("Synthetic ask failure", { exact: true }).waitFor();
  await done();
  assert.equal(
    await page.locator("#question").inputValue(),
    "Keep my unsent question?",
  );
  await page.locator("#ask-form").evaluate((form) => form.requestSubmit());
  await settle("ask");
  await page.waitForFunction(
    () => document.querySelector("#question")?.value === "",
  );
  await page.locator("#question").fill("Original ask");
  await page.locator("#ask-form").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => !!window.pending.ask);
  await page.locator("#question").fill("A newer unsent ask");
  await settle("ask");
  await pulse();
  assert.equal(
    await page.locator("#question").inputValue(),
    "A newer unsent ask",
  );
  for (const status of ["running", "paused", "finishing"]) {
    await settings();
    await page.evaluate((status) => {
      window.snapshot = { ...window.snapshot, status };
      window.pushSnapshot(window.snapshot);
    }, status);
    await done();
    assert.equal(await page.locator("#app").getAttribute("data-view"), "live");
    assert.equal(
      await page.locator("#question").inputValue(),
      "A newer unsent ask",
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Round 3 browser checks passed: drafts, command failure/success/cancel, in-flight edits, and Settings during running/paused/finishing.",
  );
} finally {
  await browser?.close();
  server.kill();
}
