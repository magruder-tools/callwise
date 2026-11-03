export function assertLibraryIdle(meetings, controller) {
  if (
    meetings.archiveOperation ||
    controller.connecting ||
    controller.drainJob ||
    ["running", "paused", "finishing"].includes(controller.engine.status)
  )
    throw new Error(
      "End the meeting and wait for any backup or restore before unlocking saved data.",
    );
}
// Called only by the user's Unlock action. It never retries in a timer or writes a loaded file.
export async function retrySavedData({
  storage,
  meetings,
  controller,
  openStore,
  installStore,
  load,
  apply,
}) {
  assertLibraryIdle(meetings, controller);
  if (meetings.unlocking) throw new Error("An unlock is already in progress.");
  meetings.unlocking = true;
  try {
    if (!storage.retryAccess())
      throw new Error(
        "Saved data is still locked. You can choose Unlock saved data to try again.",
      );
    if (!meetings.store) installStore(openStore());
    const loaded = load();
    apply(loaded);
    // Only caches are cleared; in-memory meetings and unsaved notes remain unsaved.
    meetings.clearCache();
    return { unlocked: true, warnings: loaded.warnings || [] };
  } finally {
    meetings.unlocking = false;
    controller.desktopState = {
      ...controller.desktopState,
      storageBlocked: storage.blocked,
    };
    controller.engine.emitState();
  }
}
