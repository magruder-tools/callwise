import test from "node:test";
import assert from "node:assert/strict";
import { codexBinaries } from "../scripts/codex-bundle.mjs";

const main = "package/vendor/aarch64-apple-darwin/bin/codex";
const host = "package/vendor/aarch64-apple-darwin/bin/codex-code-mode-host";

test("the packaged runtime includes its required tool host from the same architecture", () => {
  assert.deepEqual(
    codexBinaries([main, host, "package/vendor/x86_64-apple-darwin/bin/codex"]),
    {
      codex: main,
      "codex-code-mode-host": host,
    },
  );
});
test("a missing or ambiguous native tool host stops packaging", () => {
  assert.throws(() => codexBinaries([main]), /codex-code-mode-host/);
  assert.throws(() => codexBinaries([main, host, host]), /exactly one/);
  assert.throws(
    () => codexBinaries([main, host.replace("/bin/", "/other/")]),
    /siblings/,
  );
});
test("unsafe archive paths are rejected before extracting runtime files", () => {
  for (const unsafe of ["/tmp/unexpected", "package/../../unexpected"])
    assert.throws(() => codexBinaries([main, host, unsafe]), /unsafe path/);
});
