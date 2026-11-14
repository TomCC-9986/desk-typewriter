export function charWidth(ch: string): 1 | 2 {
  const c = ch.codePointAt(0) ?? 0;
  if (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  ) return 2;
  return 1;
}

/** Splits items into lines of at most `cols` width units. "\n" items break the line and are dropped. */
export function wrapItems<T>(items: T[], ch: (t: T) => string, cols: number): T[][] {
  const lines: T[][] = [];
  let cur: T[] = [];
  let w = 0;
  for (const item of items) {
    const c = ch(item);
    if (c === "\n") { lines.push(cur); cur = []; w = 0; continue; }
    const cw = charWidth(c);
    if (w + cw > cols && cur.length) { lines.push(cur); cur = []; w = 0; }
    cur.push(item);
    w += cw;
  }
  lines.push(cur);
  return lines;
}

export function wrap(text: string, cols: number): string[] {
  return wrapItems([...text], (c) => c, cols).map((l) => l.join(""));
}
