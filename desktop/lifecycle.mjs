// Window contents can be destroyed before BrowserWindow emits "closed".
export function sendToWindows(windows, name, data) {
  for (const window of windows) {
    if (!window || window.isDestroyed()) continue;
    const contents = window.webContents;
    if (!contents || contents.isDestroyed()) continue;
    try {
      contents.send(name, data);
    } catch (error) {
      if (
        !contents.isDestroyed() &&
        !/Object has been destroyed/i.test(error.message)
      )
        throw error;
    }
  }
}

export function closeOnce(cleanup) {
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    cleanup();
  };
}
