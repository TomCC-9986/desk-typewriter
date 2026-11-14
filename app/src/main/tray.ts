import { Menu, nativeImage, Tray } from "electron";
import type { Hub } from "./hub";
import type { Store } from "./store";
import type { Windows } from "./windows";

/** 32×32 BGRA page icon. Mac: outline only (template). Windows: white page with dark outline. */
export function trayBitmap(filled: boolean): Buffer {
  const S = 32;
  const buf = Buffer.alloc(S * S * 4);
  const set = (x: number, y: number, v: number) => {
    const i = (y * S + x) * 4;
    buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
  };
  for (let y = 3; y <= 28; y++) {
    for (let x = 7; x <= 24; x++) {
      const border = x <= 8 || x >= 23 || y <= 4 || y >= 27;
      const line = (y === 11 || y === 12 || y === 16 || y === 17 || y === 21 || y === 22) && x >= 11 && x <= 20;
      if (border || line) set(x, y, 20);
      else if (filled) set(x, y, 250);
    }
  }
  return buf;
}

export function createTray(hub: Hub, win: Windows, store: Store, openTypewriter: () => void) {
  const mac = process.platform === "darwin";
  const icon = nativeImage.createFromBitmap(trayBitmap(!mac), { width: 32, height: 32, scaleFactor: 2 });
  if (mac) icon.setTemplateImage(true);
  const tray = new Tray(icon);

  /** Same menu for the tray icon and for right-clicking the mini typewriter (the tray can hide behind the notch). */
  const buildMenu = () => {
    const d = store.data;
    return Menu.buildFromTemplate([
      { label: "写纸条", accelerator: d.settings.shortcut, click: openTypewriter },
      { label: hub.online ? "● 在线" : "○ 离线，正在重连…", enabled: false },
      { type: "separator" },
      { label: d.identity ? `我的配对码  ${d.identity.code}` : "设置名字…", click: () => win.showPanel("me") },
      { label: "好友与设置…", click: () => win.showPanel("friends") },
      { label: "历史纸条…", click: () => win.showPanel("history") },
      { label: "勿扰", type: "checkbox", checked: d.settings.dnd, click: (item) => hub.setSettings({ dnd: item.checked }) },
      { type: "separator" },
      { label: "退出", role: "quit" },
    ]);
  };
  const refresh = () => {
    const held = store.data.held.length;
    if (mac) tray.setTitle(held ? ` ${held}` : "");
    tray.setToolTip(`桌面打字机${hub.online ? "" : "（离线）"}${held ? ` · ${held} 张没打印` : ""}`);
    tray.setContextMenu(buildMenu());
  };
  if (!mac) tray.on("click", openTypewriter);
  refresh();
  return { refresh, popup: () => buildMenu().popup() };
}
