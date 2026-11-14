import type { Note } from "@shared/protocol";

const pad = (n: number) => String(n).padStart(2, "0");

export function noteFileName(n: Note): string {
  const d = new Date(n.sentAt);
  const safe = n.fromName.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/[. ]+$/, "");
  return `纸条-${safe}-${pad(d.getHours())}${pad(d.getMinutes())}-${n.id.slice(0, 8)}.txt`;
}

export function noteFileBody(n: Note): string {
  const d = new Date(n.sentAt);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${n.text}\n\n— ${n.fromName} ${stamp}\n`;
}
