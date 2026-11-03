import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { MeetingStore } from "../core/meetings/store.mjs";
import { MeetingService } from "../core/meetings/service.mjs";
import { MeetingSearch } from "../desktop/meeting-search.mjs";
import { CallController } from "../core/controller.mjs";
import { startMeeting } from "../desktop/meeting-start.mjs";
const dir = mkdtempSync(path.join(os.tmpdir(), "callwise-meeting-ui-"));
const store = new MeetingStore(dir, { key: randomBytes(32) });
const controller = new CallController({
  preferences: {
    setupDismissed: true,
    preferredSource: "manual",
    speechEngine: "apple",
    liveHelp: false,
    language: "en-US",
  },
});
const native = {
  run: async () => ({
    title: "Launch planning",
    summary: [
      {
        text: "Taylor will send the revised launch proposal.",
        segmentIds: ["sample:1"],
      },
    ],
    decisions: [],
    openQuestions: [],
    actions: [
      {
        text: "Send revised launch proposal",
        ownerQuote: "Taylor",
        dueQuote: "Friday",
        segmentIds: ["sample:1"],
      },
    ],
    enhancedNotes: "Original ideas, organized for review.",
    answer: "",
    answerSegmentIds: [],
  }),
};
const meetings = new MeetingService({
  store,
  native,
  search: new MeetingSearch(store),
});
controller.meetingService = meetings;
meetings.attach(controller);
controller.desktopState = {
  packaged: true,
  platform: "darwin",
  readiness: { core: true, mic: true, system: true },
  native: {
    speech: true,
    localAI: "available",
    installedLocales: ["en_US"],
    supportedLocales: ["en_US", "es_MX"],
  },
};
const server = spawn(process.execPath, ["scripts/demo-server.mjs"], {
  env: { ...process.env, CALLWISE_DEMO_PORT: "4189" },
  stdio: ["ignore", "pipe", "inherit"],
});
const artifacts = "artifacts/meeting-ui";
mkdirSync(artifacts, { recursive: true });
let browser, page;
let unlocks = 0;
const failures = [];
try {
  await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(() => {
      throw new Error("Test server stopped.");
    }),
  ]);
  browser = await chromium.launch(
    process.env.CALLWISE_BROWSER_BIN
      ? { executablePath: process.env.CALLWISE_BROWSER_BIN }
      : {},
  );
  page = await browser.newPage({ viewport: { width: 980, height: 740 } });
  page.on("pageerror", (e) => failures.push(e.message));
  const snapshot = () => ({
    ...controller.snapshot(),
    meetings: meetings.snapshot(),
  });
  await page.exposeBinding("meetingCommand", async (_source, name, p = {}) => {
    if (name === "desktop.storage.unlock") {
      unlocks++;
      controller.engine.emitState();
      return { unlocked: true, warnings: [] };
    }
    if (name === "desktop.updates.check") return null;
    if (name.startsWith("meeting.")) return meetings.command(name, p);
    if (name === "start")
      return startMeeting({ meetings, controller, payload: p });
    return controller.command(name, p);
  });
  await page.addInitScript((s) => {
    window.callwise = {
      desktop: false,
      command: (name, p) => window.meetingCommand(name, p),
      onState: (cb) => {
        window.pushMeeting = cb;
        queueMicrotask(() => cb(s));
        return () => {};
      },
      onStopCapture: () => () => {},
      onNavigate: () => () => {},
    };
  }, snapshot());
  controller.on("state", () => {
    if (page && !page.isClosed())
      void page
        .evaluate((s) => window.pushMeeting?.(s), snapshot())
        .catch(() => {});
  });
  await page.goto("http://127.0.0.1:4189");
  await page.getByRole("heading", { name: "A new conversation" }).waitFor();
  async function capture(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(80);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `${name}: horizontal overflow`,
    );
    await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
  }
  await capture("ready-980");
  await page.locator("#meeting-title").fill("Launch planning");
  await page.locator("#meeting-people").fill("Taylor, Morgan");
  await page.locator('[data-action="m-start"]').click();
  await page.locator("#meeting-notice").waitFor({ state: "visible" });
  assert.equal(
    await page.locator('[data-action="m-confirm-start"]').isDisabled(),
    true,
  );
  assert.equal(controller.engine.status, "idle");
  await capture("participant-notice");
  await page.locator("#notice-confirmed").check();
  await page.locator('[data-action="m-confirm-start"]').click();
  await page.locator(".meeting-notes").waitFor();
  assert.match(
    await page.locator(".processing-status").innerText(),
    /Notes only.*Audio recording: off.*Cloud coaching: off/s,
  );
  await page
    .locator(".meeting-notes")
    .fill(
      "Keep our original launch assumptions.\nAsk about the Friday deadline.",
    );
  controller.engine.ingest({
    id: "sample:1",
    channel: "system",
    speaker: "Them",
    text: "Taylor will send the revised launch proposal on Friday.",
    startMs: 1000,
    endMs: 5000,
    final: true,
  });
  await page.waitForTimeout(850);
  assert.match(meetings.current().notes.text, /original launch assumptions/);
  assert.match(
    await page.locator(".meeting-notes").inputValue(),
    /original launch assumptions/,
  );
  await capture("notebook-live-980");
  await page.locator('[data-action="end"]').click();
  await page.getByRole("heading", { name: "The useful parts" }).waitFor();
  await page
    .getByText("Taylor will send the revised launch proposal.", { exact: true })
    .waitFor();
  assert.equal(meetings.current().actions.length, 1);
  await capture("meeting-ended-980");
  await page.setViewportSize({ width: 640, height: 620 });
  await capture("meeting-ended-640-notes");
  await page.locator('[data-action="m-ref"]').first().click();
  await page.locator(".transcript-row.highlight").waitFor();
  await capture("meeting-ended-640-evidence");
  await page.locator('[data-action="m-history"]').first().click();
  await page.locator(".history-view").waitFor();
  await page.locator("#meeting-search").fill("proposal");
  await page.locator("#meeting-search-form button").click();
  await page.locator(".history-meeting").waitFor();
  await capture("history-search-640");
  await page.setViewportSize({ width: 980, height: 740 });
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-tab="Assistants"]').click();
  await capture("settings-assistants");
  await page.locator('[data-tab="Privacy"]').click();
  await capture("settings-privacy");
  meetings.archiveOperation = {
    kind: "restore",
    phase: "Restoring records and audio",
    total: 100,
    completed: 40,
  };
  controller.engine.emitState();
  await page.getByRole("progressbar", { name: "Backup restore" }).waitFor();
  assert.equal(
    await page.locator('[data-action="m-restore"]').isDisabled(),
    true,
  );
  assert.equal(await page.getByRole("progressbar").getAttribute("value"), "40");
  await capture("restore-progress");
  meetings.archiveOperation = null;
  controller.engine.emitState();
  await page.locator('[data-tab="General"]').click();
  await page.locator("#includePreviewUpdates").check();
  assert.equal(controller.preferences.includePreviewUpdates, true);
  await page.locator('[data-action="updates-check"]').click();
  await page
    .getByText("No newer release was found on your selected update channel.", {
      exact: true,
    })
    .waitFor();
  await page.evaluate(
    (s) =>
      window.pushMeeting({ ...s, meetings: { ...s.meetings, locked: true } }),
    snapshot(),
  );
  await page.locator('[data-action="storage-unlock"]').click();
  await page.getByText(/Saved data unlocked/).waitFor();
  assert.equal(unlocks, 1);
  assert.equal(await page.locator('[data-action="storage-unlock"]').count(), 0);
  assert.deepEqual(failures, []);
  console.log(
    "Meeting UI passed: participant gate, notes autosave, live transcript, local recap/actions, evidence navigation, responsive layout, encrypted history search, processing labels, restore progress, update settings and explicit storage retry. Synthetic data only.",
  );
} finally {
  page = null;
  await browser?.close();
  controller.close();
  meetings.close();
  server.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
}
