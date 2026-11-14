import type { Note } from "@shared/protocol";
import { wrap } from "../../lib/layout";
import type { AppView, PrintItem } from "../../shared/ipc-types";
import { addTornEdge, charSpan, COLS, crumple, signature, wait } from "../paper";
import { setSound, setVolume, sfx } from "../sound";

const root = document.getElementById("root")!;
const SLOT_W = 300;
const MAX_SLOTS = 5;
// room around a detached note for its tape and lifted shadow (must match note.css)
const NOTE_MARGIN_X = 22, NOTE_MARGIN_TOP = 16, NOTE_MARGIN_BOTTOM = 34;
const hung = new Set<HTMLElement>();
const queue: PrintItem[] = [];
let view: AppView | null = null;
let printing = false;
let dragging = false;
let slotCursor = 0;

const jitter = (a: number, b: number) => a + Math.random() * (b - a);

async function refresh(): Promise<void> {
  view = await window.desk.invoke<AppView>("state:get");
  setVolume(view.settings.volume);
  setSound(view.settings);
}
window.desk.on("state:changed", () => void refresh());
window.desk.on("feeder:print", (item: PrintItem) => { queue.push(item); void pump(); });

function slotX(slot: number): number {
  const W = window.innerWidth;
  const pos = view?.settings.feedPosition ?? "center";
  if (pos === "left") return 20 + slot * SLOT_W;
  if (pos === "right") return W - 300 - slot * SLOT_W;
  return W / 2 - 140 + [0, -1, 1, -2, 2][slot] * SLOT_W;
}

async function pump(): Promise<void> {
  if (printing) return;
  printing = true;
  if (!view) await refresh();
  while (queue.length) await printOne(queue.shift()!);
  printing = false;
  maybeEmpty();
}

/** Long notes: the sheet stops growing at the window height and the text scrolls to the newest line. */
function followLatest(paper: HTMLElement): void {
  const lines = paper.querySelector<HTMLElement>(".lines");
  if (lines) lines.scrollTop = lines.scrollHeight;
}

function setRows(paper: HTMLElement, n: number): void {
  paper.style.setProperty("--rows", String(n));
}

async function printOne(item: PrintItem): Promise<void> {
  const paper = document.createElement("div");
  paper.className = "paper feeding";
  paper.style.left = `${slotX(slotCursor++ % MAX_SLOTS)}px`;
  const lines = document.createElement("div");
  lines.className = "lines";
  paper.append(lines);
  setRows(paper, 0);
  root.append(paper);

  sfx.alert();
  await wait(380);

  const text = item.kind === "note" ? item.note.text : `${item.nickname} 想和你互传纸条`;
  const rows = wrap(text, COLS);
  let i = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = document.createElement("div");
    row.className = "line";
    lines.append(row);
    setRows(paper, r + 1); // paper steps down one line
    followLatest(paper);
    sfx.feed();
    await wait(170);
    for (const ch of rows[r]) {
      row.append(charSpan(ch, i++));
      followLatest(paper);
      sfx.recv(ch);
      await wait(jitter(60, 90));
    }
    await wait(110);
  }

  if (item.kind === "note") {
    const sig = document.createElement("div");
    sig.className = "line sig";
    sig.textContent = signature(item.note);
    lines.append(sig);
    setRows(paper, rows.length + 1);
    sfx.feed();
    await wait(220);
  } else {
    const bar = document.createElement("div");
    bar.className = "actions";
    const yes = Object.assign(document.createElement("button"), { textContent: "同意" });
    const no = Object.assign(document.createElement("button"), { textContent: "拒绝" });
    yes.onclick = () => { window.desk.send("friend:respond", { from: item.from, accepted: true }); void discard(paper); };
    no.onclick = () => { window.desk.send("friend:respond", { from: item.from, accepted: false }); void discard(paper); };
    bar.append(yes, no);
    paper.append(bar);
    paper.style.setProperty("--extra", "48px");
    sfx.feed();
    await wait(220);
  }

  sfx.tear();
  paper.classList.remove("feeding");
  addTornEdge(paper);
  await wait(200);
  hang(paper, item);
}

function hang(paper: HTMLElement, item: PrintItem): void {
  hung.add(paper);
  const lines = paper.querySelector<HTMLElement>(".lines")!;
  paper.addEventListener("wheel", (e) => { lines.scrollTop += e.deltaY; e.preventDefault(); }, { passive: false });
  paper.addEventListener("pointerenter", () => window.desk.send("feeder:mouse", false));
  paper.addEventListener("pointerleave", () => { if (!dragging) window.desk.send("feeder:mouse", true); });
  if (item.kind !== "note") return;
  const timer = setTimeout(() => void expire(paper, item.note), view?.autoTrashMs ?? 30 * 60_000);
  paper.addEventListener("dblclick", () => { clearTimeout(timer); void discard(paper); });
  enableDrag(paper, item.note, () => clearTimeout(timer));
}

function enableDrag(paper: HTMLElement, note: Note, onDetach: () => void): void {
  paper.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const sx = e.clientX, sy = e.clientY;
    const r0 = paper.getBoundingClientRect();
    let moved = false;
    paper.setPointerCapture(e.pointerId);
    dragging = true;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      paper.classList.add("dragging", "loose");
      paper.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.max(-6, Math.min(6, dx / 40))}deg)`;
    };
    const up = (ev: PointerEvent) => {
      paper.removeEventListener("pointermove", move);
      paper.removeEventListener("pointerup", up);
      dragging = false;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved || Math.hypot(dx, dy) < 40) {
        paper.style.transform = "";
        paper.classList.remove("dragging", "loose");
        return;
      }
      onDetach();
      window.desk.send("feeder:detach", {
        note,
        x: Math.round(window.screenX + r0.left + dx) - NOTE_MARGIN_X,
        y: Math.round(window.screenY + r0.top + dy) - NOTE_MARGIN_TOP,
        w: Math.ceil(r0.width) + NOTE_MARGIN_X * 2,
        h: Math.ceil(r0.height) + NOTE_MARGIN_TOP + NOTE_MARGIN_BOTTOM,
      });
      remove(paper);
    };
    paper.addEventListener("pointermove", move);
    paper.addEventListener("pointerup", up);
  });
}

function remove(paper: HTMLElement): void {
  hung.delete(paper);
  paper.remove();
  window.desk.send("feeder:mouse", true);
  maybeEmpty();
}

function maybeEmpty(): void {
  if (!hung.size && !printing && !queue.length) window.desk.send("feeder:empty");
}

/** Crumple in place, then the ball drops away. */
async function discard(paper: HTMLElement): Promise<void> {
  hung.delete(paper);
  sfx.crumple();
  const ball = await crumple(paper);
  await dropAway(ball);
  if (ball !== paper) ball.remove();
  remove(paper);
}

async function dropAway(el: HTMLElement): Promise<void> {
  const fall = el.animate(
    [{ translate: "0 0", opacity: 1 }, { translate: `${(Math.random() * 60 - 30).toFixed(0)}px 260px`, opacity: 0 }],
    { duration: 520, easing: "cubic-bezier(.5,0,.9,.5)", fill: "forwards", composite: "add" },
  );
  setTimeout(() => sfx.drop(), 380);
  await fall.finished;
}

async function expire(paper: HTMLElement, note: Note): Promise<void> {
  hung.delete(paper);
  sfx.crumple();
  const ball = await crumple(paper);
  const r = paper.getBoundingClientRect(); // centre of the sheet = centre of the ball
  window.desk.send("feeder:expired", {
    note,
    x: Math.round(window.screenX + r.left + r.width / 2),
    y: Math.round(window.screenY + r.top + r.height / 2),
  });
  if (ball !== paper) setTimeout(() => ball.remove(), 60); // fx window takes over the ball
  remove(paper);
}

void refresh();
