const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("callwise", {
  desktop: true,
  command: (name, payload = {}) =>
    ipcRenderer.invoke("callwise:command", name, payload),
  audio: (channel, buffer) =>
    ipcRenderer.send("callwise:audio", channel, buffer),
  captureStatus: (channel, status) =>
    ipcRenderer.send("callwise:capture-status", channel, status),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("callwise:state", listener);
    return () => ipcRenderer.removeListener("callwise:state", listener);
  },
  onStopCapture: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("callwise:stop-capture", listener);
    return () => ipcRenderer.removeListener("callwise:stop-capture", listener);
  },
});
