import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { connectionControls } from "../ui/connections.mjs";
import { CallController } from "../core/controller.mjs";
async function setup(desktop = true) {
  const { window, document } = parseHTML(
    await readFile(new URL("../ui/index.html", import.meta.url), "utf8"),
  );
  globalThis.document = document;
  for (const select of document.querySelectorAll("select"))
    Object.defineProperty(select, "value", {
      configurable: true,
      get() {
        return this._v ?? this.querySelector("option")?.value ?? "";
      },
      set(v) {
        this._v = v;
      },
    });
  const c = new CallController({
    contextProvider: {
      cancel() {},
      close() {},
      async inspect() {
        return {
          apps: [
            { id: "real-id", name: "Gmail", ready: true, readOnlyToolCount: 2 },
            {
              id: "not-ready",
              name: "Unavailable app",
              ready: false,
              readOnlyToolCount: 0,
            },
          ],
          note: "Ready apps only.",
        };
      },
    },
  });
  const calls = [],
    errors = [];
  const bridge = {
    desktop,
    command: async (name, payload) => {
      calls.push({ name, payload });
      if (name === "desktop.codex.signin")
        return { signedIn: true, reused: true };
      if (name === "desktop.connections.save") return { saved: true };
      if (name === "desktop.connections.check")
        return [{ ok: true, label: "Fast", detail: "Metadata only." }];
      return c.command(name, payload);
    },
  };
  const controls = connectionControls(bridge, {
    toast() {},
    showError: (m) => errors.push(m),
  });
  c.on("state", (state) => controls.sync(state));
  controls.sync(c.snapshot());
  const byId = (id) => document.getElementById(id),
    click = (id) =>
      byId(id).dispatchEvent(new window.Event("click", { bubbles: true }));
  const close = () => {
    c.removeAllListeners();
    c.close();
    delete globalThis.document;
  };
  return { c, controls, byId, click, calls, errors, close };
}
test("connection screen discovers actual IDs, enables selected apps in one explicit action", async () => {
  const t = await setup();
  try {
    await t.c.command("configure", { project: "Test client" });
    t.click("inspect-codex");
    await wait(5);
    const inputs = t.byId("codex-apps").querySelectorAll("input");
    assert.equal(inputs.length, 2);
    assert.equal(
      [...inputs].find((i) => i.dataset.appId === "not-ready").disabled,
      true,
    );
    assert.equal(inputs[0].checked, false);
    [...inputs].find((i) => i.dataset.appId === "real-id").checked = true;
    t.byId("context-backend").value = "codex";
    t.click("apply-context");
    await wait(5);
    assert.deepEqual(t.c.engine.settings.contextApps, ["real-id"]);
    assert.equal(t.c.engine.settings.contextConsent, true);
    assert.equal(t.errors.length, 0);
  } finally {
    t.close();
  }
});
test("connection UI preserves a draft app selection across unrelated state updates", async () => {
  const t = await setup();
  try {
    t.click("inspect-codex");
    await wait(5);
    const input = t.byId("codex-apps").querySelector("input");
    input.checked = true;
    t.c.engine.emitState();
    assert.equal(input.checked, true);
  } finally {
    t.close();
  }
});
test("connection UI rejects automatic lookup without a named scope", async () => {
  const t = await setup();
  try {
    t.click("inspect-codex");
    await wait(5);
    t.byId("codex-apps").querySelector("input").checked = true;
    t.byId("context-backend").value = "codex";
    t.byId("auto-search").checked = true;
    t.click("apply-context");
    await wait(5);
    assert.match(t.errors[0], /client or project/);
    assert.equal(t.c.engine.settings.contextConsent, false);
  } finally {
    t.close();
  }
});
test("Save connections reaches the desktop handler and clears password inputs", async () => {
  const t = await setup();
  try {
    t.byId("openai-key").value = "not-a-real-key-for-offline-test";
    t.byId("fireflies-key").value = "not-a-real-fireflies-key";
    t.click("save-connections");
    await wait(5);
    assert.ok(t.calls.some((c) => c.name === "desktop.connections.save"));
    assert.equal(t.byId("openai-key").value, "");
    assert.equal(t.byId("fireflies-key").value, "");
    t.click("check-connections");
    await wait(5);
    assert.match(t.byId("connection-result").textContent, /Metadata only/);
  } finally {
    t.close();
  }
});
test("browser demo disables account actions and live session locks permissions", async () => {
  const t = await setup(false);
  try {
    assert.equal(t.byId("save-connections").disabled, true);
    assert.equal(t.byId("inspect-codex").disabled, true);
  } finally {
    t.close();
  }
  const u = await setup();
  try {
    u.controls.sync({ ...u.c.snapshot(), status: "running" });
    assert.equal(u.byId("apply-context").disabled, true);
  } finally {
    u.close();
  }
});

test("saved app choices reappear when the first catalog arrives after restart", async () => {
  const t = await setup();
  try {
    t.c.preferences = {
      contextApps: ["real-id"],
      contextConsent: true,
      contextBackend: "codex",
    };
    t.c.engine.configure(t.c.preferences);
    t.click("inspect-codex");
    await wait(10);
    assert.equal(t.byId("codex-apps").querySelector("input").checked, true);
    assert.match(t.byId("codex-status-title").textContent, /1 app enabled/);
    await t.c.command("new");
    assert.equal(t.byId("codex-apps").querySelector("input").checked, true);
    assert.equal(t.byId("context-backend").value, "codex");
  } finally {
    t.close();
  }
});

test("saved choices are visibly off until one enable action, then remain enabled after restart", async () => {
  const t = await setup();
  try {
    t.c.engine.configure({
      contextBackend: "codex",
      contextApps: ["real-id"],
      contextConsent: false,
    });
    t.click("inspect-codex");
    await wait(5);
    assert.match(t.byId("codex-status-title").textContent, /app access is off/);
    assert.equal(t.byId("codex-search-open").disabled, true);
    t.click("apply-context");
    await wait(5);
    assert.equal(t.c.preferences.contextConsent, true);
    assert.equal(t.byId("codex-search-open").disabled, false);
    assert.match(t.byId("codex-status-title").textContent, /1 app enabled/);
    const restarted = new CallController({ preferences: t.c.preferences });
    try {
      assert.deepEqual(restarted.snapshot().settings.contextApps, ["real-id"]);
      assert.equal(restarted.snapshot().settings.contextConsent, true);
      assert.equal(restarted.snapshot().status, "idle");
    } finally {
      restarted.close();
    }
    t.click("codex-disable");
    await wait(5);
    assert.equal(t.c.preferences.contextConsent, false);
    assert.deepEqual(t.c.preferences.contextApps, ["real-id"]);
    assert.equal(t.byId("codex-search-open").disabled, true);
  } finally {
    t.close();
  }
});
test("Connect reuses sign-in and discovers apps without a second button", async () => {
  const t = await setup();
  try {
    t.click("codex-signin");
    await wait(5);
    assert.deepEqual(
      t.calls.slice(0, 2).map((c) => c.name),
      ["desktop.codex.signin", "context.discover"],
    );
    assert.equal(t.byId("codex-signin").hidden, true);
    assert.equal(
      t.c.engine.settings.contextConsent,
      false,
      "discovery alone must not grant access",
    );
  } finally {
    t.close();
  }
});
test("an unrelated refresh preserves unsaved choices and cannot silently enable them", async () => {
  const t = await setup();
  try {
    t.click("inspect-codex");
    await wait(5);
    t.byId("codex-apps").querySelector("input").checked = true;
    t.click("inspect-codex");
    await wait(5);
    assert.equal(t.byId("codex-apps").querySelector("input").checked, true);
    assert.equal(t.c.engine.settings.contextConsent, false);
  } finally {
    t.close();
  }
});
