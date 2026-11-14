import { crumpleGL } from "./crumple-gl";
import type { Note } from "@shared/protocol";
import { charWidth, wrap } from "../lib/layout";

export const COLS = 24;     // width units per line (12 CJK chars)
export const UNIT_EM = 0.55; // one width unit in em
export const LINE_H = 28;
export const PAD = 36;       // top padding + bottom margin inside the paper

const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** One typed character with deterministic "real typewriter" wobble and ink variance. */
export function charSpan(ch: string, i: number, struck = false): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = struck ? "ch struck" : "ch";
  s.textContent = ch;
  s.style.width = `${charWidth(ch) * UNIT_EM}em`;
  s.style.setProperty("--r", `${((rnd(i, 1) - 0.5) * 3).toFixed(2)}deg`);
  s.style.setProperty("--y", `${((rnd(i, 2) - 0.5) * 1.2).toFixed(2)}px`);
  s.style.setProperty("--ink", (0.72 + rnd(i, 3) * 0.28).toFixed(2));
  return s;
}

export function signature(n: Note): string {
  const d = new Date(n.sentAt);
  return `— ${n.fromName} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Fully printed paper (used by stuck notes). Returns the number of rows including the signature. */
export function renderStatic(lines: HTMLElement, note: Note): number {
  let i = 0;
  const rows = wrap(note.text, COLS);
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "line";
    for (const ch of r) row.append(charSpan(ch, i++));
    lines.append(row);
  }
  const sig = document.createElement("div");
  sig.className = "line sig";
  sig.textContent = signature(note);
  lines.append(sig);
  return rows.length + 1;
}

export const paperHeight = (rows: number, extra = 0) => rows * LINE_H + PAD + extra;
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- torn edge ----------
/** Appends an irregular torn bottom edge (different every sheet). */
export function addTornEdge(paper: HTMLElement): void {
  paper.querySelector(".tear-edge")?.remove();
  const W = 280;
  const pts: string[] = ["0,0"];
  for (let x = 0; x <= W; ) {
    pts.push(`${x.toFixed(1)},${(2 + Math.random() * 7).toFixed(1)}`);
    x += 3 + Math.random() * 7;
  }
  pts.push(`${W},${(2 + Math.random() * 6).toFixed(1)}`, `${W},0`);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "tear-edge");
  svg.setAttribute("viewBox", `0 0 ${W} 10`);
  svg.setAttribute("preserveAspectRatio", "none");
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  poly.setAttribute("points", pts.join(" "));
  poly.setAttribute("fill", "#f2ebdc");
  svg.append(poly);
  paper.append(svg);
}

// ---------- crumpling ----------
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Random crease lines + facet shading, sized relative to the element so it densifies as it shrinks. */
export function creaseBackground(n = 14): string {
  const layers: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = rand(0, 180).toFixed(0), p = rand(5, 90);
    layers.push(`linear-gradient(${a}deg, transparent ${p.toFixed(1)}%, rgba(70,50,25,.22) ${(p + 0.5).toFixed(1)}%, rgba(255,255,255,.55) ${(p + 1.1).toFixed(1)}%, transparent ${(p + 2).toFixed(1)}%)`);
  }
  for (let i = 0; i < 6; i++) {
    layers.push(`conic-gradient(from ${rand(0, 360).toFixed(0)}deg at ${rand(10, 90).toFixed(0)}% ${rand(10, 90).toFixed(0)}%, rgba(60,40,20,.09) 0 ${rand(15, 30).toFixed(0)}%, transparent 0 ${rand(45, 60).toFixed(0)}%, rgba(255,255,255,.14) 0 ${rand(70, 85).toFixed(0)}%, transparent 0)`);
  }
  layers.push("radial-gradient(circle at 36% 30%, rgba(255,255,255,.35), rgba(60,40,20,.28) 78%)");
  return layers.join(",");
}

/** Points around an irregular ball inside a w×h box (same count as the rectangle outline). */
function ballPoints(w: number, h: number, n: number, jag: number): Array<[number, number]> {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = R * rand(1 - jag, 1);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

/** Points along the rectangle outline, ordered by angle from the centre (matches ballPoints). */
function rectPoints(w: number, h: number, n: number): Array<[number, number]> {
  const cx = w / 2, cy = h / 2;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const t = Math.min(Math.abs(cx / (dx || 1e-9)), Math.abs(cy / (dy || 1e-9)));
    return [cx + dx * t, cy + dy * t];
  });
}

const poly = (pts: Array<[number, number]>) => `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(",")})`;

/** Ball clip-path for a size×size box (used by the fly-to-trash ball too). */
export const ballClip = (size: number) => poly(ballPoints(size, size, 40, 0.16));

/**
 * Crumples the element into a paper ball in place (3D WebGL when available).
 * Resolves with the element now showing the ball — animate / remove that one.
 */
export async function crumple(el: HTMLElement, ballSize = 58): Promise<HTMLElement> {
  try {
    const ball = await crumpleGL(el, ballSize);
    if (ball) return ball;
  } catch (e) {
    console.warn("webgl crumple failed, falling back", e);
  }
  await crumpleClip(el, ballSize);
  return el;
}

async function crumpleClip(el: HTMLElement, ballSize: number): Promise<void> {
  const w = el.offsetWidth, h = el.offsetHeight, N = 40;
  const rect = rectPoints(w, h, N);
  const ball = ballPoints(w, h, N, 0.16);
  const mid = rect.map(([x, y], i) => {
    const [bx, by] = ball[i];
    const t = rand(0.35, 0.6);
    return [x + (bx - x) * t + rand(-0.06, 0.06) * w, y + (by - y) * t + rand(-0.06, 0.06) * h] as [number, number];
  });
  const creases = document.createElement("div");
  creases.className = "creases";
  creases.style.background = creaseBackground();
  el.append(creases);
  el.style.boxShadow = "none";
  const scale = ballSize / Math.min(w, h);
  const opts: KeyframeAnimationOptions = { duration: 680, easing: "cubic-bezier(.45,.05,.3,1)", fill: "forwards" };
  const body = el.animate([
    { clipPath: poly(rect), scale: "1", rotate: "0deg", filter: "brightness(1)" },
    { clipPath: poly(mid), scale: String(0.82), rotate: `${rand(-8, 8)}deg`, filter: "brightness(.97)", offset: 0.4 },
    { clipPath: poly(ball), scale: String(scale), rotate: `${rand(20, 40)}deg`, filter: "brightness(.94)" },
  ], opts);
  creases.animate([{ opacity: 0 }, { opacity: 0.7, offset: 0.4 }, { opacity: 1 }], opts);
  await body.finished;
}
