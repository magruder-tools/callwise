import { CodexRpc } from "../providers/codex.mjs";

export function approvedLoginUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        url.port || !["auth.openai.com", "chatgpt.com"].includes(url.hostname)) return "";
    return url.href;
  } catch { return ""; }
}

// This helper only uses account/login methods, never inference or connector
// content. OAuth tokens stay with the official Codex binary, not the renderer.
export class CodexLogin {
  constructor({ bin, cwd, openBrowser, rpc, timeoutMs = 180000 } = {}) {
    this.rpc = rpc || new CodexRpc({ bin, cwd });
    this.openBrowser = openBrowser;
    this.timeoutMs = timeoutMs;
    this.busy = false;
  }
  async signIn() {
    if (this.busy) throw new Error("Codex sign-in is already open in your browser.");
    this.busy = true;
    let timer;
    const operation = new AbortController();
    this.operation = operation;
    try {
      timer = setTimeout(() => operation.abort(), this.timeoutMs);
      await this.rpc.connect();
      operation.signal.throwIfAborted();
      const { account } = await this.rpc.request("account/read", { refreshToken: false }, 10000, operation.signal);
      if (["chatgpt", "chatgptAuthTokens"].includes(account?.type)) return { signedIn: true, reused: true };
      if (account) throw new Error("Codex already uses a different login method. Sign in with ChatGPT in Codex first; Callwise has not replaced that login.");
      return await new Promise((resolve, reject) => {
        let loginId, finished = false;
        const cleanup = () => {
          this.rpc.off("notification", onEvent);
          this.rpc.off("failure", onFailure);
          operation.signal.removeEventListener("abort", onAbort);
        };
        const finish = (error) => {
          if (finished) return;
          finished = true;
          cleanup();
          error ? reject(error) : resolve({ signedIn: true, reused: false });
        };
        const onFailure = () => finish(new Error("Codex sign-in connection closed. Try signing in again."));
        const onAbort = () => {
          if (loginId) void this.rpc.request("account/login/cancel", { loginId }, 1000).catch(() => {});
          finish(new Error("Codex sign-in was cancelled or timed out. Click Sign in again to retry."));
        };
        const onEvent = ({ method, params = {} }) => {
          if (method !== "account/login/completed" || params.loginId !== loginId) return;
          finish(params.success ? null : new Error("ChatGPT sign-in did not complete. Try again in your browser."));
        };
        this.rpc.on("notification", onEvent);
        this.rpc.on("failure", onFailure);
        operation.signal.addEventListener("abort", onAbort, { once: true });
        if (operation.signal.aborted) return onAbort();
        this.rpc.request("account/login/start", { type: "chatgpt" }, 15000, operation.signal)
          .then(async (result) => {
            loginId = result.loginId;
            if (finished || operation.signal.aborted) return;
            const url = approvedLoginUrl(result.authUrl);
            if (result.type !== "chatgpt" || typeof loginId !== "string" || !url)
              throw new Error("Codex returned an unrecognized sign-in link. No browser page was opened.");
            await this.openBrowser(url);
          })
          .catch((error) => finish(new Error(error.message === "Codex returned an unrecognized sign-in link. No browser page was opened."
            ? error.message : "Could not open Codex sign-in. Check your connection and retry.")));
      });
    } finally {
      clearTimeout(timer);
      this.operation = null;
      this.busy = false;
      this.rpc.close();
    }
  }
  cancel() { this.operation?.abort(); }
  close() { this.cancel(); this.rpc.close(); }
}
