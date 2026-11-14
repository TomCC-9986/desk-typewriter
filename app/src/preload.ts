import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desk", {
  invoke: (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args),
  send: (ch: string, ...args: unknown[]) => ipcRenderer.send(ch, ...args),
  on: (ch: string, fn: (...args: unknown[]) => void) => {
    const listener = (_e: unknown, ...a: unknown[]) => fn(...a);
    ipcRenderer.on(ch, listener);
    return () => ipcRenderer.removeListener(ch, listener);
  },
});
