const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("callwise", {
  desktop: true,
  filePath: (file) => webUtils.getPathForFile(file),
  meter: (channel, rms) => ipcRenderer.send("callwise:meter", channel, rms),
  onMeters: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("callwise:meters", listener);
    return () => ipcRenderer.removeListener("callwise:meters", listener);
  },
  command: async (name, payload = {}) => {
    try {
      return await ipcRenderer.invoke("callwise:command", name, payload);
    } catch (error) {
      throw new Error(
        error.message.replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          "",
        ),
      );
    }
  },
  audio: (channel, buffer) =>
    ipcRenderer.send("callwise:audio", channel, buffer),
  captureStatus: (channel, status) =>
    ipcRenderer.send("callwise:capture-status", channel, status),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("callwise:state", listener);
    return () => ipcRenderer.removeListener("callwise:state", listener);
  },
  onNavigate: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("callwise:navigate", listener);
    return () => ipcRenderer.removeListener("callwise:navigate", listener);
  },
  onStopCapture: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("callwise:stop-capture", listener);
    return () => ipcRenderer.removeListener("callwise:stop-capture", listener);
  },
});
