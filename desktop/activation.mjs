import path from "node:path";
import { execFile } from "node:child_process";

export function mainWindowLaunch({ executable, root, packaged }) {
  // Always request a new GUI instance: LaunchServices might otherwise reuse a
  // windowless assistant process. The GUI's existing single-instance lock then
  // brings forward an already-open window instead of creating a second one.
  return {
    command: "/usr/bin/open",
    args: [
      "-n",
      path.resolve(path.dirname(executable), "../.."),
      "--args",
      ...(!packaged ? [root] : []),
      "--show-window",
    ],
  };
}

function launchWindow(command) {
  return new Promise((resolve, reject) => {
    execFile(command.command, command.args, { timeout: 10000 }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

export function configureAssistantActivation({
  app,
  headless,
  platform = process.platform,
  executable = process.execPath,
  root,
  packaged = app.isPackaged,
  launch = launchWindow,
  onError = () => console.error("Callwise could not open its window. Open it from Applications."),
}) {
  if (!headless || platform !== "darwin") return () => {};
  // LSUIElement in the signed bundle prevents Dock activation even before JS
  // loads. Keep assistant processes as agents, with no graphics work or window.
  app.setActivationPolicy("accessory");
  app.disableHardwareAcceleration();
  let opening = null;
  const activate = () => {
    if (opening) return;
    opening = Promise.resolve()
      .then(() => launch(mainWindowLaunch({ executable, root, packaged })))
      .catch(onError)
      .finally(() => { opening = null; });
  };
  // This handles an explicit Dock/open action if macOS routes it to an agent.
  // Background agents do not activate themselves during startup.
  app.on("activate", activate);
  return () => app.removeListener("activate", activate);
}

export function promoteMainApplication(app, platform = process.platform) {
  if (platform === "darwin") {
    app.setActivationPolicy("regular");
    return app.dock.show();
  }
}
