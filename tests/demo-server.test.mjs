import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
test(
  "real browser demo serves the new module/style assets and still blocks non-UI paths",
  { timeout: 10000 },
  async () => {
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const child = spawn(process.execPath, ["scripts/demo-server.mjs"], {
      env: { ...process.env, CALLWISE_DEMO_PORT: String(port) },
      stdio: "ignore",
    });
    const exited = once(child, "exit");
    try {
      const root = `http://127.0.0.1:${port}`;
      let response;
      for (let i = 0; i < 50; i++) {
        try {
          response = await fetch(root);
          break;
        } catch {
          await wait(50);
        }
      }
      assert.equal(response?.status, 200);
      for (const asset of [
        "app.mjs",
        "suggestion-focus.mjs",
        "state.mjs",
        "tokens.css",
        "app.css",
        "views/live.mjs",
        "views/welcome.mjs",
        "components/card.mjs",
        "capture.mjs",
      ])
        assert.equal((await fetch(`${root}/${asset}`)).status, 200, asset);
      assert.equal((await fetch(`${root}/core/config.mjs`)).status, 404);
      assert.equal((await fetch(`${root}/api/events`)).status, 403);
    } finally {
      child.kill();
      await exited;
    }
  },
);
