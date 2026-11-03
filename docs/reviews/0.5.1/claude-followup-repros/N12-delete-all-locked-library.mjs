// Pre-existing (also in 0.5.0): if the library could not be opened at launch (keychain locked, or keychain access
// denied, so main.mjs:112-119 leaves meetingStore null), "Delete all Callwise data" leaves meetings/ in place:
// MeetingService.deleteAll() calls this.store?.reset() (a no-op with no store), and desktop.delete's own file list
// (main.mjs:907-918) doesn't include meetings/. The meetings return once the keychain opens again.
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const R = process.env.CALLWISE_ROOT || process.cwd();
const { MeetingStore } = await import(`${R}/core/meetings/store.mjs`);
const { MeetingService } = await import(`${R}/core/meetings/service.mjs`);
const keychain = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "keychain",
  encryptString: (s) => Buffer.from("x" + s), decryptString: (b) => Buffer.from(b).toString().slice(1) };
const userData = mkdtempSync(path.join(os.tmpdir(), "cw-locked-"));
const first = new MeetingStore(path.join(userData, "meetings"), { storage: keychain });
const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
first.put("meetings", id, id, { title: "Private salary talk", people: [], status: "ended", createdAt: 1 });
first.close();
// Next launch: keychain access is denied, so the key can't be unwrapped (desktop/main.mjs:112-119).
let store = null;
try { store = new MeetingStore(path.join(userData, "meetings"), { storage: { ...keychain, decryptString: () => { throw new Error("denied"); } } }); }
catch (e) { console.log("library at launch:", e.message); }
const meetings = new MeetingService({ store }); // main.mjs:242-250 builds the service even without a store
await meetings.deleteAll(); // desktop.delete, main.mjs:919 (its other unlinks don't touch meetings/)
// 0.5.2: desktop.delete then calls removeUnopenedLibrary() (desktop/meeting-start.mjs).
const start = await import(`${R}/desktop/meeting-start.mjs`).catch(() => ({}));
start.removeUnopenedLibrary?.({ meetings, directory: path.join(userData, "meetings"), open: () => { throw new Error("still locked"); } });
console.log("meetings/ after Delete all:", existsSync(path.join(userData, "meetings")) ? readdirSync(path.join(userData, "meetings")) : "(removed)");
const later = new MeetingStore(path.join(userData, "meetings"), { storage: keychain }); // a later launch with access allowed
console.log("meetings after a later launch:", later.all("meetings").map((m) => m.title));
later.close();
rmSync(userData, { recursive: true, force: true });
