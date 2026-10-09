import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { CallController } from "../core/controller.mjs";
import { live } from "../ui/views/live.mjs";
import { recap } from "../ui/views/recap.mjs";
test("renderer follows real controller through setup, sample, immediate explicit help, pause and recap", async () => {
  const { window, document } = parseHTML(
    await readFile(new URL("../ui/index.html", import.meta.url), "utf8"),
  );
  const c = new CallController({
      demoOnly: true,
      preferences: { goal: "My real call", mode: "interview" },
    }),
    calls = [];
  globalThis.window = window;
  globalThis.document = document;
  const intervals = [],
    timeouts = [],
    originalInterval = globalThis.setInterval,
    originalTimeout = globalThis.setTimeout;
  globalThis.setInterval = (...args) => {
    const id = originalInterval(...args);
    intervals.push(id);
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
      calls.push({ name, payload });
      return c.command(name, payload);
    },
    onState: (cb) => {
      c.on("state", cb);
      return () => c.off("state", cb);
    },
    onStopCapture: () => () => {},
  };
  window.requestAnimationFrame = (cb) => originalTimeout(cb, 0);
  const click = (selector) => {
    const node = document.querySelector(selector);
    assert.ok(node, selector);
    node.dispatchEvent(new window.Event("click", { bubbles: true }));
  };
  try {
    await import("../ui/app.mjs");
    await wait(30);
    assert.equal(document.getElementById("goal").value, "My real call");
    assert.ok(document.getElementById("start").hasAttribute("disabled"));
    assert.equal(document.querySelectorAll("dialog").length, 0);
    click('[data-action="call-type"][data-value="client"]');
    await wait(30);
    assert.deepEqual(calls.find((x) => x.name === "configure").payload, {
      mode: "client",
    });
    assert.equal(c.preferences.goal, "My real call");
    click('[data-action="practice"]');
    await wait(40);
    assert.match(document.body.textContent, /Sample call/);
    assert.equal(c.preferences.goal, "My real call");
    c.engine.settings.quiet = true;
    c.engine.ingest({
      id: "question",
      speaker: "Client",
      channel: "system",
      text: "What should we focus on next?",
      final: true,
    });
    await c.command("ask", { question: "How should I answer?" });
    await wait(30);
    assert.match(document.querySelector(".lead").textContent, /./);
    assert.match(document.querySelector(".trigger").textContent, /You asked/);
    const first = c.engine.cards.at(-1);
    await c.command("card.pin", { id: first.id });
    await wait(30);
    assert.match(document.querySelector(".card-nav").textContent, /Pinned/);
    click('[data-action="pause"]');
    await wait(30);
    assert.equal(c.engine.status, "paused");
    assert.match(document.body.textContent, /Paused/);
    click('[data-action="end"]');
    await wait(30);
    assert.match(document.body.textContent, /What happened/);
    assert.match(document.body.textContent, /Who owes what/);
    assert.match(document.body.textContent, /Still open/);
    click('[data-action="new"]');
    await wait(30);
    assert.equal(document.getElementById("goal").value, "My real call");
    assert.ok(document.getElementById("start").hasAttribute("disabled"));
  } finally {
    c.removeAllListeners();
    c.close();
    intervals.forEach(clearInterval);
    timeouts.forEach(clearTimeout);
    globalThis.setInterval = originalInterval;
    globalThis.setTimeout = originalTimeout;
    delete globalThis.window;
    delete globalThis.document;
  }
});
test("live view escapes transcript and source content, keeps points inline, and excludes late cards from the main slot", () => {
  const c = new CallController({ demoOnly: true });
  try {
    const s = c.snapshot();
    s.status = "running";
    s.cards = [
      {
        id: "a",
        lane: "fast",
        origin: "auto",
        kind: "say",
        lead: "I can explain the numbers.",
        points: [{ label: "Result", text: "A real measured improvement." }],
        sources: [
          { title: "<script>x</script>", excerpt: "<img src=x onerror=bad>" },
        ],
        trigger: { text: "<script>attack</script>" },
        status: "new",
        otherTurn: 0,
      },
      {
        id: "b",
        lane: "fast",
        origin: "auto",
        lead: "LATE_WORDS",
        late: true,
        status: "new",
      },
    ];
    const html = live(s, { selectedId: null, lastCardId: null });
    assert.doesNotMatch(html, /<script>|<img|LATE_WORDS/);
    assert.match(html, /A real measured improvement/);
    assert.match(html, /aria-live="polite"/);
    assert.doesNotMatch(html, /<dialog/);
  } finally {
    c.close();
  }
});
