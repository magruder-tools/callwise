import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { once } from "node:events";
import { chromium } from "@playwright/test";
import { CallController } from "../core/controller.mjs";

// Exercise the shipped renderer with synthetic controller snapshots only.
const controller = new CallController({ demoOnly: true });
const initial = controller.snapshot();
controller.close();
const port = "4188";
const server = spawn(process.execPath, ["scripts/demo-server.mjs"], {
  env: { ...process.env, CALLWISE_DEMO_PORT: port },
  stdio: ["ignore", "pipe", "inherit"],
});
let browser;
const artifacts = process.env.CALLWISE_UI_DIR || "artifacts/browser";
mkdirSync(artifacts, { recursive: true });
try {
  await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(() => {
      throw new Error("UI test server did not start.");
    }),
  ]);
  browser = await chromium.launch({
    ...(process.env.CALLWISE_BROWSER_BIN
      ? { executablePath: process.env.CALLWISE_BROWSER_BIN }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const failures = [];
  async function screen(name, width, height, snapshot, surface = "") {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (error) => failures.push(`${name}: ${error.message}`));
    await page.addInitScript((s) => {
      window.callwise = {
        desktop: false,
        onState: (callback) => {
          queueMicrotask(() => callback(s));
          return () => {};
        },
        onStopCapture: () => () => {},
        command: async () => s,
      };
    }, snapshot);
    await page.goto(
      `http://127.0.0.1:${port}/${surface ? "?surface=panel" : ""}`,
    );
    await page.locator("main").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    if (surface) {
      await page.evaluate(
        () => (document.querySelector(".card-region").style.maxHeight = "none"),
      );
      height = await page.evaluate(() => {
        const view = document.querySelector(".live-view"),
          region = document.querySelector(".card-region");
        return Math.max(
          232,
          Math.ceil(
            view.scrollHeight +
              Math.max(0, region.scrollHeight - region.clientHeight),
          ),
        );
      });
      await page.setViewportSize({ width, height });
    }
    if (name === "live-640") {
      await page.locator(".source summary").click();
      await page.evaluate(async () => {
        const { state } = await import("/state.mjs");
        state.set(state.get());
      });
      await page.waitForTimeout(200);
      assert.equal(
        await page.locator(".source").evaluate((n) => n.open),
        true,
        "Source excerpts must stay open across transcript updates",
      );
    }
    if (surface) {
      height = await page.evaluate(() =>
        Math.max(232, document.querySelector(".live-view").scrollHeight),
      );
      await page.setViewportSize({ width, height });
    }
    await page.screenshot({ path: `${artifacts}/${name}.png` });
    const layout = await page.evaluate(() => {
      const visible = [...document.querySelectorAll("main *")].filter(
        (n) =>
          n.getClientRects().length &&
          getComputedStyle(n).visibility !== "hidden",
      );
      const essential = [
        ...document.querySelectorAll(
          ".lead,.points li,#start,#consent,.ask-row,.live-status",
        ),
      ];
      return {
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        smallText: visible.filter(
          (n) =>
            n.firstChild?.nodeType === 3 &&
            n.textContent.trim() &&
            parseFloat(getComputedStyle(n).fontSize) < 12,
        ).length,
        essential: essential.map((n) => ({
          text: n.textContent.trim(),
          top: n.getBoundingClientRect().top,
          bottom: n.getBoundingClientRect().bottom,
        })),
        points: document.querySelectorAll(".points li").length,
        width: innerWidth,
        height: innerHeight,
      };
    });
    console.log(name, JSON.stringify(layout));
    assert.equal(layout.overflowX, false, `${name} overflows horizontally`);
    assert.equal(layout.smallText, 0, `${name} has text below 12px`);
    for (const item of layout.essential)
      assert.ok(
        item.top >= 0 && item.bottom <= height + 1,
        `${name}: ${item.text} is below the window`,
      );
    if (name === "live-440") assert.equal(layout.points, 3);
    await page.close();
  }
  await screen("ready", 720, 560, initial);
  const crowded = {
    ...initial,
    prep: {
      people: [],
      facts: [],
      likelyQuestions: [],
      myPoints: [{ id: "one", text: "Use the real example" }],
      watchFor: [],
      glossary: [],
    },
    context: Array.from({ length: 8 }, (_, i) => ({
      id: `material-${i}`,
      title: `Long evidence file ${i + 1} with an explanatory filename.pdf`,
    })),
    sheets: Array.from({ length: 5 }, (_, i) => ({
      id: `sheet-${i}`,
      name: `Recent call ${i + 1}`,
    })),
  };
  await screen("ready-crowded-720", 720, 560, crowded);
  await screen("ready-crowded-580", 580, 480, crowded);
  const live = {
    ...initial,
    status: "running",
    source: "manual",
    cards: [
      {
        id: "preview",
        lane: "fast",
        origin: "asked",
        kind: "say",
        status: "active",
        lead: "I'd start with the real example, explain my actions, and put the measured result in context.",
        trigger: { text: "Can you walk me through a relevant example?" },
        points: [
          {
            label: "Situation",
            text: "The approved notes explain the starting point and the original constraint.",
          },
          {
            label: "Action",
            text: "I can describe the specific changes I made and why they mattered.",
          },
          {
            label: "Result",
            text: "I should use the actual numbers and clarify how they were measured.",
          },
        ],
        sources: [],
      },
    ],
  };
  for (const [name, width, height] of [
    ["live-340", 340, 240],
    ["live-440", 440, 320],
    ["live-640", 640, 480],
  ]) {
    const s = structuredClone(live);
    // The smallest requested reference size exercises a short card. The 440px
    // default is the acceptance size for the full 16-word lead / three points.
    if (width === 340) {
      s.cards[0].lead = "I can explain the measured result.";
      s.cards[0].points = [];
    }
    if (width === 640)
      s.cards[0].sources = [
        {
          id: "source-1",
          title: "Approved example",
          excerpt:
            "Synthetic notes for this preview. The recorded result belongs to the supplied evidence.",
        },
      ];
    await screen(name, width, height, s, "panel");
  }
  await screen("recap", 720, 560, {
    ...initial,
    status: "ended",
    recap: {
      whatHappened: [
        "We discussed the measurement plan and agreed the next step.",
      ],
      whoOwesWhat: [],
      stillOpen: ["Confirm the reporting owner."],
      email: "Thanks for the conversation. I'll send the plan for your review.",
      interview: [],
    },
  });
  const { readFile } = await import("node:fs/promises");
  const interviewFixture = JSON.parse(
    await readFile(
      new URL("../fixtures/replay/interview-long.json", import.meta.url),
      "utf8",
    ),
  );
  const interview = new CallController({
    config: { openaiKey: "TEST_ONLY" },
    documentProvider: {
      generate: async ({ schema }) =>
        schema.properties.email
          ? {
              whatHappened: [
                "Discussed the account rebuild, attribution, and the first ninety days.",
                "Aligned on reliable tracking and a reporting owner.",
              ],
              whoOwesWhat: [
                {
                  owner: "Them",
                  what: "Talk to the team and reply",
                  due: "By Friday",
                  segmentIds: ["long-350"],
                },
                {
                  owner: "You",
                  what: "Send the case study",
                  due: "By tomorrow",
                  segmentIds: ["long-363"],
                },
              ],
              stillOpen: ["Confirm whether to introduce the ops lead."],
              email:
                "Thanks for the conversation. I'll send the case study by tomorrow. I look forward to hearing from your team by Friday.",
              interview: [],
            }
          : {
              people: [],
              facts: [],
              likelyQuestions: [],
              myPoints: [],
              watchFor: [],
              glossary: [],
            },
    },
  });
  try {
    await interview.command("configure", {
      mode: "interview",
      goal: interviewFixture.line,
    });
    await interview.command("start", { source: "manual", consent: true });
    interview.engine.settings.quiet = true;
    for (const row of interviewFixture.turns)
      interview.engine.ingest({ ...row, startMs: row.at, final: true });
    await interview.command("end");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(interview.recap.whoOwesWhat.length, 2);
    await screen("recap-interview-long", 720, 560, interview.snapshot());
  } finally {
    interview.close();
  }
  assert.deepEqual(failures, []);
  console.log("Browser layout checks passed with synthetic data only.");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
