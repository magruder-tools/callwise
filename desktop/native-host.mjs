import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
const MODES = new Set([
  "capabilities",
  "assets",
  "speech",
  "diarize",
  "llm",
  "reminders",
  "calendar",
  "archive-files",
  "embedding",
]);
const MESSAGES = {
  icloud_archive_unavailable:
    "iCloud has not confirmed a safe archive/offload yet. Original audio is kept on this Mac.",
  speech_assets_missing:
    "Download the selected speech language in Callwise Setup first.",
  language_unsupported:
    "Apple speech does not support this language on this Mac.",
  local_ai_unavailable:
    "Apple Intelligence is unavailable. Your original notes and transcript are still saved.",
  permission_denied:
    "Access was not allowed. You can change it in System Settings.",
  native_operation_failed:
    "The local meeting engine could not complete this operation.",
};
export class NativeHost extends EventEmitter {
  constructor({
    binary,
    mode,
    spawnProcess = spawn,
    resources = "",
    timeout = 30000,
  } = {}) {
    super();
    if (!MODES.has(mode))
      throw new Error("Unsupported local engine operation.");
    this.binary = binary;
    this.mode = mode;
    this.spawnProcess = spawnProcess;
    this.resources = resources;
    this.timeout = timeout;
    this.pending = new Map();
    this.closed = false;
  }
  start() {
    if (this.process) return;
    if (!existsSync(this.binary) && this.spawnProcess === spawn)
      throw new Error(
        "The local meeting engine is missing. Rebuild or reinstall Callwise.",
      );
    this.process = this.spawnProcess(this.binary, [this.mode], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        CALLWISE_NATIVE_RESOURCES: this.resources,
      },
    });
    let buffer = "";
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 2 * 1048576)
        return this.fail(
          new Error("The local meeting engine returned an oversized response."),
        );
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n"),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (Buffer.byteLength(line) > 1048576)
          return this.fail(
            new Error(
              "The local meeting engine returned an oversized response.",
            ),
          );
        let value;
        try {
          value = JSON.parse(line);
        } catch {
          return this.fail(
            new Error("The local meeting engine returned an invalid response."),
          );
        }
        if (value.type === "result" || (value.type === "error" && value.id)) {
          const p = this.pending.get(value.id);
          if (!p) continue;
          this.pending.delete(value.id);
          clearTimeout(p.timer);
          p.cleanup();
          if (value.type === "error")
            p.reject(
              Object.assign(
                new Error(
                  MESSAGES[value.code] || MESSAGES.native_operation_failed,
                ),
                { code: value.code },
              ),
            );
          else p.resolve(value.value);
        } else this.emit("message", value);
      }
    });
    // Never forward arbitrary native logs: upstream libraries can log filenames/content.
    this.process.stderr.on("data", () => {});
    this.process.on("error", () =>
      this.fail(new Error("The local meeting engine could not start.")),
    );
    this.process.on("exit", (code) => {
      this.fail(new Error("The local meeting engine stopped."), false);
      this.emit("exit", code);
    });
  }
  send(value) {
    if (this.closed) throw new Error("The local meeting engine is closed.");
    this.start();
    const line = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(line) > 1048576)
      throw new Error("The local engine request is too large.");
    if (this.process.stdin.writableLength > 2 * 1048576)
      throw new Error("The local audio engine is overloaded.");
    this.process.stdin.write(line);
  }
  request(op, args = {}, { timeout = this.timeout, signal } = {}) {
    if (signal?.aborted)
      return Promise.reject(new Error("Operation cancelled."));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const abort = () => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.cleanup();
        reject(new Error("Operation cancelled."));
        this.close();
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        signal?.removeEventListener("abort", abort);
        reject(new Error("The local meeting engine took too long."));
        this.close();
      }, timeout);
      timer.unref?.();
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        cleanup: () => signal?.removeEventListener("abort", abort),
      });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.send({ ...args, id, op });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(e);
      }
    });
  }
  fail(error, kill = true) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.cleanup();
      p.reject(error);
    }
    this.pending.clear();
    if (kill) this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.fail(new Error("Operation cancelled."), false);
    this.process?.stdin.destroy();
    this.process?.kill("SIGTERM");
    const child = this.process;
    const timer = setTimeout(() => {
      if (child?.exitCode === null) child.kill("SIGKILL");
    }, 1000);
    timer.unref?.();
  }
}
export class NativeServices {
  constructor({
    binary,
    resources,
    hostFactory = (opts) => new NativeHost(opts),
  }) {
    this.binary = binary;
    this.resources = resources;
    this.hostFactory = hostFactory;
    this.hosts = new Set();
  }
  async run(mode, args = {}, options = {}) {
    const host = this.hostFactory({
      binary: this.binary,
      resources: this.resources,
      mode,
    });
    this.hosts.add(host);
    host.on("message", (value) => options.onProgress?.(value));
    try {
      return await host.request(args.op || mode, args, options);
    } finally {
      this.hosts.delete(host);
      host.close();
    }
  }
  async embed(texts) {
    // Keep the on-device sentence model warm. A process launch per partial misses the 15 ms budget.
    if (!this.embeddingHost || this.embeddingHost.closed) {
      this.embeddingHost = this.hostFactory({ binary: this.binary, resources: this.resources, mode: "embedding" });
      this.hosts.add(this.embeddingHost);
    }
    const result = await this.embeddingHost.request("vectors", { texts }, { timeout: 15000 });
    return result.vectors;
  }
  close() {
    for (const h of this.hosts) h.close();
    this.hosts.clear();
  }
}
export function nativePaths({ root, packaged, executable, resourcesPath }) {
  return {
    binary: packaged
      ? path.join(path.dirname(executable), "callwise-native")
      : path.join(root, "native/build/callwise-native"),
    resources: packaged
      ? path.join(resourcesPath, "native")
      : path.join(root, "native/resources"),
  };
}
