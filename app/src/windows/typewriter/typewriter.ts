import type { Friend } from "@shared/protocol";
import { MAX_TEXT } from "@shared/protocol";
import { charWidth, wrapItems } from "../../lib/layout";
import { TypewriterModel } from "../../lib/typewriter-model";
import type { SendResult, TypewriterInit, TypewriterUi } from "../../shared/ipc-types";
import { wait } from "../paper";
import { setSound, setVolume, sfx } from "../sound";
import { COLS, type PaperCell, Typewriter3D } from "./machine3d";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>("input");
const to = $<HTMLSelectElement>("to");
const status = $<HTMLDivElement>("status");
const preeditEl = $<HTMLDivElement>("preedit");

// the stage box (not the full-screen overlay): the 860x680 machine frame plus 300 px of headroom above it for the standing sheet
const machine = new Typewriter3D(860, 980, 300);
$("view").append(machine.canvas);
// ---------- the desk sign shows recipient + status; a paper menu picks the recipient ----------
const menu = $<HTMLDivElement>("menu");
function friendName(): string {
  const o = to.selectedOptions[0];
  return o && o.value ? o.text : "";
}
function redrawSign(): void { machine.drawSign(friendName(), status.textContent ?? ""); }
new MutationObserver(redrawSign).observe(status, { childList: true, characterData: true, subtree: true });
to.addEventListener("change", redrawSign);
function openMenu(x: number, y: number): void {
  menu.replaceChildren();
  const opts = [...to.options].filter((o) => o.value);
  if (!opts.length) {
    const d = document.createElement("div");
    d.textContent = "还没有好友，去添加…";
    d.onclick = () => { closeMenu(); window.desk.send("panel:open", "add"); };
    menu.append(d);
  }
  for (const o of opts) {
    const d = document.createElement("div");
    d.textContent = o.text;
    if (o.value === to.value) d.className = "cur";
    d.onclick = () => { to.value = o.value; to.dispatchEvent(new Event("change")); closeMenu(); input.focus(); };
    menu.append(d);
  }
  const hr = document.createElement("div");
  hr.style.cssText = "height:0;margin:5px 4px;border-top:1px solid currentColor;opacity:.25;pointer-events:none";
  menu.append(hr);
  for (const [label, section] of [["我的配对码…", "me"], ["加好友…", "add"], ["设置…", "settings"]] as const) {
    const d = document.createElement("div");
    d.textContent = label;
    d.onclick = () => { closeMenu(); window.desk.send("panel:open", section); };
    menu.append(d);
  }
  menu.classList.add("on");
  placeMenu(x, y);
  window.desk.send("typewriter:mouse", false);
}
/** Warp the paper menu onto a slip standing beside the desk sign, so it shares the scene's 3D angle. */
function placeMenu(x = 0, y = 0): void {
  menu.style.transform = "none"; menu.style.left = "0px"; menu.style.top = "0px";
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const q = machine.signSlipQuad(w, h);
  if (q.length !== 4) { menu.style.left = `${Math.round(x + 8)}px`; menu.style.top = `${Math.round(y - 10)}px`; return; }
  menu.style.transformOrigin = "0 0";
  menu.style.transform = homography(w, h, q);
}
/** CSS matrix3d mapping the rect (0,0)-(w,h) onto quad q (TL, TR, BR, BL). */
function homography(w: number, h: number, q: { x: number; y: number }[]): string {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det, hh = (dx1 * dy3 - dx3 * dy1) / det;
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + hh * p3.x, c = p0.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + hh * p3.y, f = p0.y;
  // unit square -> quad; pre-scale by 1/w, 1/h
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((v) => +v.toFixed(8)).join(",")})`;
}
function closeMenu(): void { menu.classList.remove("on"); }

let model = new TypewriterModel();
let composing = false;
let busy = false;
const pending: string[] = [];
let pumping = false;
const BELL_AT = COLS - 5;

/** Rows of the current sheet and where the carriage stands (row, width units into the row). */
function layout(): { rows: PaperCell[][]; row: number; col: number } {
  const cells = model.cells.map((c, i) => ({ ...c, i }));
  const rows = wrapItems(cells, (c) => c.ch, COLS);
  const last = rows[rows.length - 1];
  return { rows, row: rows.length - 1, col: last.reduce((u, c) => u + charWidth(c.ch), 0) };
}

function updateCounter(): void {
  const left = MAX_TEXT - model.length;
  if (left <= 20) status.textContent = `还能打 ${left} 字`;
  else if (/^还能打/.test(status.textContent ?? "")) status.textContent = "";
}

function placeInput(): void {
  const p = machine.printPointOnScreen();
  input.style.left = `${Math.round(p.x)}px`;
  input.style.top = `${Math.round(p.y)}px`;
  preeditEl.style.left = `${Math.round(p.x)}px`;
  preeditEl.style.top = `${Math.round(p.y - 26)}px`;
}

let stamped = false;
function enqueue(text: string): void {
  if (stamped) { stamped = false; status.textContent = ""; }
  pending.push(...text);
  void pump();
}

/** One keystroke, in the order a real machine does it. */
async function typeOne(ch: string): Promise<boolean> {
  const before = layout();
  if (!model.type(ch)) return false;
  const after = layout();
  if (ch === "\n") {
    sfx.ratchet();
    await machine.carriageReturn(after.row, 0);
    sfx.thunk();
    return true;
  }
  if (after.row > before.row) { // ran past the margin: the typist throws the carriage first
    sfx.ratchet();
    await machine.carriageReturn(after.row, 0);
    sfx.thunk();
  }
  const colBefore = after.col - charWidth(ch);
  await machine.strike(ch);
  sfx.key(ch);
  machine.drawPaper(after.rows);
  machine.step(after.col);
  if (colBefore < BELL_AT && after.col >= BELL_AT) sfx.ding();
  return true;
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  while (pending.length) {
    const ch = pending.shift()!;
    if (!(await typeOne(ch))) { pending.length = 0; status.textContent = "纸写满了（500 字）"; break; }
    await wait(18);
  }
  updateCounter();
  pumping = false;
}

async function backspace(): Promise<void> {
  const last = model.cells[model.cells.length - 1];
  if (!last || !model.backspace()) return;
  const after = layout();
  machine.drawPaper(after.rows);
  if (last.ch === "\n") {
    // back up to the end of the previous line: platen rolls back a line, carriage to that column
    sfx.ratchet();
    await machine.carriageReturn(after.row, after.col);
  } else {
    machine.step(after.col);       // carriage steps back one space; the letter is gone
    sfx.soft();
  }
  updateCounter();
}

function flushInput(): void {
  if (composing) return;
  const v = input.value;
  input.value = "";
  if (v) enqueue(v.replace(/\r/g, ""));
}

input.addEventListener("compositionstart", () => { composing = true; });
input.addEventListener("compositionupdate", (e) => {
  preeditEl.textContent = e.data ?? "";
  preeditEl.classList.toggle("on", !!e.data);
});
input.addEventListener("compositionend", () => {
  composing = false;
  preeditEl.classList.remove("on");
  flushInput();
});
input.addEventListener("input", (e) => { if (!(e as InputEvent).isComposing) flushInput(); });

input.addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) {
    // IME is composing (pinyin): still press the physical key on the machine, letter by letter
    const m = /^Key([A-Z])$/.exec(e.code) ?? /^Digit([0-9])$/.exec(e.code);
    if (m && !e.repeat) { machine.pressKey(m[1]); sfx.key(m[1].toLowerCase()); }
    return;
  }
  if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); enqueue("\n"); return; }
  if (e.key === "Enter") { e.preventDefault(); void send(); return; }
  if (e.key === "Backspace") {
    e.preventDefault();
    if (pending.length) pending.pop();
    else if (!pumping) void backspace();
    return;
  }
  if (e.key === "Escape") { e.preventDefault(); void hide(); }
});

document.addEventListener("mousedown", (e) => {
  if (e.target !== to) setTimeout(() => input.focus(), 0);
});

const REASONS: Record<string, string> = {
  offline: "没连上服务器，草稿已保留",
  not_nearby: "对方不在同一个局域网里，草稿已保留",
  not_friends: "对方还没同意你的局域网好友请求",
  not_friend: "对方还不是你的好友",
  rate_limited: "太快啦，一分钟最多 10 张",
  too_long: "超过 500 字了",
  empty: "纸上还没有字",
  bad_id: "纸条编号出错了，再寄一次",
  inbox_full: "对方的信箱满了",
  server_error: "服务器出错了，稍后再试",
  bad_message: "纸条格式不对",
};

async function send(): Promise<void> {
  if (busy || pumping) return;
  const text = model.text();
  if (!text.trim()) { status.textContent = "纸上还没有字"; return; }
  if (!to.value) { status.textContent = "先选一个好友"; return; }
  busy = true;
  status.textContent = "寄出中…";
  const res = await window.desk.invoke<SendResult>("note:send", { to: to.value, text });
  if (res.state === "delivered" || res.state === "queued") {
    sfx.ratchet();
    await machine.pullOut();
    sfx.tear();
    status.textContent = res.state === "delivered" ? "已送达 ✓" : "对方离线，上线后打印";
    setTimeout(() => (res.state === "delivered" ? sfx.delivered() : sfx.queued()), 350);
    model.clear();
    machine.drawPaper([]);
    machine.feedNewSheet();
    updateCounter();
    // stay open with a fresh sheet so the next note can be typed right away (Esc / click away to close)
    busy = false;
    input.focus();
    // the stamp stays on the envelope until the next note is started (see enqueue)
    stamped = true;
  } else {
    status.textContent = REASONS[res.reason ?? res.state] ?? "没寄出去";
    busy = false;
  }
}

// ---------- open / park / drag ----------
const box = $<HTMLDivElement>("box");
const MINI = 0.2, BOX_W = 860, HEAD = 300, FRAME_H = 680, BOX_H = FRAME_H + HEAD, MARGIN = 14;
let ui: TypewriterUi = { corner: "right", pos: null };
let open = false;

function layoutBox(): void {
  const W = window.innerWidth, H = window.innerHeight;
  const pos = ui.pos ?? { x: (W - BOX_W) / 2, y: H - FRAME_H };   // ui.pos = top-left of the machine frame
  box.style.setProperty("--x", `${Math.round(Math.min(Math.max(pos.x, -200), W - BOX_W + 200))}px`);
  // the machine (not the canvas) may touch the bottom of the screen
  box.style.setProperty("--y", `${Math.round(Math.min(Math.max(pos.y, -300), H - FRAME_H + machine.bottomGap()) - HEAD)}px`);
  // parked: scaled about the bottom centre, sitting in the chosen bottom corner
  const visW = BOX_W * MINI;
  const visLeft = ui.corner === "left" ? MARGIN : W - MARGIN - visW;
  box.style.setProperty("--mx", `${Math.round(visLeft - (BOX_W - visW) / 2)}px`);
  box.style.setProperty("--my", `${Math.round(H - BOX_H - 6)}px`);
}
window.addEventListener("resize", layoutBox);

/** The part of the stage that should catch the mouse (the machine, not the empty air above it). */
function hitRect(): DOMRect {
  const b = box.getBoundingClientRect();
  const r = new DOMRect(b.left, b.top + b.height * HEAD / BOX_H, b.width, b.height * FRAME_H / BOX_H);   // the machine frame
  return open ? new DOMRect(r.left + r.width * 0.06, r.top + r.height * 0.36, r.width * 0.88, r.height * 0.64)
              : new DOMRect(r.left + r.width * 0.15, r.top + r.height * 0.42, r.width * 0.7, r.height * 0.58);
}
const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
let catching = false;
document.addEventListener("mousemove", (e) => {
  if (dragging) return;
  const want = inside(hitRect(), e.clientX, e.clientY) || (open && inside(machine.signRect(), e.clientX, e.clientY))
    || (menu.classList.contains("on") && inside(menu.getBoundingClientRect(), e.clientX, e.clientY));
  if (want !== catching) { catching = want; window.desk.send("typewriter:mouse", !want); }
});

let dragging = false;
box.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (open && machine.hitSign(e.clientX, e.clientY)) { openMenu(e.clientX, e.clientY); return; }
  // clicking a key on the machine types it, like pressing it with a finger
  if (open) {
    const k = machine.keyAt(e.clientX, e.clientY);
    const ch = k === "space" ? " " : k && k.length === 1 ? k.toLowerCase() : null;
    if (ch !== null) { enqueue(ch); setTimeout(() => input.focus(), 0); return; }
  }
  closeMenu();
  if (!inside(hitRect(), e.clientX, e.clientY)) return;
  const sx = e.clientX, sy = e.clientY;
  const r0 = box.getBoundingClientRect();
  let moved = false;
  box.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    if (!moved) { moved = true; dragging = true; document.body.classList.add("dragging"); }
    if (open) {
      ui.pos = { x: r0.left + dx, y: r0.top + HEAD + dy };
      layoutBox();
    } else {
      const visW = BOX_W * MINI;
      box.style.setProperty("--mx", `${Math.round(r0.left + dx + (r0.width - visW) / 2 - (BOX_W - visW) / 2)}px`);
      box.style.setProperty("--my", `${Math.round(r0.top + dy - (BOX_H * (1 - MINI)))}px`);
    }
  };
  const up = (ev: PointerEvent) => {
    box.removeEventListener("pointermove", move);
    box.removeEventListener("pointerup", up);
    document.body.classList.remove("dragging");
    dragging = false;
    if (!moved) { if (!open) window.desk.send("typewriter:open"); return; }
    if (!open) ui.corner = ev.clientX < window.innerWidth / 2 ? "left" : "right"; // snap to the nearer bottom corner
    layoutBox();
    window.desk.send("typewriter:ui", ui);
    setTimeout(placeInput, 560);
  };
  box.addEventListener("pointermove", move);
  box.addEventListener("pointerup", up);
});

// ---------- turning the machine: right-drag, two-finger swipe / shift+wheel, double right-click resets ----------
let saveTimer = 0;
function setPitch(p: number): void {
  ui.pitch = machine.setPitch(p);
  layoutBox();
  placeInput();
  if (menu.classList.contains("on")) placeMenu();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => window.desk.send("typewriter:ui", ui), 300);
}
function setYaw(y: number): void {
  ui.yaw = machine.setYaw(y);
  if (menu.classList.contains("on")) placeMenu();
  layoutBox();
  placeInput();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => window.desk.send("typewriter:ui", ui), 300);
}
box.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  // parked mini typewriter: right-click shows the app menu (pairing code, friends, settings, quit)
  if (!open && inside(hitRect(), e.clientX, e.clientY)) window.desk.send("typewriter:menu");
});
let lastRight = 0;
box.addEventListener("pointerdown", (e) => {
  if (e.button !== 2 || !open || !inside(hitRect(), e.clientX, e.clientY)) return;
  const now = performance.now();
  if (now - lastRight < 350) { setYaw(0); setPitch(0); lastRight = 0; return; }
  lastRight = now;
  const sx = e.clientX, sy = e.clientY, y0 = ui.yaw ?? 0, p0 = ui.pitch ?? 0;
  box.setPointerCapture(e.pointerId);
  dragging = true;
  const move = (ev: PointerEvent) => { setYaw(y0 + (ev.clientX - sx) * 0.006); setPitch(p0 + (ev.clientY - sy) * 0.005); };
  const up = () => {
    box.removeEventListener("pointermove", move);
    box.removeEventListener("pointerup", up);
    dragging = false;
  };
  box.addEventListener("pointermove", move);
  box.addEventListener("pointerup", up);
});
box.addEventListener("wheel", (e) => {
  if (!open || !inside(hitRect(), e.clientX, e.clientY)) return;
  e.preventDefault();
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) setYaw((ui.yaw ?? 0) + (e.shiftKey ? e.deltaY : e.deltaX) * 0.004);
  else setPitch((ui.pitch ?? 0) + e.deltaY * 0.003);   // two-finger up/down tilts the view
}, { passive: false });

async function hide(): Promise<void> {
  if (busy || !open) return;
  open = false;
  closeMenu();
  document.body.classList.add("mini");
  preeditEl.classList.remove("on");
  input.blur();
  window.desk.send("typewriter:hide", { draft: model.text() });
  await wait(620);
  if (!open) machine.stop();
}

function fillFriends(friends: Friend[], lastTo: string | null): void {
  status.classList.remove("link");
  status.onclick = null;
  if (!friends.length) {
    to.replaceChildren(new Option("还没有好友", ""));
    redrawSign();
    status.textContent = "点这里去加好友";
    status.classList.add("link");
    status.onclick = () => window.desk.send("panel:open", "add");
    return;
  }
  const sorted = [...friends].sort((a, b) => (a.userId === lastTo ? -1 : b.userId === lastTo ? 1 : 0));
  to.replaceChildren(...sorted.map((f) => new Option(f.nickname, f.userId)));
  redrawSign();
}

function applyInit(init: TypewriterInit): void {
  setVolume(init.volume);
  setSound(init.sound);
  ui = { ...init.ui };
  machine.setYaw(ui.yaw ?? 0);
  machine.setPitch(ui.pitch ?? 0);
  layoutBox();
  fillFriends(init.friends, init.lastTo);
  if (init.friends.length) status.textContent = init.online ? "" : "离线中，连上后才能寄";
  if (!busy) {
    model = new TypewriterModel(init.draft);
    const l = layout();
    machine.drawPaper(l.rows);
    machine.setPosition(l.row, l.col);
    updateCounter();
  }
}

// parked at app start: render one still frame of the machine for the mini icon
window.desk.on("typewriter:init", (init: TypewriterInit) => {
  applyInit(init);
  machine.start();
  void machine.ready.then(() => setTimeout(() => { if (!open) machine.stop(); }, 400));
});
window.desk.on("typewriter:show", (init: TypewriterInit) => {
  applyInit(init);
  open = true;
  machine.start();
  requestAnimationFrame(() => document.body.classList.remove("mini"));
  window.desk.send("typewriter:mouse", false);
  catching = true;
  setTimeout(placeInput, 580);
  input.focus();
});
window.desk.on("typewriter:collapse", () => void hide());
window.desk.on("typewriter:blur", () => void hide());
