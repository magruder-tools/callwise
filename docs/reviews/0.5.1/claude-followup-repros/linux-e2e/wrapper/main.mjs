// Test-only entry: Linux has no macOS keychain, so give safeStorage a reversible stand-in, then load the real app.
import electron from "electron";
const { safeStorage, app } = electron;
const set = (name, fn) => { try { safeStorage[name] = fn; } catch {} if (safeStorage[name] !== fn) Object.defineProperty(safeStorage, name, { value: fn, configurable: true, writable: true }); };
set("isEncryptionAvailable", () => true);
set("getSelectedStorageBackend", () => "gnome_libsecret");
set("encryptString", (s) => Buffer.from("T" + Buffer.from(String(s)).toString("base64")));
set("decryptString", (b) => Buffer.from(Buffer.from(b).toString().slice(1), "base64").toString());
app.setPath("userData", process.env.CALLWISE_TEST_DATA);
await import(`${process.env.CALLWISE_ROOT}/desktop/main.mjs`);
