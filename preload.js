const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),
  compressVideo: (options) => ipcRenderer.send("compress-video", options),
  cancelCompression: (filePath) => ipcRenderer.send("cancel-compression", filePath),

  // Event listeners
  onProgress: (callback) =>
    ipcRenderer.on("compression-progress", (_, val) => callback(val)),
  onComplete: (callback) =>
    ipcRenderer.on("compression-complete", (_, val) => callback(val)),
  onError: (callback) =>
    ipcRenderer.on("compression-error", (_, val) => callback(val)),
  onCanceled: (callback) =>
    ipcRenderer.on("compression-canceled", () => callback()),
    showItemInFolder: (path) => ipcRenderer.invoke("show-item-in-folder", path),

});
