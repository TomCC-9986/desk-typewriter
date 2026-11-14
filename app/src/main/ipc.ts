import { clipboard, ipcMain } from "electron";
import type { Note } from "@shared/protocol";
import type { Point, Settings, StuckNote, TypewriterUi } from "../shared/ipc-types";
import type { Hub } from "./hub";
import type { Store } from "./store";
import type { Windows } from "./windows";

export function registerIpc(hub: Hub, win: Windows, store: Store): void {
  ipcMain.handle("state:get", () => hub.view());
  ipcMain.handle("register", (_e, nickname: string, serverUrl: string) => hub.register(nickname, serverUrl));
  ipcMain.handle("note:send", (_e, p: { to: string; text: string }) => hub.sendNote(p.to, p.text));
  ipcMain.handle("friend:add", (_e, code: string) => hub.addFriend(code));
  ipcMain.handle("lan:add", (_e, id: string) => hub.addLanFriend(id));
  ipcMain.handle("lan:nickname", (_e, name: string) => hub.lanNickname(name));
  ipcMain.handle("settings:set", (_e, patch: Partial<Settings>) => hub.setSettings(patch));
  ipcMain.handle("clipboard:write", (_e, s: string) => clipboard.writeText(s));

  ipcMain.on("friend:respond", (_e, p: { from: string; accepted: boolean }) => hub.respond(p.from, p.accepted));
  ipcMain.on("friend:remove", (_e, id: string) => hub.removeFriend(id));
  ipcMain.on("friend:block", (_e, id: string) => hub.blockFriend(id));
  ipcMain.on("friend:unblock", (_e, id: string) => hub.unblockFriend(id));

  ipcMain.on("typewriter:hide", (_e, p: { draft: string }) => {
    store.update((d) => { d.draft = p.draft; });
    win.typewriterCollapsed();
  });
  ipcMain.on("typewriter:mouse", (_e, ignore: boolean) => win.typewriterMouse(ignore));
  ipcMain.on("typewriter:open", () => void win.showTypewriter(hub.typewriterInit()));
  ipcMain.on("typewriter:ui", (_e, ui: TypewriterUi) => store.update((d) => { d.typewriterUi = ui; }));

  ipcMain.on("feeder:mouse", (_e, ignore: boolean) => win.feederMouse(ignore));
  ipcMain.on("feeder:empty", () => win.feederEmpty());
  ipcMain.on("feeder:detach", (_e, s: StuckNote) => {
    store.update((d) => { d.stuck.push(s); });
    win.createNote(s);
  });
  ipcMain.on("feeder:expired", (_e, p: { note: Note } & Point) => void hub.autoTrash(p.note, { x: p.x, y: p.y }));

  ipcMain.on("note:move", (_e, p: { id: string } & Point) => win.moveNote(p.id, p.x, p.y));
  ipcMain.on("note:moved", (_e, p: { id: string } & Point) => store.update((d) => {
    const s = d.stuck.find((n) => n.note.id === p.id);
    if (s && Number.isFinite(p.x) && Number.isFinite(p.y)) { s.x = Math.round(p.x); s.y = Math.round(p.y); }
  }));
  ipcMain.on("note:close", (_e, id: string) => {
    store.update((d) => { d.stuck = d.stuck.filter((n) => n.note.id !== id); });
    win.closeNote(id);
  });

  ipcMain.on("fx:done", (_e, id: string) => win.flightDone(id));
  ipcMain.on("panel:open", (_e, section?: string) => win.showPanel(section));
}
