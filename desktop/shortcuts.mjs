export const SESSION_SHORTCUTS = Object.freeze({
  help: "Control+Alt+Space",
  pause: "Control+Alt+P",
  previous: "Control+Alt+[",
  next: "Control+Alt+]",
  visibility: "Control+Alt+H",
});

export class SessionShortcuts {
  constructor(
    globalShortcut,
    actions,
    onFailure = () => {},
    onSuccess = () => {},
  ) {
    Object.assign(this, { globalShortcut, actions, onFailure, onSuccess });
    this.registered = new Set();
    this.active = false;
    this.shortcuts = { ...SESSION_SHORTCUTS };
  }
  configure(hotkeys = {}) {
    const next = { ...SESSION_SHORTCUTS, ...hotkeys };
    if (JSON.stringify(next) !== JSON.stringify(this.shortcuts)) {
      this.close();
      this.shortcuts = next;
    }
  }
  sync(status) {
    if (this.syncing) return;
    const active = ["running", "paused"].includes(status);
    if (active === this.active && status === this.status) return;
    if (this.active) this.close();
    this.status = status;
    this.active = active; // Error reporting can trigger another state snapshot.
    if (!active) return this.close();
    this.syncing = true;
    for (const [name, accelerator] of Object.entries(this.shortcuts)) {
      if (
        status === "paused" &&
        !["help", "pause", "visibility"].includes(name)
      )
        continue;
      let registered = false;
      try {
        registered = this.globalShortcut.register(
          accelerator,
          this.actions[name],
        );
      } catch {
        /* Report below. */
      }
      if (registered) {
        this.registered.add(accelerator);
        this.onSuccess(accelerator);
      } else this.onFailure(accelerator);
    }
    this.syncing = false;
  }
  close() {
    for (const accelerator of this.registered)
      this.globalShortcut.unregister(accelerator);
    this.registered.clear();
    this.active = false;
  }
}
