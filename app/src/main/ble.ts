/**
 * Bluetooth LE transport (macOS: native/ble Swift helper over CoreBluetooth; Windows: native/ble-win helper).
 * Same message shapes and the same trust model as LAN mode (lan.ts): only the transport differs.
 * Peers are keyed by their LAN identity (read from the GATT INFO characteristic), not by the BLE device id.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isLanMessage, type LanMe, type LanMessage, type LanReply } from "./lan";

export interface BlePeer { id: string; nickname: string; dev: string; seen: number }
export interface BleOptions {
  me: () => LanMe;
  onMessage: (m: LanMessage) => LanReply;
  onPeers: () => void;
  helper: string | null;
}
const EXPIRE_MS = 30_000;

export function bleHelperPath(resourcesPath: string, appDir: string, packaged: boolean): string | null {
  const name = process.platform === "win32" ? "dt-ble.exe" : "dt-ble";
  if (process.platform !== "darwin" && process.platform !== "win32") return null;
  const p = packaged ? join(resourcesPath, name) : join(appDir, "build", name);
  return existsSync(p) ? p : null;
}

export class Ble {
  peers = new Map<string, BlePeer>();
  state = "off";
  private proc: ChildProcess | null = null;
  private devToId = new Map<string, string>();
  private devSeen = new Map<string, number>();
  private waiters = new Map<number, (r: LanReply) => void>();
  private nextReq = 1;
  private timer: NodeJS.Timeout | null = null;

  constructor(private o: BleOptions) {}

  get available(): boolean { return !!this.o.helper; }
  get running(): boolean { return !!this.proc; }

  start(): void {
    if (this.proc || !this.o.helper) return;
    const p = spawn(this.o.helper, [], { stdio: ["pipe", "pipe", "inherit"] });
    this.proc = p;
    p.on("exit", () => { if (this.proc === p) { this.proc = null; this.state = "off"; this.failAll("helper_exited"); this.o.onPeers(); } });
    p.on("error", (e) => console.warn("ble helper", e.message));
    createInterface({ input: p.stdout! }).on("line", (l) => this.onLine(l));
    this.cmd({ cmd: "start", info: JSON.stringify(this.o.me()) });
    this.timer = setInterval(() => this.expire(), 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.proc) { this.cmd({ cmd: "stop" }); this.proc.kill(); this.proc = null; }
    this.failAll("stopped");
    this.peers.clear(); this.devToId.clear();
    this.state = "off";
    this.o.onPeers();
  }

  /** Our nickname changed: update what peers read from INFO. */
  refreshInfo(): void { this.cmd({ cmd: "info", info: JSON.stringify(this.o.me()) }); }

  send(peerId: string, m: LanMessage): Promise<LanReply> {
    const p = this.peers.get(peerId);
    if (!p || !this.proc) return Promise.resolve({ ok: false, reason: "not_nearby" });
    const req = this.nextReq++;
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.waiters.delete(req); resolve({ ok: false, reason: "not_nearby" }); }, 25_000);
      this.waiters.set(req, (r) => { clearTimeout(t); resolve(r); });
      this.cmd({ cmd: "send", req, peer: p.dev, data: JSON.stringify(m) });
    });
  }

  private cmd(o: object): void { this.proc?.stdin?.write(JSON.stringify(o) + "\n"); }
  private failAll(reason: string): void { for (const w of this.waiters.values()) w({ ok: false, reason: reason === "stopped" ? "not_nearby" : "not_nearby" }); this.waiters.clear(); }

  /** Exposed for tests. */
  onLine(line: string): void {
    let e: Record<string, unknown>;
    try { e = JSON.parse(line); } catch { return; }
    switch (e.ev) {
      case "state": this.state = String(e.state); this.o.onPeers(); break;
      case "seen": {
        const dev = String(e.peer); this.devSeen.set(dev, Date.now());
        const id = this.devToId.get(dev); const p = id ? this.peers.get(id) : undefined;
        if (p) p.seen = Date.now();
        break;
      }
      case "peer": {
        let info: Record<string, unknown>;
        try { info = JSON.parse(String(e.info)); } catch { return; }
        if (typeof info.id !== "string" || typeof info.nickname !== "string" || info.id === this.o.me().id) return;
        const dev = String(e.peer);
        const prev = this.peers.get(info.id);
        this.devToId.set(dev, info.id);
        this.peers.set(info.id, { id: info.id, nickname: info.nickname.slice(0, 40), dev, seen: Date.now() });
        if (!prev || prev.nickname !== info.nickname || prev.dev !== dev) this.o.onPeers();
        break;
      }
      case "msg": {
        let reply: LanReply = { ok: false, reason: "bad_message" };
        try { const m = JSON.parse(String(e.data)); if (isLanMessage(m)) reply = this.o.onMessage(m); } catch { /* */ }
        this.cmd({ cmd: "reply", req: e.req, data: JSON.stringify(reply) });
        break;
      }
      case "sent": {
        const w = this.waiters.get(Number(e.req)); if (!w) break;
        this.waiters.delete(Number(e.req));
        if (e.error) { w({ ok: false, reason: "not_nearby" }); break; }
        try { w(JSON.parse(String(e.reply))); } catch { w({ ok: false, reason: "bad_reply" }); }
        break;
      }
    }
  }

  private expire(): void {
    let changed = false;
    for (const [id, p] of this.peers) {
      const seen = Math.max(p.seen, this.devSeen.get(p.dev) ?? 0);
      if (Date.now() - seen > EXPIRE_MS) { this.peers.delete(id); changed = true; }
    }
    if (changed) this.o.onPeers();
  }
}
