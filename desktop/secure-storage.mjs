// One storage gate per app process. A denied/locked Keychain must not be
// retried by each settings file, autosave, or assistant request.
export function createSecureStorage(loadStorage) {
  let storage, available, backend;
  function isEncryptionAvailable() {
    if (available !== undefined) return available;
    try {
      storage = loadStorage();
      backend = storage.getSelectedStorageBackend?.();
      available =
        backend !== "basic_text" && storage.isEncryptionAvailable() === true;
    } catch {
      available = false;
    }
    return available;
  }
  function requireStorage() {
    if (!isEncryptionAvailable())
      throw new Error(
        "Secure storage is unavailable. Unlock your keychain, then quit and reopen Callwise to try again. Your saved files have not been replaced.",
      );
    return storage;
  }
  return Object.freeze({
    isEncryptionAvailable,
    getSelectedStorageBackend: () => backend,
    encryptString(value) {
      const ready = requireStorage();
      try {
        return ready.encryptString(value);
      } catch (error) {
        available = false;
        throw error;
      }
    },
    decryptString(value) {
      // A corrupt ciphertext does not mean the Keychain was denied. Keep
      // readable files usable; the caller preserves the unreadable file.
      return requireStorage().decryptString(value);
    },
  });
}
