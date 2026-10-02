const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("downloader", {
  paste: () => ipcRenderer.invoke("clipboard-read"),
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  start: options => ipcRenderer.invoke("start-download", options),
  pause: () => ipcRenderer.invoke("pause-download"),
  resume: () => ipcRenderer.invoke("resume-download"),
  cancel: () => ipcRenderer.invoke("cancel-download"),
  getInfo: url => ipcRenderer.invoke("get-video-info", url),
  getHistory: () => ipcRenderer.invoke("get-history"),
  clearHistory: () => ipcRenderer.invoke("clear-history"),
  openFolder: folder => ipcRenderer.invoke("open-folder", folder),
  folderExists: folder => ipcRenderer.invoke("folder-exists", folder),
  onProgress: callback => ipcRenderer.on("download-progress", (_event, value) => callback(value)),
  onStatus: callback => ipcRenderer.on("download-status", (_event, message) => callback(message)),
  onError: callback => ipcRenderer.on("download-error", (_event, message) => callback(message)),
  onPaused: callback => ipcRenderer.on("download-paused", (_event, value) => callback(value)),
  onHistory: callback => ipcRenderer.on("history-updated", (_event, value) => callback(value)),
});
