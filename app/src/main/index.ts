import { join } from "node:path";
import { app, globalShortcut, ipcMain, powerMonitor } from "electron";
import { Hub } from "./hub";
import { registerIpc } from "./ipc";
import { Store } from "./store";
import { createTray } from "./tray";
import { Windows } from "./windows";

const profile = process.env.DESK_PROFILE;
if (profile) app.setPath("userData", join(app.getPath("appData"), `desk-typewriter-${profile}`));
else if (!app.requestSingleInstanceLock()) app.quit();

app.on("window-all-closed", () => { /* stay alive in the tray */ });

// a bug in one handler must never pop an "Uncaught Exception" dialog in front of the user
process.on("uncaughtException", (e) => console.error("uncaught", e));
process.on("unhandledRejection", (e) => console.error("unhandled", e));

void app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.hide();
  const store = new Store(app.getPath("userData"));
  const win = new Windows(store);
  const hub = new Hub(store, win);
  const openTypewriter = () => {
    if (win.typewriterOpen) win.collapseTypewriter();
    else void win.showTypewriter(hub.typewriterInit());
  };
  const tray = createTray(hub, win, store, openTypewriter);
  hub.onTray = () => tray.refresh();
  registerIpc(hub, win, store);
  ipcMain.on("typewriter:menu", () => tray.popup());

  if (!globalShortcut.register(store.data.settings.shortcut, openTypewriter)) {
    console.warn(`shortcut ${store.data.settings.shortcut} is taken`);
  }
  app.on("will-quit", () => { globalShortcut.unregisterAll(); hub.stop(); });

  hub.start();
  powerMonitor.on("resume", () => hub.reconnect());
  powerMonitor.on("unlock-screen", () => hub.reconnect());
  win.restoreStuck();
  void win.parkTypewriter(hub.typewriterInit()); // mini typewriter in its corner
  if (!store.data.identity) win.showPanel("me");
});
