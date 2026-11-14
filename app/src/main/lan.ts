/**
 * LAN mode: typewriters on the same network find each other and pass notes without the internet.
 *
 * Discovery: every instance broadcasts a small UDP datagram every 3 s and listens on the same port.
 * Transport: each instance runs a tiny HTTP server on a random port; peers POST JSON messages to it.
 * Trust: like the server flow, a request must be accepted first. Accepting swaps random tokens, and
 * every later message must carry the token the receiver issued, so a spoofed name gets nothing.
 */
import { createSocket, type Socket } from "node:dgram";
import { createServer, request, type Server } from "node:http";
import { networkInterfaces } from "node:os";

export const LAN_PORT = Number(process.env.DESK_LAN_PORT) || 47231;
const ANNOUNCE_MS = 3000;
const EXPIRE_MS = 12_000;
const MAX_BODY = 16 * 1024;

export interface LanMe { id: string; nickname: string }
export interface LanPeer { id: string; nickname: string; addr: string; port: number; seen: number }
export type LanMessage =
  | { type: "request"; from: LanMe; token: string }
  | { type: "accept"; from: LanMe; token: string }
  | { type: "note"; from: LanMe; token: string; id: string; text: string; sentAt: number };
export type LanReply = { ok: boolean; reason?: string };

export interface LanOptions {
  me: () => LanMe;
  onMessage: (m: LanMessage, peer: LanPeer | undefined) => LanReply;
  onPeers: () => void;
  udpPort?: number;
}

/** Broadcast addresses of all IPv4 interfaces, plus the limited broadcast address. */
export function broadcastAddresses(): string[] {
  const out = new Set<string>(["255.255.255.255"]);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const ip = a.address.split(".").map(Number), mask = a.netmask.split(".").map(Number);
      out.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join("."));
    }
  }
  return [...out];
}

export function isLanMessage(m: unknown): m is LanMessage {
  const o = m as Record<string, unknown>;
  if (!o || typeof o !== "object" || typeof o.token !== "string" || o.token.length > 128) return false;
  const f = o.from as Record<string, unknown>;
  if (!f || typeof f.id !== "string" || typeof f.nickname !== "string" || f.id.length > 128 || f.nickname.length > 40) return false;
  if (o.type === "request" || o.type === "accept") return true;
  return o.type === "note" && typeof o.id === "string" && o.id.length <= 128 && typeof o.text === "string" && o.text.length <= 2000 && typeof o.sentAt === "number";
}

export class Lan {
  peers = new Map<string, LanPeer>();
  private udp: Socket | null = null;
  private http: Server | null = null;
  private port = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private o: LanOptions) {}

  get running(): boolean { return !!this.http; }
  get httpPort(): number { return this.port; }

  async start(): Promise<void> {
    if (this.http) return;
    this.http = createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/lan") { res.writeHead(404).end(); return; }
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => { body += c; if (body.length > MAX_BODY) req.destroy(); });
      req.on("end", () => {
        let reply: LanReply = { ok: false, reason: "bad_message" };
        try {
          const m = JSON.parse(body);
          if (isLanMessage(m)) {
            const peer = this.peers.get(m.from.id);
            if (peer) peer.seen = Date.now();
            reply = this.o.onMessage(m, peer);
          }
        } catch { /* bad JSON */ }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((resolve) => this.http!.listen(0, "0.0.0.0", () => resolve()));
    this.port = (this.http.address() as { port: number }).port;

    const udp = createSocket({ type: "udp4", reuseAddr: true });
    this.udp = udp;
    udp.on("error", (e) => console.warn("lan udp", e.message));
    udp.on("message", (buf, rinfo) => this.onAnnounce(buf, rinfo.address));
    await new Promise<void>((resolve) => udp.bind(this.o.udpPort ?? LAN_PORT, () => { try { udp.setBroadcast(true); } catch { /* */ } resolve(); }));
    this.announce();
    this.timer = setInterval(() => { this.announce(); this.expire(); }, ANNOUNCE_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.udp?.close(); this.udp = null;
    this.http?.close(); this.http = null;
    this.peers.clear();
    this.o.onPeers();
  }

  private announce(): void {
    if (!this.udp) return;
    const me = this.o.me();
    const msg = Buffer.from(JSON.stringify({ app: "desk-typewriter", v: 1, id: me.id, nickname: me.nickname, port: this.port }));
    for (const addr of broadcastAddresses()) this.udp.send(msg, this.o.udpPort ?? LAN_PORT, addr, () => {});
  }

  private onAnnounce(buf: Buffer, addr: string): void {
    let m: Record<string, unknown>;
    try { m = JSON.parse(buf.toString("utf8")); } catch { return; }
    if (m.app !== "desk-typewriter" || typeof m.id !== "string" || typeof m.nickname !== "string" || typeof m.port !== "number") return;
    if (m.id === this.o.me().id) return;
    const prev = this.peers.get(m.id);
    const changed = !prev || prev.nickname !== m.nickname || prev.addr !== addr || prev.port !== m.port;
    this.peers.set(m.id, { id: m.id, nickname: String(m.nickname).slice(0, 40), addr, port: m.port, seen: Date.now() });
    if (changed) this.o.onPeers();
  }

  private expire(): void {
    let changed = false;
    for (const [id, p] of this.peers) if (Date.now() - p.seen > EXPIRE_MS) { this.peers.delete(id); changed = true; }
    if (changed) this.o.onPeers();
  }

  /** Test hook / manual add (e.g. a peer on another subnet). */
  addPeer(p: LanPeer): void { this.peers.set(p.id, p); this.o.onPeers(); }

  send(peerId: string, m: LanMessage): Promise<LanReply> {
    const p = this.peers.get(peerId);
    if (!p) return Promise.resolve({ ok: false, reason: "not_nearby" });
    const body = JSON.stringify(m);
    return new Promise((resolve) => {
      const req = request({ host: p.addr, port: p.port, path: "/lan", method: "POST", timeout: 5000,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => {
        let s = ""; res.setEncoding("utf8");
        res.on("data", (c: string) => { s += c; });
        res.on("end", () => { try { resolve(JSON.parse(s)); } catch { resolve({ ok: false, reason: "bad_reply" }); } });
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => resolve({ ok: false, reason: "not_nearby" }));
      req.end(body);
    });
  }
}
