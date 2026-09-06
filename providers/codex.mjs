import { spawn, execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { COACH_SCHEMA } from "../core/prompts.mjs";

// JSON-lines client for the documented Codex App Server stdio protocol.
export class CodexRpc extends EventEmitter {
  constructor({ bin = "codex", cwd, spawnImpl = spawn } = {}) {
    super();
    this.bin = bin;
    this.cwd = cwd;
    this.spawn = spawnImpl;
    this.pending = new Map();
    this.nextId = 0;
    this.process = null;
    this.buffer = "";
  }
  async connect() {
    if (this.connecting) return this.connecting;
    if (this.process && this.initialized) return;
    this.buffer = "";
    const child = this.spawn(this.bin, ["app-server"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.process = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (this.process !== child) return;
      this.buffer += chunk;
      if (this.buffer.length > 2_000_000) {
        this.fail(new Error("Codex sent an oversized response."));
        this.close();
        return;
      }
      let index;
      while ((index = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        try {
          this.receive(JSON.parse(line));
        } catch {
          /* Ignore non-JSON diagnostics; never display raw output. */
        }
      }
    });
    child.stderr.on("data", () => {}); // Diagnostics can contain private prompts or local paths.
    child.on("error", () => {
      if (this.process !== child) return;
      this.fail(
        new Error(
          "Codex could not start. Install Codex CLI, sign in, and check CALLWISE_CODEX_BIN.",
        ),
      );
    });
    child.on("exit", () => {
      if (this.process !== child) return;
      this.process = null;
      this.initialized = false;
      this.fail(new Error("Codex App Server stopped. Restart the connection."));
    });
    this.connecting = this.request(
      "initialize",
      {
        clientInfo: { name: "callwise", title: "Callwise", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
      15000,
    )
      .then(() => {
        this.send({ method: "initialized", params: {} });
        this.initialized = true;
      })
      .catch((error) => {
        this.close();
        throw error;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }
  protocol() {
    if (this.protocolInfo) return this.protocolInfo;
    const directory = mkdtempSync(path.join(tmpdir(), "callwise-protocol-"));
    try {
      execFileSync(
        this.bin,
        ["app-server", "generate-json-schema", "--out", directory],
        { timeout: 15000, stdio: "pipe", cwd: this.cwd },
      );
      const thread = JSON.parse(
        readFileSync(
          path.join(directory, "v2", "ThreadStartParams.json"),
          "utf8",
        ),
      );
      const turn = JSON.parse(
        readFileSync(
          path.join(directory, "v2", "TurnStartParams.json"),
          "utf8",
        ),
      );
      const definitions = thread.definitions || thread.$defs || {};
      const turnDefinitions = turn.definitions || turn.$defs || {};
      const modes = definitions.SandboxMode?.enum || [];
      const approvals = JSON.stringify(definitions.AskForApproval || {});
      const sandbox = modes.includes("read-only")
        ? "read-only"
        : modes.includes("readOnly")
          ? "readOnly"
          : null;
      const approval = approvals.includes('"untrusted"')
        ? "untrusted"
        : approvals.includes('"unlessTrusted"')
          ? "unlessTrusted"
          : null;
      const policies =
        turnDefinitions.SandboxPolicy?.oneOf ||
        turnDefinitions.SandboxPolicy?.anyOf ||
        [];
      const readOnly = policies.find((p) =>
        p.properties?.type?.enum?.includes("readOnly"),
      );
      if (!sandbox || !approval || !readOnly)
        throw new Error("Unsupported Codex permission schema.");
      this.protocolInfo = {
        sandbox,
        approval,
        restrictedAccess: !!readOnly.properties.access,
      };
      return this.protocolInfo;
    } catch {
      throw new Error(
        "This Codex version could not provide a supported App Server schema. Update Codex CLI or use API strategy.",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  send(message) {
    if (!this.process?.stdin.writable)
      throw new Error("Codex is not connected.");
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }
  request(method, params = {}, timeout = 15000, signal) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Codex request cancelled."));
        return;
      }
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.pending.delete(id);
      };
      const abort = () => {
        cleanup();
        reject(new Error("Codex request cancelled."));
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Codex ${method} timed out.`));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        timer,
      });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.send({ id, method, params });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
  receive(message) {
    if (message.id !== undefined && !message.method) {
      const p = this.pending.get(message.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(message.id);
      message.error
        ? p.reject(
            new Error(
              `Codex rejected the request (${message.error.code ?? "unknown"}). Check your CLI version and configuration.`,
            ),
          )
        : p.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      // No approval is granted by this unattended coaching client.
      if (
        [
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
        ].includes(message.method)
      )
        this.send({ id: message.id, result: { decision: "decline" } });
      else if (message.method === "mcpServer/elicitation/request")
        this.send({
          id: message.id,
          result: { action: "decline", content: null },
        });
      else
        this.send({
          id: message.id,
          error: {
            code: -32601,
            message:
              "Interactive actions are not available in Callwise coaching.",
          },
        });
      return;
    }
    this.emit("notification", message);
  }
  fail(error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit("failure", error);
  }
  close() {
    const child = this.process;
    this.process = null;
    this.initialized = false;
    this.buffer = "";
    if (child) {
      child.stdin.end();
      child.kill();
    }
    this.fail(new Error("Codex connection closed."));
  }
}

export class CodexProvider {
  constructor({ bin, model = "gpt-6-astra", effort = "high", cwd, rpc } = {}) {
    this.rpc = rpc || new CodexRpc({ bin, cwd });
    this.model = model;
    this.effort = effort;
    this.cwd = cwd;
    this.ready = false;
    this.busy = false;
  }
  async inspect() {
    await this.rpc.connect();
    const account = await this.rpc.request("account/read", {});
    const apps = await this.rpc
      .request("app/list", { limit: 50 })
      .catch(() => ({ data: [] }));
    return {
      signedIn: !!account.account,
      type: account.account?.type || "none",
      apps: (apps.data || []).map((a) => ({
        name: a.name,
        accessible: !!a.isAccessible,
        enabled: !!a.isEnabled,
      })),
      note: "App discovery only. Automatic connector execution is disabled in this first build.",
    };
  }
  async generate({ prompt, signal }) {
    if (this.busy) throw new Error("A Codex strategy turn is already running.");
    this.busy = true;
    let threadId, turnId;
    try {
      const protocol = this.rpc.protocol();
      await this.rpc.connect();
      const { account } = await this.rpc.request("account/read", {});
      if (!account)
        throw new Error(
          "Sign in to Codex on your Mac before choosing Codex strategy.",
        );
      const effective = await this.rpc.request("config/read", {
        includeLayers: false,
      });
      const config = {
        "features.apps": false,
        "apps._default.enabled": false,
        "features.shell_tool": false,
        web_search: "disabled",
        "features.code_mode.enabled": false,
        "tools.view_image": false,
        "tools.web_search": false,
      };
      for (const feature of [
        "unified_exec",
        "computer_use",
        "browser_use",
        "browser_use_external",
        "browser_use_full_cdp_access",
        "code_mode_host",
        "node_repl",
        "multi_agent",
        "view_image",
        "tool_suggest",
        "skill_search",
        "skill_mcp_dependency_install",
        "hooks",
        "codex_hooks",
        "memories",
      ])
        config[`features.${feature}`] = false;
      for (const name of Object.keys(effective.config?.mcp_servers || {}))
        config[`mcp_servers.${name}.enabled`] = false;
      for (const name of Object.keys(effective.config?.apps || {}))
        config[`apps.${name}.enabled`] = false;
      for (const name of Object.keys(effective.config?.plugins || {}))
        config[`plugins.${name}.enabled`] = false;
      signal.throwIfAborted();
      const result = await this.rpc.request("thread/start", {
        model: this.model,
        cwd: this.cwd,
        approvalPolicy: protocol.approval,
        sandbox: protocol.sandbox,
        ephemeral: true,
        config,
        developerInstructions:
          prompt.instructions +
          " Do not invoke tools. All authorized context is provided in the request. Return only the requested JSON.",
      });
      threadId = result.thread.id;
      signal.throwIfAborted();
      return await new Promise((resolve, reject) => {
        let messages = new Map(),
          finished = false;
        const finish = (error, value) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          this.rpc.off("notification", onEvent);
          this.rpc.off("failure", onFailure);
          signal.removeEventListener("abort", onAbort);
          error ? reject(error) : resolve(value);
        };
        const interrupt = () => {
          if (threadId && turnId)
            void this.rpc
              .request("turn/interrupt", { threadId, turnId }, 3000)
              .catch(() => {});
        };
        const onAbort = () => {
          interrupt();
          finish(new Error("Codex strategy cancelled."));
        };
        const onFailure = (error) => finish(error);
        const onEvent = (event) => {
          const p = event.params || {};
          if (p.threadId && p.threadId !== threadId) return;
          if (p.turnId && turnId && p.turnId !== turnId) return;
          if (
            event.method === "item/completed" &&
            p.item?.type === "agentMessage" &&
            p.item.phase !== "commentary"
          )
            messages.set(p.item.id, p.item.text);
          if (event.method === "turn/completed") {
            if (turnId && p.turn?.id !== turnId) return;
            if (p.turn?.status !== "completed") {
              finish(
                new Error(
                  "Codex could not finish the strategy turn. Check your subscription limits or configuration.",
                ),
              );
              return;
            }
            for (const item of p.turn.items || [])
              if (item.type === "agentMessage" && item.phase !== "commentary")
                messages.set(item.id, item.text);
            const text = [...messages.values()].at(-1) || "";
            try {
              finish(null, JSON.parse(text));
            } catch {
              finish(
                new Error("Codex returned an unreadable coaching response."),
              );
            }
          }
        };
        const timer = setTimeout(() => {
          interrupt();
          finish(
            new Error(
              "Codex strategy exceeded 90 seconds. Try a lower reasoning effort.",
            ),
          );
        }, 90000);
        this.rpc.on("notification", onEvent);
        this.rpc.on("failure", onFailure);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
          onAbort();
          return;
        }
        this.rpc
          .request(
            "turn/start",
            {
              threadId,
              input: [{ type: "text", text: prompt.input }],
              model: this.model,
              effort: this.effort,
              approvalPolicy: protocol.approval,
              sandboxPolicy: {
                type: "readOnly",
                networkAccess: false,
                ...(protocol.restrictedAccess
                  ? {
                      access: {
                        type: "restricted",
                        includePlatformDefaults: true,
                        readableRoots: [this.cwd],
                      },
                    }
                  : {}),
              },
              outputSchema: COACH_SCHEMA,
            },
            20000,
          )
          .then((r) => {
            turnId = r.turn.id;
            if (signal.aborted || finished) interrupt();
          })
          .catch((e) => finish(e));
      });
    } finally {
      this.busy = false;
      if (threadId)
        void this.rpc
          .request("thread/unsubscribe", { threadId }, 3000)
          .catch(() => {});
    }
  }
  close() {
    this.rpc.close();
  }
}
