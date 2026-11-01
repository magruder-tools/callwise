// Electron 44 supports the ScreenCaptureKit backend through this documented
// switch. It uses the existing Screen & System Audio Recording grant; the
// CoreAudio Tap path can instead return a dead track without an error.
export function configureAudioBackend(
  commandLine,
  platform = process.platform,
) {
  if (platform !== "darwin") return;
  const features = new Set(
    commandLine.getSwitchValue("disable-features").split(",").filter(Boolean),
  );
  features.add("MacCatapLoopbackAudioForScreenShare");
  commandLine.appendSwitch("disable-features", [...features].join(","));
}

export function installDisplayCapture(session, desktopCapturer, canCapture) {
  session.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!canCapture(request.frame)) return callback(null);
      try {
        const screens = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 0, height: 0 },
        });
        // A session can be paused while macOS is asking for permission.
        if (!canCapture(request.frame)) return callback(null);
        callback(
          screens.length ? { video: screens[0], audio: "loopback" } : null,
        );
      } catch {
        callback(null);
      }
    },
    { useSystemPicker: false },
  );
}
