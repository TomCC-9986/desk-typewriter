import type { Note } from "@shared/protocol";
import { addTornEdge, crumple, paperHeight, renderStatic } from "../paper";
import { setVolume, sfx } from "../sound";

const note = document.getElementById("note")!;
const paper = document.getElementById("paper")!;
const lines = document.getElementById("lines")!;
let id = "";

window.desk.on("note:init", (n: Note) => {
  id = n.id;
  const rows = renderStatic(lines, n);
  paper.style.height = `${Math.min(paperHeight(rows), 620)}px`;  // long notes scroll with the wheel
  paper.addEventListener("wheel", (e) => { lines.scrollTop += e.deltaY; e.preventDefault(); }, { passive: false });
  addTornEdge(paper);
  note.style.setProperty("--tilt", `${(Math.random() * 3 - 1.5).toFixed(1)}deg`);
  void window.desk.invoke<{ settings: { volume: number } }>("state:get").then((v) => setVolume(v.settings.volume));
});

note.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const sx = e.screenX, sy = e.screenY, wx = window.screenX, wy = window.screenY;
  let x = wx, y = wy, raf = 0;
  note.setPointerCapture(e.pointerId);
  note.classList.add("lifted");
  const move = (ev: PointerEvent) => {
    if (!Number.isFinite(ev.screenX) || !Number.isFinite(ev.screenY)) return;
    x = wx + ev.screenX - sx;
    y = wy + ev.screenY - sy;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; window.desk.send("note:move", { id, x, y }); });
  };
  const up = () => {
    note.removeEventListener("pointermove", move);
    note.removeEventListener("pointerup", up);
    note.classList.remove("lifted");
    if (x !== wx || y !== wy) window.desk.send("note:moved", { id, x, y });
  };
  note.addEventListener("pointermove", move);
  note.addEventListener("pointerup", up);
});

note.addEventListener("dblclick", async () => {
  sfx.crumple();
  for (const el of note.querySelectorAll<HTMLElement>(".lift, #tape")) el.style.opacity = "0";
  const ball = await crumple(paper);
  const fall = ball.animate(
    [{ translate: "0 0", opacity: 1 }, { translate: "0 120px", opacity: 0 }],
    { duration: 420, easing: "cubic-bezier(.5,0,.9,.5)", fill: "forwards", composite: "add" },
  );
  setTimeout(() => sfx.drop(), 300);
  await fall.finished;
  window.desk.send("note:close", id);
});
