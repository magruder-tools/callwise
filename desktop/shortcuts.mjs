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
  }
  sync(status) {
    const active = status === "running";
    if (active === this.active) return;
    this.active = active; // Error reporting can trigger another state snapshot.
    if (!active) return this.close();
    for (const [name, accelerator] of Object.entries(SESSION_SHORTCUTS)) {
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
  }
  close() {
    for (const accelerator of this.registered)
      this.globalShortcut.unregister(accelerator);
    this.registered.clear();
    this.active = false;
  }
}
