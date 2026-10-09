import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { CallController } from "../core/controller.mjs";

test("renderer runs against the real controller: start, source-linked cards, feedback, and pause", async () => {
  const { window, document } = parseHTML(
    await readFile(new URL("../ui/index.html", import.meta.url), "utf8"),
  );
  const required = [
    "status-label",
    "status-dot",
    "start",
    "pause",
    "end",
    "source",
    "backend",
    "mode",
    "goal",
    "project",
    "quiet",
    "profile",
    "save-profile",
    "auto-search",
    "ask-submit",
    "transcript-submit",
    "deep-think",
    "fast-status",
    "strategy-status",
    "usage",
    "retention",
    "transcript-footnote",
    "mic-label",
    "system-label",
    "transcript",
    "transcript-count",
    "context-list",
    "context-count",
    "openai-status",
    "fireflies-status",
    "mcp-status",
    "model-labels",
    "import-file",
    "inspect-codex",
    "error-box",
    "demo-notice",
    "live-consent",
    "fireflies-field",
    "source-title",
    "source-text",
    "source-link",
    "source-dialog",
    "consent",
    "fireflies-id",
    "question",
    "ask-form",
    "transcript-form",
    "speaker",
    "transcript-text",
    "context-form",
    "context-title",
    "context-url",
    "context-text",
    "context-dialog",
    "add-context",
    "settings-open",
    "settings-dialog",
    "context-search-open",
    "search-dialog",
    "search-form",
    "context-query",
    "history-form",
    "history-id",
    "search-result",
    "export",
    "compact",
    "toast",
    "openai-key",
    "fireflies-key",
    "fast-model",
    "strategy-model",
    "transcription-model",
    "save-connections",
    "check-connections",
    "connection-result",
  ];
  const missing = required.filter((id) => !document.getElementById(id));
  assert.deepEqual(
    missing,
    [],
    `UI fixture is missing IDs: ${missing.join(", ")}`,
  );
  const c = new CallController({
    demoOnly: true,
    preferences: {
      goal: "My own goal",
      mode: "interview",
      project: "Real call",
    },
  });
  const commands = [];
  const tracked = [];
  const originalInterval = globalThis.setInterval;
  const originalTimeout = globalThis.setTimeout;
  const timeouts = [];
  globalThis.window = window;
  globalThis.document = document;
  globalThis.setInterval = (...args) => {
    const id = originalInterval(...args);
    tracked.push(id);
    return id;
  };
  globalThis.setTimeout = (...args) => {
    const id = originalTimeout(...args);
    timeouts.push(id);
    return id;
  };
  window.callwise = {
    desktop: false,
    command: (name, payload) => {
      commands.push({ name, payload });
      return c.command(name, payload);
    },
    onState: (cb) => {
      c.on("state", cb);
      return () => c.off("state", cb);
    },
    onStopCapture: () => () => {},
  };
  for (const select of document.querySelectorAll("select"))
    Object.defineProperty(select, "value", {
      configurable: true,
      get() {
        return (
          this._selectedValue ??
          this.querySelector("option")?.getAttribute("value") ??
          this.querySelector("option")?.textContent ??
          ""
        );
      },
      set(value) {
        this._selectedValue = value;
      },
    });
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.showModal = () => dialog.setAttribute("open", "");
    dialog.close = () => dialog.removeAttribute("open");
  }
  const byId = (id) => document.getElementById(id);
  const click = (el) =>
    el.dispatchEvent(new window.Event("click", { bubbles: true }));
  try {
    await import("../ui/app.mjs");
    assert.equal(byId("status-label").textContent, "Ready when you are");
    assert.equal(
      byId("strategy-cards").closest("dialog").id,
      "insights-dialog",
    );
    click(byId("more-open"));
    assert.equal(byId("more-dialog").hasAttribute("open"), true);
    click(byId("setup-open"));
    assert.equal(byId("more-dialog").hasAttribute("open"), false);
    assert.equal(byId("setup-dialog").hasAttribute("open"), true);
    byId("setup-dialog").close();
    click(byId("more-open"));
    click(byId("connections-shortcut"));
    assert.equal(byId("settings-dialog").hasAttribute("open"), true);
    assert.equal(byId("more-dialog").hasAttribute("open"), false);
    byId("settings-dialog").close();
    window.callwise.desktop = true;
    click(byId("settings-open"));
    await wait(5);
    assert.equal(
      commands.some((command) => command.name === "context.discover"),
      false,
      "settings must not discover apps without a click",
    );
    byId("settings-dialog").close();
    window.callwise.desktop = false;
    click(byId("insights-open"));
    assert.equal(byId("insights-dialog").hasAttribute("open"), true);
    byId("insights-dialog").close();
    click(byId("start"));
    await wait(25);
    assert.equal(c.engine.status, "running");
    assert.equal(byId("context-count").textContent, "3");
    await c.command("transcript", {
      speaker: "Client",
      text: "Are these attribution windows comparable?",
    });
    await c.engine.run("fast");
    assert.ok(
      byId("fast-cards").textContent.includes("Check whether the ROAS"),
    );
    assert.ok(byId("fast-cards").querySelectorAll(".source-chip").length > 0);
    click(byId("fast-cards").querySelector(".source-chip"));
    await wait(5);
    assert.ok(byId("source-text").textContent.includes("DEMO"));
    assert.equal(byId("source-dialog").hasAttribute("open"), true);
    click(byId("fast-cards").querySelector(".card-actions button"));
    await wait(5);
    assert.equal(c.engine.metrics.accepted, 1);
    assert.ok(byId("fast-cards").textContent.includes("Kept"));
    const readingNode = byId("fast-cards").firstElementChild;
    const details = readingNode.querySelector("details");
    details.setAttribute("open", "");
    readingNode.querySelector(".card-scroll").scrollTop = 55;
    const first = c.engine.cards.find(
      (card) => card.id === readingNode.dataset.cardId,
    );
    first.expiresAt = 0;
    c.engine.cards.push({
      ...first,
      id: "new-queued",
      title: "A newer thought",
      say: "Who owns the next step?",
      status: "new",
      expiresAt: Date.now() + 30000,
    });
    c.engine.emitState();
    assert.equal(
      byId("fast-cards").firstElementChild,
      readingNode,
      "new advice must not replace the reading node",
    );
    assert.equal(details.hasAttribute("open"), true);
    assert.equal(readingNode.querySelector(".card-scroll").scrollTop, 55);
    assert.match(byId("fast-cards").textContent, /Earlier · check relevance/);
    assert.match(byId("next-fast").textContent, /1 new/);
    click(byId("transcript-open"));
    assert.equal(byId("transcript-dialog").hasAttribute("open"), true);
    assert.equal(byId("fast-cards").firstElementChild, readingNode);
    byId("transcript-dialog").close();
    click(byId("advice-history-open"));
    assert.equal(
      byId("advice-history-list").querySelectorAll(".history-item").length,
      c.engine.cards.length,
    );
    byId("advice-history-dialog").close();
    click(byId("pause"));
    await wait(1100);
    assert.equal(
      byId("fast-cards").firstElementChild,
      readingNode,
      "expiration during pause must not remove advice",
    );
    click(byId("next-fast"));
    assert.match(byId("fast-cards").textContent, /Who owns the next step/);
    assert.equal(byId("next-fast").disabled, true);
    assert.equal(c.engine.status, "paused");
    assert.equal(byId("status-label").textContent, "Session paused");
    c.engine.error("Connection interrupted", {
      condition: "connection:mic",
      lifetimeMs: null,
    });
    assert.equal(byId("error-box").hidden, false);
    assert.equal(
      byId("toast").hidden,
      true,
      "errors are shown once, without a duplicate toast",
    );
    click(byId("start"));
    await wait(5);
    assert.equal(c.engine.status, "running");
    assert.equal(
      byId("error-box").hidden,
      true,
      "a successful resume clears the connection error",
    );
    await c.command("ask", { question: "What is the next step?" });
    assert.match(
      byId("fast-cards").textContent,
      /You asked: What is the next step/,
    );
    assert.equal(
      byId("next-fast").disabled,
      true,
      "asked answers become current immediately",
    );
    c.engine.error("Dismiss me", { lifetimeMs: null });
    click(byId("error-dismiss"));
    await wait(5);
    c.engine.emitState();
    assert.equal(
      byId("error-box").hidden,
      true,
      "dismissed errors stay dismissed across snapshots",
    );
    click(byId("end"));
    await wait(5);
    byId("source").value = "audio";
    byId("source").dispatchEvent(new window.Event("change", { bubbles: true }));
    await wait(5);
    assert.deepEqual(
      commands.filter((command) => command.name === "configure").at(-1).payload,
      { preferredSource: "audio" },
    );
    assert.equal(c.preferences.goal, "My own goal");
    click(byId("save-profile"));
    await wait(5);
    assert.deepEqual(
      Object.keys(
        commands.filter((command) => command.name === "configure").at(-1)
          .payload,
      ),
      ["profile"],
    );
    click(byId("start"));
    await wait(5);
    assert.equal(c.engine.status, "idle");
    assert.equal(byId("transcript-count").textContent, "0");
    assert.equal(byId("advice-count").textContent, "0");
    assert.equal(byId("fast-cards").querySelector(".coaching-card"), null);
    byId("source").value = "audio";
    byId("consent").checked = false;
    click(byId("start"));
    await wait(5);
    assert.equal(byId("setup-dialog").hasAttribute("open"), true);
    assert.equal(
      c.engine.status,
      "idle",
      "consent review must not start capture",
    );
  } finally {
    c.close();
    for (const id of tracked) clearInterval(id);
    for (const id of timeouts) clearTimeout(id);
    globalThis.setInterval = originalInterval;
    globalThis.setTimeout = originalTimeout;
    delete globalThis.window;
    delete globalThis.document;
  }
});
