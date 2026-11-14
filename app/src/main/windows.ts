import { join } from "node:path";
import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from "electron";
import type { FlyRequest, Point, PrintItem, StuckNote, TypewriterInit } from "../shared/ipc-types";
import type { Store } from "./store";

const page = (name: string) => join(__dirname, "windows", name, `${name}.html`);

function make(opts: BrowserWindowConstructorOptions): BrowserWindow {
  return new BrowserWindow({
    frame: false, transparent: true, resizable: false, hasShadow: false,
    skipTaskbar: true, show: false, backgroundColor: "#00000000",
    ...opts,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true, sandbox: true,
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false,
    },
  });
}

function floatTop(w: BrowserWindow): void {
  w.setAlwaysOnTop(true, "screen-saver");
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function loaded(w: BrowserWindow): Promise<void> {
  return w.webContents.isLoading()
    ? new Promise((r) => w.webContents.once("did-finish-load", () => r()))
    : Promise.resolve();
}

const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed();

export class Windows {
  private typewriter: BrowserWindow | null = null;
  private feeder: BrowserWindow | null = null;
  private panel: BrowserWindow | null = null;
  private fx: BrowserWindow | null = null;
  private notes = new Map<string, BrowserWindow>();
  private flights = new Map<string, () => void>();

  constructor(private store: Store) {}

  // ---- typewriter (sender, bottom of screen) ----
  /** Transparent, click-through overlay over the work area; the renderer draws the mini/full typewriter. */
  private ensureTypewriter(): BrowserWindow {
    if (alive(this.typewriter)) return this.typewriter;
    const work = screen.getPrimaryDisplay().workArea;
    const w = make({ ...work, focusable: true });
    // "floating" (not "screen-saver"): the IME candidate panel must be able to sit above it
    w.setAlwaysOnTop(true, "floating");
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.setIgnoreMouseEvents(true, { forward: true });
    w.on("blur", () => w.webContents.send("typewriter:blur"));
    void w.loadFile(page("typewriter"));
    this.typewriter = w;
    return w;
  }

  typewriterOpen = false;

  /** Show the parked mini typewriter in its corner (app start). */
  async parkTypewriter(init: TypewriterInit): Promise<void> {
    const w = this.ensureTypewriter();
    await loaded(w);
    w.showInactive();
    w.webContents.send("typewriter:init", init);
  }

  async showTypewriter(init: TypewriterInit): Promise<void> {
    const w = this.ensureTypewriter();
    await loaded(w);
    app.focus({ steal: true });
    w.show();
    w.focus();
    this.typewriterOpen = true;
    w.webContents.send("typewriter:show", init);
  }

  /** Ask the renderer to fold the typewriter back into its corner. */
  collapseTypewriter(): void {
    this.typewriter?.webContents.send("typewriter:collapse");
  }

  /** Renderer finished collapsing. */
  typewriterCollapsed(): void {
    this.typewriterOpen = false;
    this.typewriterMouse(true);
  }

  typewriterMouse(ignore: boolean): void {
    if (alive(this.typewriter)) this.typewriter.setIgnoreMouseEvents(ignore, { forward: true });
  }

  // ---- feeder (receiver, top of screen) ----
  private feederBounds() {
    const work = screen.getPrimaryDisplay().workArea;
    const W = Math.min(work.width, 1500);
    const H = Math.round(work.height * 0.85);
    const pos = this.store.data.settings.feedPosition;
    const x = pos === "left" ? work.x : pos === "right" ? work.x + work.width - W : Math.round(work.x + (work.width - W) / 2);
    return { x, y: work.y, width: W, height: H };
  }

  private ensureFeeder(): BrowserWindow {
    if (alive(this.feeder)) return this.feeder;
    const w = make({ ...this.feederBounds(), focusable: false });
    floatTop(w);
    w.setIgnoreMouseEvents(true, { forward: true });
    void w.loadFile(page("feeder"));
    this.feeder = w;
    return w;
  }

  repositionFeeder(): void {
    if (alive(this.feeder)) this.feeder.setBounds(this.feederBounds());
  }

  async print(item: PrintItem): Promise<void> {
    const w = this.ensureFeeder();
    await loaded(w);
    w.showInactive();
    w.webContents.send("feeder:print", item);
  }

  feederMouse(ignore: boolean): void {
    if (alive(this.feeder)) this.feeder.setIgnoreMouseEvents(ignore, { forward: true });
  }

  feederEmpty(): void {
    this.feederMouse(true);
    this.feeder?.hide();
  }

  // ---- stuck notes ----
  createNote(s: StuckNote): void {
    if (![s.x, s.y, s.w, s.h].every(Number.isFinite)) {
      const work = screen.getPrimaryDisplay().workArea;
      s = { ...s, x: work.x + 80, y: work.y + 80, w: Number.isFinite(s.w) ? s.w : 324, h: Number.isFinite(s.h) ? s.h : 260 };
    }
    const w = make({ x: s.x, y: s.y, width: s.w, height: s.h, focusable: true });
    void w.loadFile(page("note"));
    w.webContents.once("did-finish-load", () => {
      w.webContents.send("note:init", s.note);
      w.showInactive();
    });
    this.notes.set(s.note.id, w);
    w.on("closed", () => this.notes.delete(s.note.id));
  }

  moveNote(id: string, x: number, y: number): void {
    const w = this.notes.get(id);
    if (!w || w.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return; // ignore bad drag frames
    try { w.setPosition(Math.round(x), Math.round(y)); } catch (e) { console.warn("moveNote", e); }
  }

  closeNote(id: string): void {
    this.notes.get(id)?.close();
  }

  restoreStuck(): void {
    for (const s of this.store.data.stuck) this.createNote(s);
  }

  // ---- fx overlay (crumpled ball flying to the trash) ----
  fly(from: Point, to: Point): Promise<void> {
    const d = screen.getDisplayNearestPoint(from);
    if (!alive(this.fx)) {
      this.fx = make({ ...d.bounds, focusable: false, enableLargerThanScreen: true });
      floatTop(this.fx);
      this.fx.setIgnoreMouseEvents(true);
      void this.fx.loadFile(page("fx"));
    } else {
      this.fx.setBounds(d.bounds);
    }
    const fx = this.fx;
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      this.flights.set(id, resolve);
      setTimeout(() => this.flightDone(id), 3000); // safety net
      void loaded(fx).then(() => {
        fx.showInactive();
        const req: FlyRequest = { id, from, to, origin: { x: d.bounds.x, y: d.bounds.y } };
        fx.webContents.send("fx:fly", req);
      });
    });
  }

  flightDone(id: string): void {
    const resolve = this.flights.get(id);
    if (!resolve) return;
    this.flights.delete(id);
    resolve();
    if (this.flights.size === 0) this.fx?.hide();
  }

  // ---- panel ----
  showPanel(section?: string): void {
    if (!alive(this.panel)) {
      this.panel = new BrowserWindow({
        width: 460, height: 680, title: "桌面打字机", show: false, resizable: false,
        webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
      });
      void this.panel.loadFile(page("panel"));
      this.panel.once("ready-to-show", () => this.panel?.show());
    } else {
      this.panel.show();
    }
    app.focus({ steal: true });
    this.panel.focus();
    if (section) {
      const p = this.panel;
      void loaded(p).then(() => p.webContents.send("panel:section", section));
    }
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  }
}
