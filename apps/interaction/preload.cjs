const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("interaction", {
  bootstrap: () => ipcRenderer.invoke("interaction:bootstrap"),
  transcribe: (pcm, turnId) =>
    ipcRenderer.invoke("interaction:asr", pcm, turnId),
  speak: (command) => ipcRenderer.invoke("interaction:speak", command),
  cancel: () => ipcRenderer.invoke("interaction:cancel"),
  event: (event) => ipcRenderer.send("interaction:event", event),
  ack: (id) => ipcRenderer.send("interaction:ack", id),
  window: (action, value) =>
    ipcRenderer.invoke("interaction:window", action, value),
  on: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("interaction:push", listener);
    return () => ipcRenderer.removeListener("interaction:push", listener);
  },
});
