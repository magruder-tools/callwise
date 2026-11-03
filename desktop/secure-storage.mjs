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
        "Secure storage is unavailable. Choose Unlock saved data to try again, or quit and reopen Callwise. Your saved files have not been replaced.",
      );
    return storage;
  }
  return Object.freeze({
    isEncryptionAvailable,
    // Only an explicit recovery action calls this; ordinary reads stay latched.
    retryAccess() {
      storage = undefined;
      available = undefined;
      backend = undefined;
      return isEncryptionAvailable();
    },
    get blocked() {
      return available === false;
    },
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
