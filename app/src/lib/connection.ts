import type { ClientMsg, ServerMsg } from "@shared/protocol";

export interface SocketLike {
  send(d: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
}

export interface ConnectionOpts {
  url: () => string | null;
  onMessage: (m: ServerMsg) => void;
  onStatus: (online: boolean) => void;
  create?: (url: string) => SocketLike;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  connectTimeoutMs?: number;
}

export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

export class Connection {
  online = false;
  private sock: SocketLike | null = null;
  private attempt = 0;
  private timer: unknown = null;
  private connectTimer: unknown = null;
  private stopped = true;

  constructor(private o: ConnectionOpts) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clear(this.timer);
    this.timer = null;
    this.clear(this.connectTimer);
    this.connectTimer = null;
    const s = this.sock;
    this.sock = null;
    s?.close();
    this.setOnline(false);
  }

  restart(): void {
    this.stop();
    this.attempt = 0;
    this.start();
  }

  send(m: ClientMsg): boolean {
    if (!this.online || !this.sock) return false;
    this.sock.send(JSON.stringify(m));
    return true;
  }

  private open(): void {
    const url = this.o.url();
    if (!url || this.stopped) return;
    const create = this.o.create ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
    let s: SocketLike;
    try { s = create(url); } catch { this.schedule(); return; }
    this.sock = s;
    this.connectTimer = (this.o.setTimer ?? setTimeout)(() => {
      this.connectTimer = null;
      if (this.sock !== s) return;
      this.sock = null;
      try { s.close(); } catch { /* ignore */ }
      this.setOnline(false);
      this.schedule();
    }, this.o.connectTimeoutMs ?? 10_000);
    s.onopen = () => {
      if (this.sock !== s) return;
      this.clear(this.connectTimer);
      this.connectTimer = null;
      this.attempt = 0;
      this.setOnline(true);
    };
    s.onmessage = (e) => {
      if (this.sock !== s) return;
      let msg: ServerMsg;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") return;
      this.o.onMessage(msg);
    };
    s.onerror = () => {};
    s.onclose = () => {
      if (this.sock !== s) return;
      this.clear(this.connectTimer);
      this.connectTimer = null;
      this.sock = null;
      this.setOnline(false);
      this.schedule();
    };
  }

  private clear(t: unknown): void {
    if (t !== null) (this.o.clearTimer ?? ((x) => clearTimeout(x as NodeJS.Timeout)))(t);
  }

  private schedule(): void {
    if (this.stopped) return;
    const ms = backoffMs(this.attempt++);
    this.timer = (this.o.setTimer ?? setTimeout)(() => {
      this.timer = null;
      this.open();
    }, ms);
  }

  private setOnline(v: boolean): void {
    if (this.online === v) return;
    this.online = v;
    this.o.onStatus(v);
  }
}
