/**
 * The product page's live typewriter: the app's own 3D machine (app/src/windows/typewriter/machine3d.ts) pinned to the
 * viewport while the story scrolls past. Each chapter has a pose (angle + where the machine sits on screen) and an
 * action: it types 你好 by itself, sends the sheet, a note prints on "the friend's screen", sounds can be switched.
 * Visitors can type on it with their own keyboard at any time.
 */
import { MAX_TEXT } from "@shared/protocol";
import { charWidth, wrap, wrapItems } from "../../app/src/lib/layout";
import { addTornEdge, charSpan, COLS as NOTE_COLS, signature } from "../../app/src/windows/paper";
import { TypewriterModel } from "../../app/src/lib/typewriter-model";
import { setSound, setVolume, sfx, SOUND_PACKS, type SoundPack } from "../../app/src/windows/sound";
import { COLS, type PaperCell, Typewriter3D } from "../../app/src/windows/typewriter/machine3d";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLDivElement>("stage");
const story = $<HTMLDivElement>("story");
const input = $<HTMLTextAreaElement>("tw-input");
const preedit = $<HTMLDivElement>("tw-preedit");
const toast = $<HTMLDivElement>("tw-toast");
const loading = $<HTMLDivElement>("tw-loading");
const chapters = [...document.querySelectorAll<HTMLElement>(".chap")];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (t: number) => t * t * (3 - 2 * t);

// pinyin keys pressed before each character appears (the page fakes an IME while it types by itself)
const PINYIN: Record<string, string> = {
  你: "ni", 好: "hao", 今: "jin", 天: "tian", 也: "ye", 辛: "xin", 苦: "ku", 了: "le", 周: "zhou", 末: "mo", 见: "jian",
  早: "zao", 安: "an", 吃: "chi", 饭: "fan", 吗: "ma", 一: "yi", 起: "qi",
};
const PHRASES_ZH = ["你好，\n今天也辛苦了。", "早安，\n一起吃饭吗？", "Hello, old friend.", "周末见。"];
const PHRASES_EN = ["Hello,\nhope today was kind.", "Morning!\nLunch together?", "Hello, old friend.", "See you Sunday."];

// ---------------- language: the page holds both, <html lang> (set by the 中/EN switch) picks one
const isEn = () => document.documentElement.lang === "en";
const tr = (zh: string, en: string) => (isEn() ? en : zh);
const phrases = () => (isEn() ? PHRASES_EN : PHRASES_ZH);
const SOUND_EN: Record<string, string> = { typewriter: "Typewriter", music: "Piano", drop: "Water drops", chime: "Wind chime", marimba: "Marimba", rain: "Rain", leaves: "Leaves", fire: "Campfire" };
let loadPct = 0;
const loadLabel = () => { loading.dataset.label = tr(`3D 打字机加载中 ${loadPct}%`, `Loading the 3D typewriter ${loadPct}%`); };

/** Where the machine stands in each chapter: angles, and its box on screen as fractions of the viewport. */
interface Pose { yaw: number; pitch: number; cx: number; cy: number; h: number }
const POSES_WIDE: Pose[] = [
  { yaw: -0.2, pitch: 0.02, cx: 0.5, cy: 0.69, h: 0.42 },   // hero: under the headline
  { yaw: -0.06, pitch: 0.3, cx: 0.68, cy: 0.56, h: 0.46 },  // 敲下: from above, keys close
  { yaw: 0.28, pitch: 0.0, cx: 0.67, cy: 0.6, h: 0.48 },    // 寄出: the sheet rolls out
  { yaw: -0.5, pitch: 0.06, cx: 0.3, cy: 0.62, h: 0.42 },   // 收到: machine left, note prints on the right
  { yaw: 0.72, pitch: 0.12, cx: 0.68, cy: 0.58, h: 0.46 },  // 附近
  { yaw: -0.62, pitch: 0.2, cx: 0.3, cy: 0.58, h: 0.44 },  // 声音
];
const POSES_NARROW: Pose[] = POSES_WIDE.map((p, i) => ({ ...p, cx: 0.5, cy: i === 3 ? 0.5 : i ? 0.7 : 0.72, h: i === 3 ? 0.24 : i ? 0.3 : 0.28 }));   // ch.3: text sits below on phones

async function fetchModel(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`model ${r.status}`);
  const total = Number(r.headers.get("content-length")) || 1_820_000;
  const reader = r.body.getReader(); const chunks: Uint8Array[] = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.length;
    const p = Math.min(1, got / total);
    loading.style.setProperty("--p", String(p));
    loadPct = Math.round(p * 100); loadLabel();
  }
  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "model/gltf-binary" }));
}

async function main(): Promise<void> {
  loadLabel(); addEventListener("langchange", loadLabel);
  const modelUrl = await fetchModel("/assets/typewriter.glb");
  const machine = new Typewriter3D(stage.clientWidth, stage.clientHeight, 0, modelUrl);
  machine.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
  machine.canvas.classList.add("tw-canvas");
  stage.prepend(machine.canvas);
  machine.showSign(false); machine.studioShadow();
  await machine.ready;
  (window as unknown as { __tw: unknown }).__tw = machine;

  // ---------------- framing: precompute zoom / lift / shift for every pose at this viewport size
  let frames: { zoom: number; lift: number; shiftX: number }[] = [];
  let poses = POSES_WIDE;
  let userYaw = 0, userPitch = 0;
  const fit = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    machine.resize(w, h, 0);
    poses = w < 820 ? POSES_NARROW : POSES_WIDE;
    // hero: the machine lives in the space between the buttons and the bottom of the screen, with air on both sides
    const cta = document.querySelector<HTMLElement>(".hero-chap .cta");
    const top = cta ? cta.getBoundingClientRect().bottom - stage.getBoundingClientRect().top + 56 : h * 0.5;
    const room = Math.max(120, h - 44 - top);
    frames = poses.map((p, i) => {
      machine.setYaw(p.yaw); machine.setPitch(p.pitch);
      machine.zoom = 1; machine.lift = 0; machine.shiftX = 0; machine.reframe();
      if (i === 0) machine.frameTo(p.cx * w, top + Math.min(room, p.h * h) / 2, Math.min(room, p.h * h));
      else machine.frameTo(p.cx * w, p.cy * h, p.h * h);
      return { zoom: machine.zoom, lift: machine.lift, shiftX: machine.shiftX };
    });
    apply();
  };
  /** story progress in chapters (0 .. n-1) from the scroll position */
  const progress = () => {
    const r = story.getBoundingClientRect(), span = r.height - innerHeight;
    return Math.max(0, Math.min(chapters.length - 1, (-r.top / Math.max(1, span)) * (chapters.length - 1)));
  };
  let shown = -1, actT = 0;
  function apply(): void {
    if (!frames.length) return;
    const p = progress(), i = Math.min(poses.length - 2, Math.floor(p)), t = ease(Math.min(1, Math.max(0, (p - i - 0.18) / 0.64)));
    const a = poses[i], b = poses[i + 1], fa = frames[i], fb = frames[i + 1];
    const mix = (x: number, y: number) => x + (y - x) * t;
    machine.setYaw(mix(a.yaw, b.yaw) + userYaw); machine.setPitch(mix(a.pitch, b.pitch) + userPitch);
    machine.zoom = mix(fa.zoom, fb.zoom); machine.lift = mix(fa.lift, fb.lift); machine.shiftX = mix(fa.shiftX, fb.shiftX);
    machine.reframe();
    // chapter copy cross-fades with the scroll position
    chapters.forEach((c, k) => {
      const d = Math.abs(p - k), o = Math.max(0, Math.min(1, 1.6 - d * 3.2));
      c.style.setProperty("--o", o.toFixed(3)); c.style.setProperty("--dy", `${((k - p) * 26).toFixed(1)}px`);
    });
    const cur = Math.round(p);
    if (cur !== shown) {
      shown = cur;
      chapters.forEach((c, k) => c.classList.toggle("on", k === cur));
      // run the chapter's action only once the scroll has settled there (a fast jump must not fire every chapter on the way)
      clearTimeout(actT); actT = window.setTimeout(() => { if (shown === cur) void onChapter(cur); }, 420);
    }
    placeInput();
  }

  // ---------------- typing (same order of events as the app)
  setVolume(0.55); setSound({ soundPack: "typewriter", ambient: true });
  let model = new TypewriterModel(), composing = false, busy = false, pumping = false, autoTyping = false;
  let lastSent = "";
  const pending: string[] = [];
  const BELL_AT = COLS - 5;
  const layout = (): { rows: PaperCell[][]; row: number; col: number } => {
    const rows = wrapItems(model.cells.map((c, i) => ({ ...c, i })), (c) => c.ch, COLS);
    const last = rows[rows.length - 1];
    return { rows, row: rows.length - 1, col: last.reduce((u, c) => u + charWidth(c.ch), 0) };
  };
  function placeInput(): void {
    const p = machine.printPointOnScreen(), r = stage.getBoundingClientRect();
    input.style.left = `${Math.round(p.x - r.left)}px`; input.style.top = `${Math.round(p.y - r.top)}px`;
    preedit.style.left = `${Math.round(p.x - r.left)}px`; preedit.style.top = `${Math.round(p.y - r.top - 34)}px`;
  }
  let toastT = 0;
  const say = (t: string, ms = 2600) => { toast.textContent = t; toast.classList.add("on"); clearTimeout(toastT); toastT = window.setTimeout(() => toast.classList.remove("on"), ms); };

  async function typeOne(ch: string): Promise<boolean> {
    const before = layout();
    if (!model.type(ch)) return false;
    const after = layout();
    if (ch === "\n") { sfx.ratchet(); await machine.carriageReturn(after.row, 0); sfx.thunk(); return true; }
    if (after.row > before.row) { sfx.ratchet(); await machine.carriageReturn(after.row, 0); sfx.thunk(); }
    const colBefore = after.col - charWidth(ch);
    await machine.strike(ch);
    sfx.key(ch);
    machine.drawPaper(after.rows);
    machine.step(after.col);
    if (colBefore < BELL_AT && after.col >= BELL_AT) sfx.ding();
    return true;
  }
  async function pump(): Promise<void> {
    if (pumping) return; pumping = true;
    while (pending.length) { if (!(await typeOne(pending.shift()!))) { pending.length = 0; say(tr(`一张纸最多 ${MAX_TEXT} 字`, `A sheet holds ${MAX_TEXT} characters at most`)); break; } await wait(18); }
    pumping = false; placeInput();
  }
  const enqueue = (t: string) => { pending.push(...t); void pump(); };
  /** type a phrase by itself, pressing the pinyin keys before each Chinese character */
  async function autoType(text: string): Promise<void> {
    if (autoTyping) return; autoTyping = true;
    for (const ch of text) {
      const py = PINYIN[ch];
      if (py) for (const k of py) { machine.pressKey(k.toUpperCase()); sfx.key(k); await wait(85 + Math.random() * 40); }
      enqueue(ch);
      while (pumping) await wait(20);
      await wait(ch === "\n" ? 260 : 70 + Math.random() * 70);
    }
    autoTyping = false;
  }
  async function backspace(): Promise<void> {
    const last = model.cells[model.cells.length - 1];
    if (!last || !model.backspace()) return;
    const after = layout(); machine.drawPaper(after.rows);
    if (last.ch === "\n") { sfx.ratchet(); await machine.carriageReturn(after.row, after.col); }
    else { machine.step(after.col); sfx.soft(); }
  }
  async function send(quiet = false): Promise<boolean> {
    if (busy) return false;
    while (pumping || autoTyping) await wait(40);
    if (!model.text().trim()) { if (!quiet) say(tr("先敲几个字", "Type a few words first")); return false; }
    busy = true;
    lastSent = model.text();
    sfx.ratchet(); await machine.pullOut(); sfx.tear();
    if (!quiet) say(tr("寄出啦。装上桌面打字机，它会从朋友的屏幕顶上打印出来。", "Sent! With Desk Typewriter installed, it prints down from the top of your friend's screen."), 4000);
    model = new TypewriterModel(); machine.drawPaper([]); machine.feedNewSheet();
    busy = false; placeInput();
    return true;
  }

  // ---------------- what each chapter does when it comes on screen
  const recv = $<HTMLDivElement>("recv");
  let recvRun = 0;
  /** The note exactly as the app's receiver prints it (same markup and helpers as windows/feeder). */
  async function printNote(text: string): Promise<void> {
    const run = ++recvRun;
    recv.replaceChildren();
    const paper = document.createElement("div"); paper.className = "paper";
    const lines = document.createElement("div"); lines.className = "lines"; paper.append(lines);
    recv.append(paper);
    const rows = wrap(text, NOTE_COLS);
    paper.style.setProperty("--rows", "0");
    recv.classList.add("on");
    await wait(500);
    let i = 0;
    for (let r = 0; r < rows.length; r++) {
      if (run !== recvRun) return;
      const row = document.createElement("div"); row.className = "line"; lines.append(row);
      paper.style.setProperty("--rows", String(r + 1)); sfx.feed(); await wait(170);
      for (const ch of rows[r]) { if (run !== recvRun) return; row.append(charSpan(ch, i++)); sfx.recv(ch); await wait(60 + Math.random() * 30); }
      await wait(110);
    }
    const sig = document.createElement("div"); sig.className = "line sig";
    sig.textContent = signature({ id: "web", from: "web", fromName: tr("小满", "Mia"), text, sentAt: Date.now() });
    lines.append(sig); paper.style.setProperty("--rows", String(rows.length + 1)); sfx.feed();
    await wait(300);
    paper.style.setProperty("--extra", "14px"); addTornEdge(paper); sfx.tear();
  }
  async function onChapter(i: number): Promise<void> {
    if (i !== 3) { recvRun++; recv.classList.remove("on"); }
    if (i === 1 && !model.text().trim() && !autoTyping) void autoType(phrases()[0]);
    if (i === 2 && (model.text().trim() || autoTyping)) await send(true);
    if (i === 3) void printNote(lastSent || phrases()[0]);
  }

  machine.start();
  requestAnimationFrame(() => { fit(); document.body.classList.add("tw-ready"); });
  let queued = false;   // one update per frame, however many scroll events arrive
  addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; apply(); }); } }, { passive: true });
  new ResizeObserver(() => fit()).observe(stage);

  // ---------------- keyboard: a hidden textarea at the printing point takes keys and IME text
  const focus = () => { input.focus({ preventScroll: true }); };
  input.addEventListener("compositionstart", () => { composing = true; preedit.classList.add("on"); });
  input.addEventListener("compositionupdate", (e) => { preedit.textContent = (e as CompositionEvent).data; });
  input.addEventListener("compositionend", () => { composing = false; preedit.classList.remove("on"); preedit.textContent = ""; flush(); });
  const flush = () => { const v = input.value; input.value = ""; if (v) enqueue(v.replace(/\r/g, "")); };
  input.addEventListener("input", (e) => { if (!(e as InputEvent).isComposing && !composing) flush(); });
  input.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) {
      const m = /^Key([A-Z])$/.exec(e.code) ?? /^Digit([0-9])$/.exec(e.code);
      if (m && !e.repeat) { machine.pressKey(m[1]); sfx.key(m[1].toLowerCase()); }
      return;
    }
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); enqueue("\n"); return; }
    if (e.key === "Enter") { e.preventDefault(); void send(); return; }
    if (e.key === "Backspace") { e.preventDefault(); void backspace(); return; }
    if (e.key === "Escape") { input.blur(); return; }
  });
  window.addEventListener("keydown", (e) => {
    if (document.activeElement === input || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === " " || e.key.startsWith("Arrow") || e.key.startsWith("Page")) return;   // keep scrolling keys
    const r = story.getBoundingClientRect(); if (r.bottom < innerHeight * 0.5) return;   // only while the machine is on screen
    if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace") focus();
  }, true);

  // ---------------- pointer: click a key to type it; drag to turn the machine
  let drag: { x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("a,button")) return;
    drag = { x: e.clientX, y: e.clientY, yaw: userYaw, pitch: userPitch, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true; stage.classList.add("dragging");
    userYaw = Math.max(-0.8, Math.min(0.8, drag.yaw + dx * 0.005)); userPitch = Math.max(-0.25, Math.min(0.35, drag.pitch + dy * 0.004));
    apply();
  });
  stage.addEventListener("pointerup", (e) => {
    const d = drag; drag = null; stage.classList.remove("dragging");
    if (d && !d.moved) {
      const k = machine.keyAt(e.clientX, e.clientY);
      const ch = k === "space" ? " " : k && k.length === 1 ? k.toLowerCase() : null;
      if (ch) enqueue(ch);
      focus();
    }
  });
  stage.addEventListener("dblclick", () => { userYaw = 0; userPitch = 0; apply(); });

  // ---------------- buttons in the chapters
  let pi = 0;
  document.querySelectorAll<HTMLButtonElement>("[data-act=type]").forEach((b) => b.addEventListener("click", () => {
    if (autoTyping) return;
    void (async () => { if (model.text().trim()) await send(true); pi = (pi + 1) % phrases().length; await autoType(phrases()[pi]); })();
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-act=send]").forEach((b) => b.addEventListener("click", () => { void send(); }));
  const sounds = $<HTMLDivElement>("sounds");
  for (const p of SOUND_PACKS) {
    const b = document.createElement("button");
    b.type = "button";
    const name = () => { b.textContent = tr(p.name, SOUND_EN[p.id] ?? p.name); };
    name(); addEventListener("langchange", name);
    if (p.id === "typewriter") b.classList.add("on");
    b.onclick = () => {
      setSound({ soundPack: p.id }); sounds.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      if (!autoTyping) void (async () => { if (model.text().trim()) await send(true); await autoType(tr("Hello 你好", "Hello there")); })();
      else sfx.preview(p.id as SoundPack);
    };
    sounds.append(b);
  }
}

main().catch((e) => { console.error(e); document.body.classList.add("tw-failed"); });
