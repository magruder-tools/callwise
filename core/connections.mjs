// Persistent connection settings only. Session notes and transcripts are never stored here.
// Electron safeStorage is injected by the trusted main process; this module has no renderer API.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MODELS = ["fastModel", "strategyModel", "transcriptionModel"];
const KEYS = ["openaiKey", "firefliesKey"];
function requireEncryption(storage) {
  if (
    !storage?.isEncryptionAvailable() ||
    storage.getSelectedStorageBackend?.() === "basic_text"
  )
    throw new Error(
      "Secure storage is unavailable. Unlock your computer's keychain and reopen Callwise. No key was saved.",
    );
}
export function sanitizeConnections(patch, previous = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Invalid connection settings.");
  const next = {};
  for (const name of [...KEYS, ...MODELS]) {
    const candidate =
      patch[name] === undefined || patch[name] === ""
        ? previous[name]
        : patch[name];
    if (candidate === undefined || candidate === "") continue;
    if (typeof candidate !== "string")
      throw new Error("Connection values must be text.");
    const value = candidate.trim();
    if (MODELS.includes(name)) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,149}$/.test(value))
        throw new Error("Use a model name, not a URL or a key.");
    } else if (value.length < 10 || value.length > 2048 || /\s/.test(value)) {
      throw new Error(
        "That key does not look complete. Copy it again into the connection field.",
      );
    }
    next[name] = value;
  }
  for (const [name, limit] of Object.entries({
    mcpUrl: 2000,
    mcpToken: 2048,
    mcpSearchTool: 150,
    mcpSearchArguments: 8000,
  })) {
    const candidate =
      patch[name] === undefined || patch[name] === ""
        ? previous[name]
        : patch[name];
    if (candidate === undefined || candidate === "") continue;
    if (typeof candidate !== "string" || candidate.length > limit)
      throw new Error("Enter valid custom server settings.");
    const value = candidate.trim();
    if (name === "mcpUrl") {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error("Use an HTTPS or localhost server URL.");
      }
      if (
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          )) ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new Error(
          "Use HTTPS or localhost, with credentials in the private token field.",
        );
    }
    if (name === "mcpToken" && /\s/.test(value))
      throw new Error("The private server token cannot contain spaces.");
    if (
      name === "mcpSearchTool" &&
      !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,149}$/.test(value)
    )
      throw new Error("Enter the server's exact read-only search tool name.");
    if (name === "mcpSearchArguments") {
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error("Search parameters must be valid JSON.");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Search parameters must be a JSON object.");
    }
    next[name] = value;
  }
  return next;
}
export function readConnections(filename, storage) {
  if (!existsSync(filename)) return {};
  requireEncryption(storage);
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32000)
    throw new Error(
      "The saved connection file is invalid. No settings were loaded.",
    );
  try {
    return sanitizeConnections(
      JSON.parse(storage.decryptString(readFileSync(filename))),
    );
  } catch {
    throw new Error(
      "Saved connections could not be unlocked. Unlock your keychain and restart Callwise. See README.md for recovery; the saved file was not replaced.",
    );
  }
}
export function saveConnections(filename, storage, patch) {
  requireEncryption(storage);
  // Never replace a corrupt/unreadable vault silently. It may contain other saved credentials.
  const previous = readConnections(filename, storage);
  const next = sanitizeConnections(patch, previous);
  const encrypted = storage.encryptString(JSON.stringify(next));
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, encrypted, { mode: 0o600, flag: "wx" });
    renameSync(temporary, filename);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return next;
}
export async function checkModelAccess(
  config,
  { fetchImpl = fetch, signal } = {},
) {
  if (!config.openaiKey)
    return [
      {
        label: "OpenAI key",
        ok: false,
        detail: "Add your key in Settings first.",
      },
    ];
  const timeout = AbortSignal.timeout(12000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return Promise.all(
    MODELS.map(async (role) => {
      const model = config[role];
      const label = {
        fastModel: "Fast coaching",
        strategyModel: "Deep strategy",
        transcriptionModel: "Transcription",
      }[role];
      if (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,149}$/.test(model))
        return { label, ok: false, detail: "Choose a valid model name." };
      try {
        const response = await fetchImpl(
          `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
          {
            headers: { Authorization: `Bearer ${config.openaiKey}` },
            signal: requestSignal,
          },
        );
        // Read-only model metadata, never inference, audio, a transcript, or a paid test prompt.
        const detail = response.ok
          ? `${model}: visible to this API key. Live inference and billing still need a practice test.`
          : response.status === 401
            ? "The key was rejected. Replace it in Settings."
            : response.status === 403 || response.status === 404
              ? `${model}: this key cannot access the model metadata. Check model access and key permissions.`
              : response.status === 429
                ? "The account is rate-limited. Check API limits and try again."
                : `Service unavailable (HTTP ${response.status}). Try again shortly.`;
        await response.body?.cancel();
        return { label, ok: response.ok, detail };
      } catch {
        return {
          label,
          ok: false,
          detail:
            "Could not reach OpenAI. Check your connection and try again.",
        };
      }
    }),
  );
}
