// Use Electron's explicit audio loopback path. The experimental macOS system
// picker bypasses this handler and can return a video-only stream.
export function installDisplayCapture(session, desktopCapturer, canCapture) {
  session.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!canCapture(request.frame)) return callback({});
    try {
      const screens = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });
      // A session can be paused while macOS is asking for permission.
      if (!canCapture(request.frame)) return callback({});
      callback(screens.length ? { video: screens[0], audio: "loopback" } : {});
    } catch {
      callback({});
    }
  }, { useSystemPicker: false });
}
